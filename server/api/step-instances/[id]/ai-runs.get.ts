import { eq } from 'drizzle-orm'
import { recruitmentStepInstance } from '../../../database/schema'
import { stepInstanceIdParamSchema } from '../../../utils/schemas/recruitment'
import { listAiRuns } from '../../../utils/ai/service'

/**
 * GET /api/step-instances/:id/ai-runs — workflow:read (design-ai-slice.md §5)
 *
 * Runs for a step instance, newest first (the reviewable one is newest),
 * each with promptTemplate { name, version }. Instance 404 (org-scoped).
 * No pagination: instance-scoped and naturally bounded.
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

  return { runs: await listAiRuns(orgId, id) }
})
