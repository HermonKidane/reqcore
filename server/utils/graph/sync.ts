import { and, asc, eq, gt, isNull, lt, ne, or } from 'drizzle-orm'
import { task, taskSync, userIntegration } from '../../database/schema'
import { GraphError, GraphReconnectError, MICROSOFT, graphClient, syncErrorMessage, type GraphClient } from './client'
import { ensureTodoList, londonDate, remoteDueDate, remoteNotes, todoPayload, todoTaskPath, type RemoteTodoTask } from './todo'
import { deleteEvent, needsEvent, upsertEvent } from './calendar'
import { getIntegration } from './integration'

/**
 * Microsoft To Do / Outlook sync (Session W slice 1, plumbing P3).
 * ATS is the master copy. Outbound: pushTask after every create/patch/cancel.
 * Inbound: pullTasks reads the To Do delta for the user's "MyRecruiter" list.
 * Errors never reach the API response: they land in task_sync.error or
 * user_integration.last_error.
 */

type TaskRow = typeof task.$inferSelect
type SyncRow = typeof taskSync.$inferSelect

export const PULL_THROTTLE_MS = 2 * 60_000

// ─── Per-task serialisation ────────────────────────────────────────────
// Two quick edits must not race into two POSTs (= duplicate To Do tasks).
// Pushes for one task run one after another; a push that is queued but not
// started yet absorbs further requests, since it re-reads the row anyway.
const tails = new Map<string, Promise<void>>()
const queued = new Set<string>()

function runSerial(taskId: string): Promise<void> {
  const tail = tails.get(taskId)
  if (tail && queued.has(taskId)) return tail
  queued.add(taskId)
  const next = (tail ?? Promise.resolve())
    .then(() => {
      queued.delete(taskId)
      return pushTask(taskId)
    })
    .then(() => {}, (err) => {
      // DB failure while recording the result; nothing more we can do here
      console.error(`[graph] push for task ${taskId} failed:`, err instanceof Error ? err.message : 'unknown error')
    })
  tails.set(taskId, next)
  void next.finally(() => {
    if (tails.get(taskId) === next) tails.delete(taskId)
  })
  return next
}

/**
 * Fire-and-forget outbound sync. Called after every task create/patch/cancel;
 * never blocks or fails the request.
 */
export function queueTaskSync(taskId: string): void {
  setImmediate(() => {
    void runSerial(taskId)
  })
}

/** Same as queueTaskSync but awaited (for `?sync=now`). Still never throws. */
export function syncTaskNow(taskId: string): Promise<void> {
  return runSerial(taskId)
}

/** Fire-and-forget throttled pull, e.g. when the Tasks page loads. */
export function queuePull(userId: string): void {
  setImmediate(() => {
    pullTasks(userId).catch(() => {})
  })
}

// ─── Outbound ──────────────────────────────────────────────────────────

async function setSync(taskId: string, values: Partial<typeof taskSync.$inferInsert>): Promise<void> {
  await db.update(taskSync)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(taskSync.taskId, taskId), eq(taskSync.provider, MICROSOFT)))
}

async function markError(taskId: string, err: unknown): Promise<void> {
  if (!(err instanceof GraphError)) {
    console.error(`[graph] push for task ${taskId} failed:`, err instanceof Error ? err.message : 'unknown error')
  }
  await setSync(taskId, { state: 'error', error: syncErrorMessage(err) })
}

/**
 * The task changed owner: its remote copy is in the previous owner's To Do /
 * calendar. Find that owner by the list id we stored, delete the copies with
 * their token, then forget the ids so the new owner gets fresh ones.
 */
async function removeFromPreviousOwner(sync: SyncRow): Promise<void> {
  if (sync.todoListId) {
    const prev = await db.query.userIntegration.findFirst({
      where: and(eq(userIntegration.provider, MICROSOFT), eq(userIntegration.todoListId, sync.todoListId)),
      columns: { userId: true, enabled: true },
    })
    if (prev?.enabled) {
      try {
        const g = await graphClient(prev.userId)
        if (sync.todoTaskId) await g.request(todoTaskPath(sync.todoListId, sync.todoTaskId), { method: 'DELETE' })
        if (sync.outlookEventId) await deleteEvent(g, sync.outlookEventId)
      }
      catch { /* best effort: the old owner can delete it by hand */ }
    }
  }
  await setSync(sync.taskId, { todoListId: null, todoTaskId: null, outlookEventId: null, remoteEtag: null })
}

