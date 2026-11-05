import { eq, and, inArray } from 'drizzle-orm'
import { candidate, clientCompany, representationConsent } from '../../../../database/schema'
import { candidateIdParamSchema } from '../../../../utils/schemas/candidate'
import { createConsentSchema } from '../../../../utils/schemas/consent'

/**
 * POST /api/candidates/:id/consents — candidate:update
 * Records that the candidate agreed to be put forward (scope, when, how, their
 * words). Named clients must exist in the org. Rows are never edited; revoke
 * via PATCH and add a new one.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)
  const body = await readBody422(event, createConsentSchema)

  const person = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true, firstName: true, lastName: true },
  })
  if (!person) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const companyIds = body.scope === 'named_clients' ? [...new Set(body.clientCompanyIds)] : []
  if (companyIds.length > 0) {
    const found = await db.query.clientCompany.findMany({
      where: and(inArray(clientCompany.id, companyIds), eq(clientCompany.organizationId, orgId)),
      columns: { id: true },
    })
    if (found.length !== companyIds.length) {
      throw createError({ statusCode: 422, statusMessage: 'One of the named clients does not exist in this organization' })
    }
  }

  const [row] = await db.insert(representationConsent).values({
    organizationId: orgId,
    candidateId: id,
    scope: body.scope,
    clientCompanyIds: companyIds,
    roleTypes: body.scope === 'role_types' ? body.roleTypes : [],
    givenAt: body.givenAt,
    channel: body.channel,
    evidenceQuote: body.evidenceQuote,
    recordedById: userId,
  }).returning()
  if (!row) throw createError({ statusCode: 500, statusMessage: 'Failed to record consent' })

  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'created',
    resourceType: 'representation_consent',
    resourceId: row.id,
    metadata: { candidateId: id, name: `${person.firstName} ${person.lastName}`, scope: row.scope, channel: row.channel },
  }).catch(() => {})

  setResponseStatus(event, 201)
  return row
})
