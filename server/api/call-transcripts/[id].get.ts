import { eq, and } from 'drizzle-orm'
import { callTranscript } from '../../database/schema'
import { callTranscriptIdParamSchema } from '../../utils/schemas/callTranscript'

/**
 * GET /api/call-transcripts/:id — workflow:read
 * Full row including the text (org-scoped; 404 otherwise).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { workflow: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, callTranscriptIdParamSchema.parse)

  const row = await db.query.callTranscript.findFirst({
    where: and(eq(callTranscript.id, id), eq(callTranscript.organizationId, orgId)),
    with: { createdBy: { columns: { id: true, name: true } } },
  })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return row
})
