import { eq, and } from 'drizzle-orm'
import { task } from '../../database/schema'
import { taskIdParamSchema, updateTaskSchema } from '../../utils/schemas/task'
import { assertTaskLinks, taskWith } from '../../utils/tasks'
import { queueTaskSync, syncTaskNow } from '../../utils/graph/sync'

/**
 * PATCH /api/tasks/:id — task:update
 * Edit title/notes/due/owner, or flip open ⇄ done. Cancelled tasks are
 * read-only (409). Members may edit only their own tasks; admins any.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { task: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { id } = await getValidatedRouterParams(event, taskIdParamSchema.parse)
  const body = await readBody422(event, updateTaskSchema)

  const existing = await db.query.task.findFirst({
    where: and(eq(task.id, id), eq(task.organizationId, orgId)),
    columns: { id: true, status: true, ownerId: true, createdById: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (existing.status === 'cancelled') throw createError({ statusCode: 409, statusMessage: 'This task was cancelled' })

  if (existing.ownerId !== userId && existing.createdById !== userId) {
    const membership = await db.query.member.findFirst({
      where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.organizationId, orgId)),
      columns: { role: true },
    })
    if (membership?.role !== 'owner' && membership?.role !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: 'You can only change your own tasks' })
    }
  }

  if (body.ownerId) await assertTaskLinks(orgId, { ownerId: body.ownerId })

  const set: Partial<typeof task.$inferInsert> = { updatedAt: new Date() }
  if (body.title !== undefined) set.title = body.title
  if (body.notes !== undefined) set.notes = body.notes
  if (body.dueAt !== undefined) set.dueAt = body.dueAt
  if (body.allDay !== undefined) set.allDay = body.allDay
  if (body.ownerId !== undefined) set.ownerId = body.ownerId
  if (body.status !== undefined) {
    set.status = body.status
    set.completedAt = body.status === 'done' ? new Date() : null
  }

  const [updated] = await db.update(task).set(set)
    .where(and(eq(task.id, id), eq(task.organizationId, orgId)))
    .returning({ id: task.id })
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  if (getQuery(event).sync === 'now') await syncTaskNow(id)
  else queueTaskSync(id)
  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'updated',
    resourceType: 'task',
    resourceId: id,
    metadata: { changed: Object.keys(body) },
  }).catch(() => {})

  return db.query.task.findFirst({ where: eq(task.id, id), with: taskWith })
})
