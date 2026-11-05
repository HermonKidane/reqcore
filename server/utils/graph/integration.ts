import type { H3Event } from 'h3'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { account, task, taskSync, userIntegration } from '../../database/schema'
import { MICROSOFT } from './client'

/** Delegated scopes the sync needs on top of the sign-in scopes. */
export const REQUIRED_SCOPES = ['Tasks.ReadWrite', 'Calendars.ReadWrite'] as const

/**
 * Better Auth stores `account.scope` comma-joined (from the token response's
 * space-separated list). Microsoft may return short names or full URLs
 * ("https://graph.microsoft.com/Tasks.ReadWrite"), so match on the suffix.
 */
export function missingScopes(scope: string | null | undefined): string[] {
  const granted = (scope ?? '').split(/[\s,]+/).filter(Boolean).map(s => s.toLowerCase().split('/').pop()!)
  return REQUIRED_SCOPES.filter(r => !granted.includes(r.toLowerCase()))
}

/** Per-user routes: a signed-in user is enough (the integration is not org data). */
export async function requireUserSession(event: H3Event) {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return session
}

export async function getMicrosoftAccount(userId: string) {
  return db.query.account.findFirst({
    where: and(eq(account.userId, userId), eq(account.providerId, MICROSOFT)),
    columns: { id: true, scope: true },
  })
}

export async function getIntegration(userId: string) {
  return db.query.userIntegration.findFirst({
    where: and(eq(userIntegration.userId, userId), eq(userIntegration.provider, MICROSOFT)),
  })
}

export interface MicrosoftSyncStatus {
  configured: boolean
  linked: boolean
  scopesGranted: boolean
  missingScopes: string[]
  enabled: boolean
  listReady: boolean
  lastPullAt: string | null
  lastPushAt: string | null
  lastError: string | null
  pendingCount: number
  errorCount: number
}

export async function getMicrosoftSyncStatus(userId: string): Promise<MicrosoftSyncStatus> {
  const [acct, integ] = await Promise.all([getMicrosoftAccount(userId), getIntegration(userId)])
  const missing = acct ? missingScopes(acct.scope) : [...REQUIRED_SCOPES]

  let pendingCount = 0
  let errorCount = 0
  if (integ) {
    const rows = await db.select({ state: taskSync.state, n: sql<number>`count(*)::int` })
      .from(taskSync)
      .innerJoin(task, eq(task.id, taskSync.taskId))
      .where(and(eq(task.ownerId, userId), eq(taskSync.provider, MICROSOFT), inArray(taskSync.state, ['pending', 'error'])))
      .groupBy(taskSync.state)
    for (const r of rows) {
      if (r.state === 'pending') pendingCount = r.n
      if (r.state === 'error') errorCount = r.n
    }
  }

  return {
    configured: enabledSocialProviders().microsoft,
    linked: !!acct,
    scopesGranted: !!acct && missing.length === 0,
    missingScopes: missing,
    enabled: !!integ?.enabled,
    listReady: !!integ?.todoListId,
    lastPullAt: integ?.lastPullAt?.toISOString() ?? null,
    lastPushAt: integ?.lastPushAt?.toISOString() ?? null,
    lastError: integ?.lastError ?? null,
    pendingCount,
    errorCount,
  }
}