export type PushResult = 'skipped' | 'synced' | 'error'

/** Push one task's current state to To Do (+ Outlook for timed tasks). ≤ 4 Graph calls. */
export async function pushTask(taskId: string): Promise<PushResult> {
  // lastSyncedAt = when we READ the row, so an edit made during the push
  // still counts as "changed since sync" for the next pull.
  const startedAt = new Date()
  const t = await db.query.task.findFirst({ where: eq(task.id, taskId) })
  if (!t) return 'skipped'
  let sync = await db.query.taskSync.findFirst({
    where: and(eq(taskSync.taskId, taskId), eq(taskSync.provider, MICROSOFT)),
  })
  const integ = await getIntegration(t.ownerId)

  if (sync && (sync.todoTaskId || sync.outlookEventId) && sync.todoListId && sync.todoListId !== integ?.todoListId) {
    await removeFromPreviousOwner(sync)
    sync = { ...sync, todoListId: null, todoTaskId: null, outlookEventId: null, remoteEtag: null }
  }

  if (!integ?.enabled) return 'skipped'
  if (t.status === 'cancelled' && !sync) return 'skipped' // never synced, nothing to remove

  if (!sync) {
    await db.insert(taskSync).values({ taskId, provider: MICROSOFT, state: 'pending' }).onConflictDoNothing()
  }

  try {
    const g = await graphClient(t.ownerId)
    let listId = await ensureTodoList(g, { cachedListId: integ.todoListId })
    let todoTaskId = sync?.todoTaskId ?? null
    let todoListId = sync?.todoListId ?? null
    let eventId = sync?.outlookEventId ?? null
    let etag = sync?.remoteEtag ?? null

    if (t.status === 'cancelled') {
      if (todoTaskId) await g.request(todoTaskPath(todoListId ?? listId, todoTaskId), { method: 'DELETE' })
      if (eventId) await deleteEvent(g, eventId)
      todoTaskId = todoListId = eventId = etag = null
    }
    else {
      let res = todoTaskId
        ? await g.request<RemoteTodoTask>(todoTaskPath(todoListId ?? listId, todoTaskId), { method: 'PATCH', body: todoPayload(t, { create: false }) })
        : null
      if (res && res.status !== 404) {
        todoListId = todoListId ?? listId
      }
      else {
        // New task, or the remote copy / its list was deleted: (re)create it
        res = await g.request<RemoteTodoTask>(todoTaskPath(listId), { method: 'POST', body: todoPayload(t, { create: true }) })
        if (res.status === 404) {
          listId = await ensureTodoList(g, { cachedListId: listId, refresh: true })
          res = await g.request<RemoteTodoTask>(todoTaskPath(listId), { method: 'POST', body: todoPayload(t, { create: true }) })
        }
        todoListId = listId
      }
      todoTaskId = res.data?.id ?? todoTaskId
      etag = res.data?.['@odata.etag'] ?? null

      if (needsEvent(t)) eventId = await upsertEvent(g, { ...t, dueAt: t.dueAt }, eventId)
      else if (eventId) {
        await deleteEvent(g, eventId)
        eventId = null
      }
    }

    await setSync(taskId, {
      todoListId, todoTaskId, outlookEventId: eventId, remoteEtag: etag,
      state: 'synced', error: null, lastSyncedAt: startedAt,
    })
    await db.update(userIntegration)
      .set({ lastPushAt: new Date() })
      .where(and(eq(userIntegration.userId, t.ownerId), eq(userIntegration.provider, MICROSOFT)))
    return 'synced'
  }
  catch (err) {
    await markError(taskId, err)
    return 'error'
  }
}

/**
 * Push the user's tasks that are new to the sync, changed since their last
 * push, or stuck in pending/error. Sequential to stay well under Graph limits.
 */
