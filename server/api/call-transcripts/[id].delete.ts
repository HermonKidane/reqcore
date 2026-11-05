import { eq, and } from 'drizzle-orm'
import { callTranscript } from '../../database/schema'
import { callTranscriptIdParamSchema } from '../../utils/schemas/callTranscript'

/**
 * DELETE /api/call-transcripts/:id — workflow:update
 * Hard delete (the recruiter's own record of a call). `ai_run.transcript_id`
 * is set null by the FK; the run's inputSnapshot keeps the audit copy of
 * what the model saw.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { workflow: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { id } = await getValidatedRouterParams(event, callTranscriptIdParamSchema.parse)

  const [deleted] = await db.delete(callTranscript)
    .where(and(eq(callTranscript.id, id), eq(callTranscript.organizationId, orgId)))
    .returning({ id: callTranscript.id, charCount: callTranscript.charCount })
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'deleted',
    resourceType: 'call_transcript',
    resourceId: deleted.id,
    metadata: { charCount: deleted.charCount },
  }).catch(() => {})

  setResponseStatus(event, 204)
  return null
})
