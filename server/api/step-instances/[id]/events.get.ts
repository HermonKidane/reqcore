import { eq, and, asc } from 'drizzle-orm'
import { recruitmentStepInstance, recruitmentStepEvent } from '../../../database/schema'
import { stepInstanceIdParamSchema } from '../../../utils/schemas/recruitment'

/**
 * GET /api/step-instances/:id/events
 * Immutable evidence trail for a step instance (oldest first).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { workflow: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, stepInstanceIdParamSchema.parse)

  const instance = await db.query.recruitmentStepInstance.findFirst({
    where: eq(recruitmentStepInstance.id, id),
    with: { workflow: { columns: { organizationId: true } } },
  })
  if (!instance || instance.workflow.organizationId !== orgId) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const events = await db.query.recruitmentStepEvent.findMany({
    where: eq(recruitmentStepEvent.stepInstanceId, id),
    with: {
      actor: { columns: { id: true, name: true, email: true } },
    },
    orderBy: asc(recruitmentStepEvent.occurredAt),
  })

  return { events }
})
