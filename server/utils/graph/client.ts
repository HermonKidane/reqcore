import { and, eq } from 'drizzle-orm'
import { userIntegration } from '../../database/schema'

/**
 * Microsoft Graph fetch helper for the To Do / Outlook sync.
 * One client per user per sync run: the token is fetched once (Better Auth
 * refreshes it with the stored refresh token when it is about to expire).
 * Tokens never leave this module: not logged, not returned, not in errors.
 */

export const MICROSOFT = 'microsoft'
const RECONNECT_MESSAGE = 'Microsoft sign-in has expired or was revoked. Reconnect To Do & Calendar in Settings.'

/** A Graph call failed; `message` is safe to store and show. */
export class GraphError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'GraphError'
  }
}

/** The user's Microsoft link is unusable; the integration has been switched off. */
export class GraphReconnectError extends GraphError {
  constructor(message = RECONNECT_MESSAGE) {
    super(401, 'reconnect_required', message)
    this.name = 'GraphReconnectError'
  }
}

export function graphBaseUrl(): string {
  return (env.GRAPH_BASE_URL || 'https://graph.microsoft.com/v1.0').replace(/\/+$/, '')
}

/** Safe, short message for task_sync.error / user_integration.last_error. */
export function syncErrorMessage(err: unknown): string {
  const msg = err instanceof GraphError ? err.message : 'Sync failed. Try again later.'
  return msg.slice(0, 500)
}

export async function disableIntegration(userId: string, message: string): Promise<void> {
  await db.update(userIntegration)
    .set({ enabled: false, lastError: message.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(userIntegration.userId, userId), eq(userIntegration.provider, MICROSOFT)))
}

/**
 * Better Auth wraps refresh failures in APIError('BAD_REQUEST', { cause }).
 * The cause is the token endpoint's error body (e.g. { error: 'invalid_grant' }
 * with a status). Only network / 5xx / 429 failures are worth retrying later;
 * anything else means the stored link is dead and the user must reconnect.
 */
function isTransientTokenError(err: unknown): boolean {
  const e = err as { cause?: unknown, message?: string } | null
  const cause = e?.cause as { status?: number, error?: string } | Error | undefined
  if (cause instanceof TypeError) return true // fetch failed (network)
  const status = (cause as { status?: number } | undefined)?.status
  if (typeof status === 'number' && (status >= 500 || status === 429)) return true
  return false
}

async function getMicrosoftToken(userId: string): Promise<string> {
  let token: string | undefined
  try {
    // No headers on purpose: without a session Better Auth resolves the
    // account by userId, which is what the scheduled pull needs too.
    const res = await auth.api.getAccessToken({ body: { providerId: MICROSOFT, userId } })
    token = res?.accessToken
  }
  catch (err) {
    if (isTransientTokenError(err)) {
      throw new GraphError(503, 'token_unavailable', 'Microsoft sign-in is temporarily unavailable. Will retry.')
    }
    // "Provider microsoft is not supported." = env has no Microsoft client id/secret
    const notConfigured = /^Provider .* not (supported|found)/i.test(String((err as Error)?.message ?? ''))
    const message = notConfigured ? 'Microsoft sign-in is not configured on this server.' : RECONNECT_MESSAGE
    await disableIntegration(userId, message)
    throw new GraphReconnectError(message)
  }
  if (!token) {
    await disableIntegration(userId, RECONNECT_MESSAGE)
    throw new GraphReconnectError()
  }
  return token
}

export interface GraphResponse<T> {
  status: number
  data: T | null
}

export interface GraphRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
}

export interface GraphClient {
  userId: string
  /** Relative path ("/me/todo/lists") or an absolute Graph link (nextLink / deltaLink). 404 is returned, not thrown. */
  request<T = Record<string, unknown>>(path: string, opts?: GraphRequestOptions): Promise<GraphResponse<T>>
  /** Number of HTTP calls made, for logs. */
  calls: number
}

const MAX_RETRY_AFTER_S = 30
const TIMEOUT_MS = 15_000

function resolveUrl(path: string): string {
  const base = graphBaseUrl()
  if (/^https?:\/\//i.test(path)) {
    // Only follow links that stay on the Graph host: the bearer token must
    // never be sent anywhere else, whatever a response body says.
    if (new URL(path).origin !== new URL(base).origin) {
      throw new GraphError(400, 'bad_link', 'Microsoft returned a link to an unexpected host.')
    }
    return path
  }
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`
}

function retryAfterSeconds(res: Response): number {
  const raw = res.headers.get('retry-after')
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_RETRY_AFTER_S) : 5
}

async function graphErrorFrom(res: Response): Promise<GraphError> {
  let code = `http_${res.status}`
  let detail = ''
  try {
    const body = await res.json() as { error?: { code?: string, message?: string } }
    if (body?.error?.code) code = body.error.code
    if (body?.error?.message) detail = body.error.message
  }
  catch { /* non-JSON body */ }
  const human = res.status === 403
    ? 'Microsoft did not allow this. Reconnect To Do & Calendar in Settings to grant access.'
    : res.status === 429
      ? 'Microsoft is rate limiting requests. Will retry later.'
      : `Microsoft returned an error (${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}).`
  return new GraphError(res.status, code, human)
}

export async function graphClient(userId: string): Promise<GraphClient> {
  const token = await getMicrosoftToken(userId)
  const client: GraphClient = {
    userId,
    calls: 0,
    async request<T>(path: string, opts: GraphRequestOptions = {}): Promise<GraphResponse<T>> {
      const url = resolveUrl(path)
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...opts.headers,
      }
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

      // 429 / 503: honour Retry-After once, then give up (caller marks error)
      for (let attempt = 0; attempt < 2; attempt++) {
        client.calls++
        let res: Response
        try {
          res = await fetch(url, {
            method: opts.method ?? 'GET',
            headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
        }
        catch {
          throw new GraphError(0, 'network', 'Could not reach Microsoft. Will retry later.')
        }

        if ((res.status === 429 || res.status === 503) && attempt === 0) {
          const wait = retryAfterSeconds(res)
          await res.body?.cancel().catch(() => {})
          await new Promise(r => setTimeout(r, wait * 1000))
          continue
        }
        if (res.status === 401) {
          await res.body?.cancel().catch(() => {})
          await disableIntegration(userId, RECONNECT_MESSAGE)
          throw new GraphReconnectError()
        }
        if (res.status === 404) {
          await res.body?.cancel().catch(() => {})
          return { status: 404, data: null }
        }
        if (!res.ok) throw await graphErrorFrom(res)
        if (res.status === 204) return { status: 204, data: null }
        const text = await res.text()
        return { status: res.status, data: text ? JSON.parse(text) as T : null }
      }
      throw new GraphError(429, 'throttled', 'Microsoft is rate limiting requests. Will retry later.')
    },
  }
  return client
}
