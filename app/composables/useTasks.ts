import type { MaybeRefOrGetter } from 'vue'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'

export interface TaskRow {
  id: string
  title: string
  notes: string | null
  dueAt: string | null
  allDay: boolean
  status: 'open' | 'done' | 'cancelled'
  ownerId: string
  candidateId: string | null
  jobId: string | null
  applicationId: string | null
  stepInstanceId: string | null
  source: 'manual' | 'ai_run' | 'system'
  aiRunId: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  owner: { id: string, name: string } | null
  candidate: { id: string, firstName: string, lastName: string } | null
  job: { id: string, title: string } | null
  syncs: Array<{ provider: string, state: 'pending' | 'synced' | 'error', error: string | null, todoTaskId: string | null, outlookEventId: string | null, lastSyncedAt: string | null }>
}

export interface TaskQuery {
  scope?: 'mine' | 'all'
  status?: 'open' | 'done' | 'cancelled'
  due?: 'overdue' | 'today' | 'week' | 'later' | 'none' | 'any'
  candidateId?: string
  applicationId?: string
  jobId?: string
  /** Tasks about any active client contact at this company */
  companyId?: string
  limit?: number
}

/**
 * Tasks (Session W slice 1). One list per query key; mutations refresh it.
 */
export function useTasks(query: MaybeRefOrGetter<TaskQuery> = {}, key = 'tasks') {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()
  const q = computed(() => {
    const v = toValue(query)
    return Object.fromEntries(Object.entries(v).filter(([, val]) => val !== undefined && val !== ''))
  })

  // No explicit generics on these calls: Nitro's typed-route inference hits a
  // TS "excessive stack depth" error with them; results are cast instead.
  const { data, status, error, refresh } = useFetch(() => '/api/tasks' as string, {
    key: computed(() => `${key}-${JSON.stringify(q.value)}`),
    query: q,
    headers: useRequestHeaders(['cookie']),
  })

  const tasks = computed(() => ((data.value as { tasks?: TaskRow[] } | null)?.tasks ?? []))

  // Untyped fetch alias: Nitro's typed-route matcher hits a TS "excessive
  // stack depth" error on /api/tasks (it has /bulk and /:id siblings).
  const api = $fetch as unknown as (url: string, opts?: Record<string, unknown>) => Promise<unknown>
  async function guarded<T>(fn: () => Promise<unknown>): Promise<T> {
    try {
      const r = await fn()
      await refresh()
      return r as T
    }
    catch (err) {
      handlePreviewReadOnlyError(err)
      throw err
    }
  }

  const createTask = (body: { title: string, dueAt?: string, notes?: string, allDay?: boolean, candidateId?: string, applicationId?: string, jobId?: string }) =>
    guarded<TaskRow>(() => api('/api/tasks', { method: 'POST', body }))
  const updateTask = (id: string, body: { title?: string, notes?: string | null, dueAt?: string | null, allDay?: boolean, status?: 'open' | 'done', ownerId?: string }) =>
    guarded<TaskRow>(() => api(`/api/tasks/${id}`, { method: 'PATCH', body }))
  const cancelTask = (id: string) => guarded<null>(() => api(`/api/tasks/${id}`, { method: 'DELETE' }))
  const toggleDone = (t: TaskRow) => updateTask(t.id, { status: t.status === 'done' ? 'open' : 'done' })

  return { tasks, status, error, refresh, createTask, updateTask, cancelTask, toggleDone }
}

/** Due-date bucket for display. */
export function dueBucket(dueAt: string | null, now = new Date()): 'overdue' | 'today' | 'week' | 'later' | 'none' {
  if (!dueAt) return 'none'
  const d = new Date(dueAt)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start.getTime() + 24 * 3600 * 1000)
  const week = new Date(start.getTime() + 7 * 24 * 3600 * 1000)
  if (d < start) return 'overdue'
  if (d < end) return 'today'
  if (d < week) return 'week'
  return 'later'
}
