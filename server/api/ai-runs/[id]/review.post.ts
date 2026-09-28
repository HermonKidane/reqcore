import { stepInstanceIdParamSchema, reviewAiRunSchema } from '../../../utils/schemas/recruitment'
import { reviewAiRun } from '../../../utils/ai/service'

/**
 * POST /api/ai-runs/:id/review — workflow:update (design-ai-slice.md §5)
 *
 * Body: { decision: 'approve' | 'reject', note? ≤ 2000 } (readBody422).
 * Run 404 when not in this org (the row's own organizationId scope; a null
 * stepInstanceId from application deletion does not affect reviewability).
 *
 * One conditional UPDATE guarded on status='succeeded' — 0 rows → 409
 * (already reviewed, or not succeeded; races covered atomically). One-shot.
 * Does NOT touch step completionData (locked principle §0) — the recruiter
 * copies what they want into completionData via the step PATCH.
 *
 * NOTE the directory-route import depth: [id]/review.post.ts needs one more
 * `../` than [id].file.ts routes.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { workflow: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id } = await getValidatedRouterParams(event, stepInstanceIdParamSchema.parse)
  const body = await readBody422(event, reviewAiRunSchema)

  return reviewAiRun({
    orgId,
    userId,
    runId: id,
    decision: body.decision,
    note: body.note,
  })
})