export async function pushPending(userId: string, opts: { limit?: number } = {}): Promise<{ pushed: number }> {
  const rows = await db.select({ id: task.id })
    .from(task)
    .leftJoin(taskSync, and(eq(taskSync.taskId, task.id), eq(taskSync.provider, MICROSOFT)))
    .where(and(
      eq(task.ownerId, userId),
      or(
        and(isNull(taskSync.taskId), eq(task.status, 'open')),
        ne(taskSync.state, 'synced'),
        gt(task.updatedAt, taskSync.lastSyncedAt),
      ),
    ))
    .orderBy(asc(task.updatedAt))
    .limit(opts.limit ?? 200)
  for (const r of rows) await runSerial(r.id)
  return { pushed: rows.length }
}

// ─── Inbound ───────────────────────────────────────────────────────────

export interface PullResult {
  status: 'ok' | 'skipped' | 'error'
  reason?: string
  seen: number
  completed: number
  reopened: number
  cancelled: number
  accepted: number
  repushed: number
}

function emptyResult(status: PullResult['status'], reason?: string): PullResult {
  return { status, reason, seen: 0, completed: 0, reopened: 0, cancelled: 0, accepted: 0, repushed: 0 }
}

function parseGraphDate(v: { dateTime: string, timeZone: string } | null | undefined): Date | null {
  if (!v?.dateTime) return null
  const d = new Date(/^utc$/i.test(v.timeZone) ? v.dateTime.replace(/Z?$/, 'Z') : v.dateTime)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Move the due date to the remote calendar date, keeping the ATS time of day. */
function shiftDue(current: Date | null, remoteDate: string | null): Date | null {
  if (!remoteDate) return null
  const [y, m, d] = remoteDate.split('-').map(Number) as [number, number, number]
  const target = Date.UTC(y, m - 1, d)
  if (!current) return new Date(target)
  const [cy, cm, cd] = londonDate(current).split('-').map(Number) as [number, number, number]
  return new Date(current.getTime() + (target - Date.UTC(cy, cm - 1, cd)))
}

async function readDelta(g: GraphClient, start: string): Promise<{ items: RemoteTodoTask[], deltaLink: string | null }> {
  const items: RemoteTodoTask[] = []
  let next: string | undefined = start
  for (let page = 0; next && page < 100; page++) {
    const res: { status: number, data: { 'value'?: RemoteTodoTask[], '@odata.nextLink'?: string, '@odata.deltaLink'?: string } | null } = await g.request(next)
    if (res.status === 404) throw new GraphError(404, 'list_not_found', 'The MyRecruiter list was not found in To Do.')
    items.push(...(res.data?.value ?? []))
    if (res.data?.['@odata.deltaLink']) return { items, deltaLink: res.data['@odata.deltaLink'] }
    next = res.data?.['@odata.nextLink']
  }
  return { items, deltaLink: null }
}

async function applyRemote(userId: string, r: RemoteTodoTask, result: PullResult, toPush: Set<string>): Promise<void> {
  const sync = await db.query.taskSync.findFirst({
    where: and(eq(taskSync.provider, MICROSOFT), eq(taskSync.todoTaskId, r.id)),
    with: { task: true },
  })
  // Created directly in To Do (or someone else's): import is R2, ignore for now
  if (!sync || sync.task.ownerId !== userId) return
  const t: TaskRow = sync.task
  const now = new Date()

  if (r['@removed']) {
    if (t.status !== 'cancelled') {
      await db.update(task).set({ status: 'cancelled', updatedAt: now }).where(eq(task.id, t.id))
      result.cancelled++
    }
    await setSync(t.id, { todoTaskId: null, todoListId: null, remoteEtag: null, lastSyncedAt: now })
    if (sync.outlookEventId) toPush.add(t.id) // push of a cancelled task deletes the event
    return
  }
  if (t.status === 'cancelled') {
    toPush.add(t.id) // ATS cancelled first: push deletes the remote copy
    return
  }

  const unchangedSinceSync = !!sync.lastSyncedAt && t.updatedAt.getTime() <= sync.lastSyncedAt.getTime()
  const remoteDone = r.status === 'completed'
  const set: Partial<typeof task.$inferInsert> = {}

  // Ticking done in To Do always sticks; un-ticking only if the ATS row is untouched
  if (remoteDone && t.status === 'open') {
    set.status = 'done'
    set.completedAt = parseGraphDate(r.completedDateTime) ?? now
    result.completed++
  }
  else if (!remoteDone && t.status === 'done' && unchangedSinceSync) {
    set.status = 'open'
    set.completedAt = null
    result.reopened++
  }

  const rTitle = (r.title ?? '').trim()
  const rNotes = remoteNotes(r)
  const rDue = remoteDueDate(r)
  const fieldsDiffer = rTitle !== t.title
    || rNotes !== (t.notes ?? '').trim()
    || rDue !== (t.dueAt ? londonDate(t.dueAt) : null)

  let repush = false
  if (fieldsDiffer) {
    if (unchangedSinceSync) {
      if (rTitle) set.title = rTitle.slice(0, 200)
      set.notes = rNotes ? rNotes.slice(0, 4000) : null
      set.dueAt = shiftDue(t.dueAt, rDue)
      result.accepted++
    }
    else {
      repush = true // ATS wins
    }
  }
  const finalStatus = set.status ?? t.status
  if ((remoteDone ? 'done' : 'open') !== finalStatus) repush = true

  if (Object.keys(set).length) {
    await db.update(task).set({ ...set, updatedAt: now }).where(eq(task.id, t.id))
    await setSync(t.id, { remoteEtag: r['@odata.etag'] ?? sync.remoteEtag, lastSyncedAt: now, state: 'synced', error: null })
    // Status / time changes may add, move or remove the Outlook event
    if (sync.outlookEventId || needsEvent({ ...t, ...set } as TaskRow)) repush = true
  }
  else if (r['@odata.etag'] && r['@odata.etag'] !== sync.remoteEtag && !repush) {
    await setSync(t.id, { remoteEtag: r['@odata.etag'] })
  }
  if (repush) toPush.add(t.id)
}

/**
 * Pull remote changes for one user. Throttled to once per 2 minutes unless
 * forced; the slot is claimed atomically so parallel callers don't double-pull.
 */
export async function pullTasks(userId: string, opts: { force?: boolean } = {}): Promise<PullResult> {
  const now = new Date()
  const cutoff = new Date(now.getTime() - PULL_THROTTLE_MS)
  const [integ] = await db.update(userIntegration)
    .set({ lastPullAt: now })
    .where(and(
      eq(userIntegration.userId, userId),
      eq(userIntegration.provider, MICROSOFT),
      eq(userIntegration.enabled, true),
      opts.force ? undefined : or(isNull(userIntegration.lastPullAt), lt(userIntegration.lastPullAt, cutoff)),
    ))
    .returning()
  if (!integ) return emptyResult('skipped', 'disabled or throttled')

  const result = emptyResult('ok')
  try {
    const g = await graphClient(userId)
    let listId = await ensureTodoList(g, { cachedListId: integ.todoListId })
    const fresh = () => `${todoTaskPath(listId)}/delta`
    let delta: Awaited<ReturnType<typeof readDelta>>
    const savedLink = listId === integ.todoListId ? integ.deltaLink : null
    try {
      delta = await readDelta(g, savedLink ?? fresh())
    }
    catch (err) {
      // Expired delta token (410 / syncStateNotFound) or the list was deleted: start over once
      if (!(err instanceof GraphError) || err instanceof GraphReconnectError || ![404, 410, 400].includes(err.status)) throw err
      if (err.status === 404) listId = await ensureTodoList(g, { cachedListId: listId, refresh: true })
      else if (!savedLink) throw err
      delta = await readDelta(g, fresh())
    }

    const toPush = new Set<string>()
    for (const r of delta.items) {
      result.seen++
      await applyRemote(userId, r, result, toPush)
    }
    for (const id of toPush) await runSerial(id)
    result.repushed = toPush.size

    await db.update(userIntegration)
      .set({ deltaLink: delta.deltaLink, lastError: null, updatedAt: new Date() })
      .where(and(eq(userIntegration.userId, userId), eq(userIntegration.provider, MICROSOFT)))
    return result
  }
  catch (err) {
    if (!(err instanceof GraphReconnectError)) {
      // reconnect errors already wrote last_error + enabled=false
      await db.update(userIntegration)
        .set({ lastError: syncErrorMessage(err), updatedAt: new Date() })
        .where(and(eq(userIntegration.userId, userId), eq(userIntegration.provider, MICROSOFT)))
    }
    if (!(err instanceof GraphError)) {
      console.error(`[graph] pull for user ${userId} failed:`, err instanceof Error ? err.message : 'unknown error')
    }
    return { ...result, status: 'error', reason: syncErrorMessage(err) }
  }
}
