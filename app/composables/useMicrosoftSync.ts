/**
 * Microsoft To Do & Calendar sync state for the signed-in user
 * (Settings → Account, and a "Sync now" anywhere else that wants it).
 */
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

/** Scopes asked for at link time only; sign-in keeps its own minimal set. */
export const MICROSOFT_SYNC_SCOPES = ['Tasks.ReadWrite', 'Calendars.ReadWrite', 'offline_access']

// Untyped alias: typed-route inference on sibling API paths can hit a TS
// "excessive stack depth" error (same workaround as useTasks).
const api = $fetch as unknown as (url: string, opts?: Record<string, unknown>) => Promise<unknown>

function errorMessage(err: unknown, fallback: string): string {
  const e = err as { data?: { statusMessage?: string, message?: string }, statusMessage?: string } | null
  return e?.data?.statusMessage ?? e?.data?.message ?? e?.statusMessage ?? fallback
}

export function useMicrosoftSync() {
  const status = useState<MicrosoftSyncStatus | null>('microsoft-sync-status', () => null)
  const busy = ref<'enable' | 'disable' | 'sync' | null>(null)
  const error = ref('')

  async function refresh() {
    try {
      status.value = await api('/api/integrations/microsoft/status') as MicrosoftSyncStatus
    }
    catch {
      status.value = null
    }
  }

  async function run(kind: 'enable' | 'disable' | 'sync', fallback: string): Promise<boolean> {
    busy.value = kind
    error.value = ''
    try {
      status.value = await api(`/api/integrations/microsoft/${kind}`, { method: 'POST' }) as MicrosoftSyncStatus
      return true
    }
    catch (err) {
      error.value = errorMessage(err, fallback)
      await refresh()
      return false
    }
    finally {
      busy.value = null
    }
  }

  const enable = () => run('enable', 'Could not turn on To Do & Calendar sync.')
  const disable = () => run('disable', 'Could not turn off sync.')
  const syncNow = () => run('sync', 'Sync failed. Try again in a moment.')

  /** Most recent push or pull, for "Last synced …". */
  const lastSyncedAt = computed(() => {
    const s = status.value
    const times = [s?.lastPullAt, s?.lastPushAt].filter(Boolean).map(v => new Date(v as string).getTime())
    return times.length ? new Date(Math.max(...times)) : null
  })

  return { status, busy, error, refresh, enable, disable, syncNow, lastSyncedAt }
}
