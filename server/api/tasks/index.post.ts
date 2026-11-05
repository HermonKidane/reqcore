import { eq } from 'drizzle-orm'
import { task } from '../../database/schema'
import { createTaskSchema } from '../../utils/schemas/task'
import { createTask, taskWith } from '../../utils/tasks'

/** POST /api/tasks — task:create. Owner defaults to the caller. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { task: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const body = await readBody422(event, createTaskSchema)

  const row = await createTask({ orgId, createdById: userId, input: body, source: 'manual' })

  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'created',
    resourceType: 'task',
    resourceId: row.id,
    metadata: { title: row.title, dueAt: row.dueAt, candidateId: row.candidateId, applicationId: row.applicationId },
  }).catch(() => {})

  setResponseStatus(event, 201)
  return db.query.task.findFirst({ where: eq(task.id, row.id), with: taskWith })
})
