import { eq } from 'drizzle-orm'
import { recruitmentStepInstance } from '../../../database/schema'
import { stepInstanceIdParamSchema, generateAiRunSchema } from '../../../utils/schemas/recruitment'
import { generateAiRun } from '../../../utils/ai/service'
import type { AiRuntimeConfig } from '../../../utils/ai/provider'

/**
 * POST /api/step-instances/:id/ai-runs — workflow:update (design-ai-slice.md §5)
 *
 * Human-triggered AI assist for a step. Body: {} (validated via readBody422).
 * - Instance 404 (org-scoped via its workflow)
 * - Terminal instance (completed/skipped) → 409; cancelled workflow → 409
 * - Prompt unresolvable → 422 (the ONLY "not an AI step" signal)
 * - Claim transaction: concurrent generates on the same instance → 409
 *   'AI run already in progress' (stale running runs >90s are reclaimed)
 *
 * The provider call is synchronous (user-initiated like a save, guardrail 10
 * not triggered). The run row — committed as 'running' BEFORE the call — is
 * the audit truth; activity_log is best-effort telemetry alongside it.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { workflow: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id } = await getValidatedRouterParams(event, stepInstanceIdParamSchema.parse)
  await readBody422(event, generateAiRunSchema)

  const instance = await db.query.recruitmentStepInstance.findFirst({
    where: eq(recruitmentStepInstance.id, id),
    with: {
      stepTemplate: { columns: { id: true, stepNumber: true, key: true, name: true, promptTemplateId: true } },
      workflow: { columns: { id: true, organizationId: true, jobId: true, applicationId: true, status: true } },
    },
  })

  if (!instance || instance.workflow.organizationId !== orgId) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  if (instance.status === 'completed' || instance.status === 'skipped') {
    throw createError({
      statusCode: 409,
      statusMessage: `Step is already ${instance.status}`,
    })
  }
  if (instance.workflow.status === 'cancelled') {
    throw createError({ statusCode: 409, statusMessage: 'Workflow is cancelled' })
  }

  const runtimeConfig = useRuntimeConfig(event) as unknown as AiRuntimeConfig
  return generateAiRun({
    orgId,
    userId,
    instance,
    config: {
      aiBaseUrl: runtimeConfig.aiBaseUrl,
      aiApiKey: runtimeConfig.aiApiKey,
      aiModel: runtimeConfig.aiModel,
    },
  })
})
