import { eq, and } from 'drizzle-orm'
import { jobClientContact } from '../../../../database/schema'
import { jobContactParamsSchema } from '../../../../utils/schemas/person'

/**
 * DELETE /api/jobs/:id/contacts/:linkId
 * Remove a job↔contact link (links are not history; person_role history is
 * untouched). 204.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id, linkId } = await getValidatedRouterParams(event, jobContactParamsSchema.parse)

  const [deleted] = await db.delete(jobClientContact)
    .where(and(
      eq(jobClientContact.id, linkId),
      eq(jobClientContact.organizationId, orgId),
      eq(jobClientContact.jobId, id),
    ))
    .returning({ id: jobClientContact.id, candidateId: jobClientContact.candidateId })

  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'deleted',
    resourceType: 'job_client_contact',
    resourceId: linkId,
    metadata: { jobId: id, candidateId: deleted.candidateId },
  })

  setResponseStatus(event, 204)
  return null
})
