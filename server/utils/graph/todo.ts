import { and, eq } from 'drizzle-orm'
import type { task } from '../../database/schema'
import { userIntegration } from '../../database/schema'
import { GraphError, MICROSOFT, type GraphClient } from './client'

/**
 * Microsoft To Do: one "MyRecruiter" list per user, one remote task per ATS task.
 * Field mapping lives here so push and pull compare the same shapes.
 */

export const TODO_LIST_NAME = 'MyRecruiter'
const LONDON = 'Europe/London'
const LINK_PREFIX = 'Open in MyRecruiter: '

type TaskRow = typeof task.$inferSelect

export interface RemoteTodoTask {
  'id': string
  '@odata.etag'?: string
  '@removed'?: { reason?: string }
  'title'?: string
  'status'?: string
  'body'?: { content?: string, contentType?: string }
  'dueDateTime'?: { dateTime: string, timeZone: string } | null
  'completedDateTime'?: { dateTime: string, timeZone: string } | null
}

/** Absolute app base for deep links (BETTER_AUTH_URL is required outside previews). */
export function appBaseUrl(): string {
  const explicit = env.BETTER_AUTH_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const railway = env.RAILWAY_PUBLIC_DOMAIN?.trim()
  return railway ? `https://${railway}` : ''
}

export function taskUrl(t: Pick<TaskRow, 'id'>): string {
  const base = appBaseUrl()
  return base ? `${base}/dashboard/tasks?task=${encodeURIComponent(t.id)}` : ''
}

/** "YYYY-MM-DD" of an instant, in London. */
export function londonDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** "YYYY-MM-DDTHH:mm:ss" wall-clock time of an instant, in London. */
export function londonDateTime(d: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

export function bodyContent(t: Pick<TaskRow, 'id' | 'notes'>): string {
  const url = taskUrl(t)
  const link = url ? `${LINK_PREFIX}${url}` : ''
  return [t.notes?.trim(), link].filter(Boolean).join('\n\n')
}

/** Notes as the user sees them in To Do, minus our footer link. */
export function remoteNotes(r: RemoteTodoTask): string {
  let text = r.body?.content ?? ''
  if (r.body?.contentType?.toLowerCase() === 'html') text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  text = text.replace(/\r\n?/g, '\n')
  const i = text.lastIndexOf(LINK_PREFIX)
  if (i !== -1) text = text.slice(0, i)
  return text.trim()
}

/**
 * To Do only keeps a date. Graph echoes the zone we sent or converts to UTC;
 * for UTC, convert to the London calendar date, otherwise trust the date part.
 */
export function remoteDueDate(r: RemoteTodoTask): string | null {
  const due = r.dueDateTime
  if (!due?.dateTime) return null
  if (/^utc$/i.test(due.timeZone)) {
    const d = new Date(due.dateTime.replace(/Z?$/, 'Z'))
    return Number.isNaN(d.getTime()) ? null : londonDate(d)
  }
  return due.dateTime.slice(0, 10)
}

export function todoPayload(t: TaskRow, opts: { create: boolean }) {
  const payload: Record<string, unknown> = {
    title: t.title,
    body: { content: bodyContent(t), contentType: 'text' },
    status: t.status === 'done' ? 'completed' : 'notStarted',
    importance: 'normal',
    dueDateTime: t.dueAt ? { dateTime: `${londonDate(t.dueAt)}T00:00:00.0000000`, timeZone: LONDON } : null,
  }
  const url = taskUrl(t)
  // linkedResources can only be set inline on create; PATCH ignores them.
  if (opts.create && url) {
    payload.linkedResources = [{ webUrl: url, applicationName: 'MyRecruiter', displayName: 'Open in MyRecruiter', externalId: t.id }]
  }
  return payload
}

/**
 * Find or create the "MyRecruiter" list and cache its id on user_integration.
 * A new list means any stored delta link is for the wrong list, so clear it.
 */
export async function ensureTodoList(g: GraphClient, opts: { cachedListId?: string | null, refresh?: boolean } = {}): Promise<string> {
  if (opts.cachedListId && !opts.refresh) return opts.cachedListId

  let listId: string | undefined
  let next: string | undefined = '/me/todo/lists'
  for (let page = 0; next && page < 10 && !listId; page++) {
    const res: { data: { 'value'?: Array<{ id: string, displayName?: string }>, '@odata.nextLink'?: string } | null } = await g.request(next)
    listId = res.data?.value?.find(l => l.displayName === TODO_LIST_NAME)?.id
    next = res.data?.['@odata.nextLink']
  }
  if (!listId) {
    const created = await g.request<{ id: string }>('/me/todo/lists', { method: 'POST', body: { displayName: TODO_LIST_NAME } })
    listId = created.data?.id
  }
  if (!listId) throw new GraphError(502, 'list_create_failed', 'Could not create the MyRecruiter list in To Do.')

  if (listId !== opts.cachedListId) {
    await db.update(userIntegration)
      .set({ todoListId: listId, deltaLink: null, updatedAt: new Date() })
      .where(and(eq(userIntegration.userId, g.userId), eq(userIntegration.provider, MICROSOFT)))
  }
  return listId
}

export function todoTaskPath(listId: string, todoTaskId?: string | null): string {
  const base = `/me/todo/lists/${encodeURIComponent(listId)}/tasks`
  return todoTaskId ? `${base}/${encodeURIComponent(todoTaskId)}` : base
}
