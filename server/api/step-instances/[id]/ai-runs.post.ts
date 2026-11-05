import { eq, and } from 'drizzle-orm'
import { recruitmentStepInstance, callTranscript } from '../../../database/schema'
import { stepInstanceIdParamSchema, generateAiRunSchema } from '../../../utils/schemas/recruitment'
import { generateAiRun, loadWorkflowCandidate } from '../../../utils/ai/service'
import type { AiRuntimeConfig } from '../../../utils/ai/provider'

/**
 * POST /api/step-instances/:id/ai-runs — workflow:update (design-ai-slice.md §5)
 *
 * Human-triggered AI assist for a step. Body (validated via readBody422):
 *   { purpose?: 'assist' | 'prep' | 'outcome', transcriptId?, round? }
 * - `{}` = the original behaviour ('assist', typed notes)
 * - 'outcome' REQUIRES a transcript saved via POST /api/call-transcripts
 *   (same org; if the transcript is pinned to a step, the same step) → 422 otherwise
 * - step 5 'prep' on a do-not-contact candidate → 409 (Session W step 5 #4)
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
  const body = await readBody422(event, generateAiRunSchema)

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

  // ── Slice 1: transcript for 'outcome' runs ──
  let transcript: { id: string, text: string } | null = null
  if (body.purpose === 'outcome') {
    if (!body.transcriptId) {
      throw createError({ statusCode: 422, statusMessage: 'Paste and save a transcript first' })
    }
    const row = await db.query.callTranscript.findFirst({
      where: and(eq(callTranscript.id, body.transcriptId), eq(callTranscript.organizationId, orgId)),
      columns: { id: true, text: true, stepInstanceId: true },
    })
    if (!row) throw createError({ statusCode: 404, statusMessage: 'Transcript not found' })
    if (row.stepInstanceId && row.stepInstanceId !== instance.id) {
      throw createError({ statusCode: 422, statusMessage: 'That transcript belongs to a different step' })
    }
    transcript = { id: row.id, text: row.text }
  }
  else if (body.transcriptId) {
    throw createError({ statusCode: 422, statusMessage: 'A transcript only applies to an "outcome" run' })
  }

  // ── Slice 1: the stop rule — no call prep for someone who said "don't contact me" ──
  if (body.purpose === 'prep' && instance.stepTemplate.key === 'candidate_contact') {
    const person = await loadWorkflowCandidate(orgId, instance.workflow.applicationId)
    if (person?.doNotContact) {
      throw createError({
        statusCode: 409,
        statusMessage: 'This person asked not to be contacted. No call prep will be drafted.',
        data: { code: 'do_not_contact' },
      })
    }
  }

  // Env config: read process.env directly — the Docker image bakes
  // runtimeConfig defaults at BUILD time, so env_file-injected values only
  // reach the app through process.env at runtime (same pattern as db.ts).
  // The nuxt.config runtimeConfig entries remain as build-time fallbacks.
  const runtimeConfig = useRuntimeConfig(event) as unknown as AiRuntimeConfig
  return generateAiRun({
    orgId,
    userId,
    instance,
    config: {
      aiBaseUrl: process.env.AI_BASE_URL || runtimeConfig.aiBaseUrl,
      aiApiKey: process.env.AI_API_KEY || runtimeConfig.aiApiKey,
      aiModel: process.env.AI_MODEL || runtimeConfig.aiModel,
    },
    extras: { purpose: body.purpose, round: body.round, transcript },
  })
})
