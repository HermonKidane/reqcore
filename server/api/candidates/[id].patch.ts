import { eq, and, sql } from 'drizzle-orm'
import { candidate } from '../../database/schema'
import { candidateIdParamSchema, updateCandidateSchema } from '../../utils/schemas/candidate'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)
  const body = await readValidatedBody(event, updateCandidateSchema.parse)

  let updated:
    | { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; createdAt: Date; updatedAt: Date }
    | undefined

  try {
    ;[updated] = await db.transaction(async (tx) => {
      // Lock the candidate row first (serializes concurrent email mutations)
      const locked = await tx.execute(sql`
        SELECT id FROM candidate WHERE id = ${id} AND organization_id = ${orgId} FOR UPDATE
      `)
      if (locked.length === 0) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' })
      }

      // Email change = primary replacement via the single email code path
      if (body.email) {
        const conflict = await emailOwnedByOtherCandidate(tx, orgId, body.email, id)
        if (conflict) {
          throw createError({
            statusCode: 409,
            statusMessage: 'A candidate with this email already exists',
          })
        }
        await replacePrimaryEmail(tx, orgId, id, body.email, { source: 'manual' })
      }

      const { email: _email, ...rest } = body
      const [updated] = await tx.update(candidate)
        .set({ ...rest, updatedAt: new Date() })
        .where(and(eq(candidate.id, id), eq(candidate.organizationId, orgId)))
        .returning({
          id: candidate.id,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          email: candidate.email,
          phone: candidate.phone,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt,
        })

      if (!updated) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' })
      }

      return [updated]
    })
  }
  catch (err) {
    // e.g. new primary collides with this candidate's own secondary row
    if (isUniqueViolation(err)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A candidate with this email already exists',
      })
    }
    throw err
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'candidate',
    resourceId: id,
    metadata: { name: `${updated.firstName} ${updated.lastName}` },
  })

  return updated
})
