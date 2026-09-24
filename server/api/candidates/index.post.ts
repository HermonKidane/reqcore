import { eq } from 'drizzle-orm'
import { candidate } from '../../database/schema'
import { createCandidateSchema } from '../../utils/schemas/candidate'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, createCandidateSchema.parse)

  let created:
    | { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; createdAt: Date; updatedAt: Date }
    | undefined

  try {
    ;[created] = await db.transaction(async (tx) => {
      // Uniqueness check via candidate_email (org-wide, normalized) — not the cache
      const existingId = await findCandidateIdByEmail(tx, orgId, body.email)
      if (existingId) {
        throw createError({
          statusCode: 409,
          statusMessage: 'A candidate with this email already exists',
        })
      }

      // Cache starts NULL; the helper is the ONLY writer of candidate.email
      const [created] = await tx.insert(candidate).values({
        organizationId: orgId,
        firstName: body.firstName,
        lastName: body.lastName,
        email: null,
        phone: body.phone,
      }).returning({
        id: candidate.id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email,
        phone: candidate.phone,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
      })

      if (!created) {
        throw createError({ statusCode: 500, statusMessage: 'Failed to create candidate' })
      }

      // Primary email row + cache sync, same transaction (single code path)
      await insertPrimaryEmail(tx, orgId, created.id, body.email, { source: 'manual' })

      // Re-select so the response carries the synced cache value
      const [synced] = await tx.select({
        id: candidate.id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email,
        phone: candidate.phone,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
      }).from(candidate).where(eq(candidate.id, created.id))

      return [synced!]
    })
  }
  catch (err) {
    // Lost race: another request created the same normalized email concurrently
    if (isUniqueViolation(err)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A candidate with this email already exists',
      })
    }
    throw err
  }

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to create candidate' })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'candidate',
    resourceId: created.id,
    metadata: { name: `${created.firstName} ${created.lastName}` },
  })

  setResponseStatus(event, 201)
  return created
})
