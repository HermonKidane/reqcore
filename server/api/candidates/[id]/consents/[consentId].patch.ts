import { eq, and, isNull } from 'drizzle-orm'
import { representationConsent } from '../../../../database/schema'
import { consentParamsSchema, revokeConsentSchema } from '../../../../utils/schemas/consent'

/**
 * PATCH /api/candidates/:id/consents/:consentId — candidate:update
 * The only mutation: revoke (sets revokedAt + reason). Already revoked → 409.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { id, consentId } = await getValidatedRouterParams(event, consentParamsSchema.parse)
  const body = await readBody422(event, revokeConsentSchema)

  const [row] = await db.update(representationConsent)
    .set({ revokedAt: new Date(), revokedReason: body.revokedReason ?? null })
    .where(and(
      eq(representationConsent.id, consentId),
      eq(representationConsent.candidateId, id),
      eq(representationConsent.organizationId, orgId),
      isNull(representationConsent.revokedAt),
    ))
    .returning()
  if (!row) {
    const exists = await db.query.representationConsent.findFirst({
      where: and(eq(representationConsent.id, consentId), eq(representationConsent.organizationId, orgId)),
      columns: { id: true },
    })
    throw createError(exists
      ? { statusCode: 409, statusMessage: 'This consent is already revoked' }
      : { statusCode: 404, statusMessage: 'Not found' })
  }

  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'updated',
    resourceType: 'representation_consent',
    resourceId: row.id,
    metadata: { candidateId: id, revoked: true, reason: row.revokedReason },
  }).catch(() => {})

  return row
})
