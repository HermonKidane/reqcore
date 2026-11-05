import { bulkCreateTasksSchema } from '../../utils/schemas/task'
import { createTask } from '../../utils/tasks'

/**
 * POST /api/tasks/bulk — task:create. The "Add as tasks" path from an
 * approved AI run (≤ 20). Rows carry `source: ai_run` when `aiRunId` is set.
 * Created one by one (links checked each time); a failure stops the batch
 * and reports how many were made.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { task: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const body = await readBody422(event, bulkCreateTasksSchema)

  const ids: string[] = []
  for (const input of body.tasks) {
    try {
      const row = await createTask({ orgId, createdById: userId, input, source: input.aiRunId ? 'ai_run' : 'manual' })
      ids.push(row.id)
    }
    catch (err: any) {
      throw createError({
        statusCode: err?.statusCode ?? 500,
        statusMessage: `${ids.length} of ${body.tasks.length} tasks added before an error: ${err?.statusMessage ?? err?.message ?? 'unknown'}`,
        data: { created: ids.length },
      })
    }
  }

  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'created',
    resourceType: 'task',
    resourceId: ids[0] ?? 'bulk',
    metadata: { bulk: ids.length, aiRunId: body.tasks[0]?.aiRunId ?? null },
  }).catch(() => {})

  setResponseStatus(event, 201)
  return { created: ids.length, ids }
})
