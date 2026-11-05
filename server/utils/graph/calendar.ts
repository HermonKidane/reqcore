import type { task } from '../../database/schema'
import { bodyContent, londonDateTime } from './todo'
import type { GraphClient } from './client'

/**
 * Outlook event for a timed task: 30 minutes, busy, 15-minute reminder.
 * transactionId stops Graph creating a duplicate if a POST is retried; the
 * extended property lets us find our events again without a lookup table.
 */

type TaskRow = typeof task.$inferSelect

export const EVENT_MINUTES = 30
export const TASK_ID_PROPERTY = 'String {66f5a359-4659-4830-9070-00040ec6ac6e} Name MyRecruiterTaskId'

/** Only open tasks with a time get an event; done/cancelled remove it. */
export function needsEvent(t: Pick<TaskRow, 'allDay' | 'dueAt' | 'status'>): t is Pick<TaskRow, 'allDay' | 'status'> & { dueAt: Date } {
  return !t.allDay && !!t.dueAt && t.status === 'open'
}

export function eventPayload(t: TaskRow & { dueAt: Date }, opts: { create: boolean }) {
  const end = new Date(t.dueAt.getTime() + EVENT_MINUTES * 60_000)
  const payload: Record<string, unknown> = {
    subject: t.title,
    body: { contentType: 'text', content: bodyContent(t) },
    start: { dateTime: londonDateTime(t.dueAt), timeZone: 'Europe/London' },
    end: { dateTime: londonDateTime(end), timeZone: 'Europe/London' },
    showAs: 'busy',
    isReminderOn: true,
    reminderMinutesBeforeStart: 15,
  }
  if (opts.create) {
    payload.transactionId = `myrecruiter-task-${t.id}`
    payload.singleValueExtendedProperties = [{ id: TASK_ID_PROPERTY, value: t.id }]
  }
  return payload
}

/** Create or update; a PATCH 404 (event deleted in Outlook) re-creates it. Returns the event id. */
export async function upsertEvent(g: GraphClient, t: TaskRow & { dueAt: Date }, eventId: string | null): Promise<string | null> {
  if (eventId) {
    const res = await g.request<{ id: string }>(`/me/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: eventPayload(t, { create: false }) })
    if (res.status !== 404) return res.data?.id ?? eventId
  }
  const created = await g.request<{ id: string }>('/me/events', { method: 'POST', body: eventPayload(t, { create: true }) })
  return created.data?.id ?? null
}

/** 404 = already gone, which is what we wanted. */
export async function deleteEvent(g: GraphClient, eventId: string): Promise<void> {
  await g.request(`/me/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' })
}
