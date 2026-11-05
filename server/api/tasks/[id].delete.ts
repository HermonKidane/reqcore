import { eq, and, ne } from 'drizzle-orm'
import { task } from '../../database/schema'
import { taskIdParamSchema } from '../../utils/schemas/task'
import { queueTaskSync } from '../../utils/graph/sync'

/**
 * DELETE /api/tasks/:id — task:delete
 * Never a hard delete: status → cancelled, so the remote copy can be removed
 * and the audit stays. Own tasks only for members; admins any.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { task: ['delete'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { id } = await getValidatedRouterParams(event, taskIdParamSchema.parse)

  const existing = await db.query.task.findFirst({
    where: and(eq(task.id, id), eq(task.organizationId, orgId)),
    columns: { id: true, ownerId: true, createdById: true, status: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (existing.ownerId !== userId && existing.createdById !== userId) {
    const membership = await db.query.member.findFirst({
      where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.organizationId, orgId)),
      columns: { role: true },
    })
    if (membership?.role !== 'owner' && membership?.role !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: 'You can only cancel your own tasks' })
    }
  }

  await db.update(task)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(task.id, id), eq(task.organizationId, orgId), ne(task.status, 'cancelled')))

  queueTaskSync(id)
  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'deleted',
    resourceType: 'task',
    resourceId: id,
    metadata: { cancelled: true },
  }).catch(() => {})

  setResponseStatus(event, 204)
  return null
})
