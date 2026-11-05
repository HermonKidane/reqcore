import { eq, and, desc } from 'drizzle-orm'
import { candidate, representationConsent } from '../../../../database/schema'
import { candidateIdParamSchema } from '../../../../utils/schemas/candidate'

/** GET /api/candidates/:id/consents — candidate:read. Active first, newest first. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  const person = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true },
  })
  if (!person) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const rows = await db.query.representationConsent.findMany({
    where: and(eq(representationConsent.candidateId, id), eq(representationConsent.organizationId, orgId)),
    with: { recordedBy: { columns: { id: true, name: true } } },
    orderBy: [desc(representationConsent.givenAt)],
  })
  rows.sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt))
  return { consents: rows }
})
