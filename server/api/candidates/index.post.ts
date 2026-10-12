import { eq } from 'drizzle-orm'
import { candidate } from '../../database/schema'
import { createCandidateSchema } from '../../utils/schemas/candidate'
import { findCandidateIdByLinkedinUrl, canonicalLinkedinUrl } from '../../utils/linkedinUrl'

type CreatedCandidate = {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  linkedinUrl: string | null
  position: string | null
  company: string | null
  location: string | null
  headline: string | null
  summary: string | null
  createdAt: Date
  updatedAt: Date
}

const createdColumns = {
  id: candidate.id,
  firstName: candidate.firstName,
  lastName: candidate.lastName,
  email: candidate.email,
  phone: candidate.phone,
  linkedinUrl: candidate.linkedinUrl,
  position: candidate.position,
  company: candidate.company,
  location: candidate.location,
  headline: candidate.headline,
  summary: candidate.summary,
  createdAt: candidate.createdAt,
  updatedAt: candidate.updatedAt,
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, createCandidateSchema.parse)

  let created: CreatedCandidate | undefined

  try {
    ;[created] = await db.transaction(async (tx) => {
      // Uniqueness checks (org-wide, normalized) — not the cache
      if (body.email) {
        const existingId = await findCandidateIdByEmail(tx, orgId, body.email)
        if (existingId) {
          throw createError({
            statusCode: 409,
            statusMessage: 'A candidate with this email already exists',
          })
        }
      }

      if (body.linkedinUrl) {
        const linkedinTx = tx as unknown as Parameters<typeof findCandidateIdByLinkedinUrl>[0]
        const existingId = await findCandidateIdByLinkedinUrl(linkedinTx, orgId, body.linkedinUrl)
        if (existingId) {
          throw createError({
            statusCode: 409,
            statusMessage: 'A candidate with this LinkedIn URL already exists',
          })
        }
      }

      // Cache starts NULL; the helper is the ONLY writer of candidate.email
      const [created] = await tx.insert(candidate).values({
        organizationId: orgId,
        firstName: body.firstName,
        lastName: body.lastName,
        email: null,
        phone: body.phone,
        linkedinUrl: body.linkedinUrl ? canonicalLinkedinUrl(body.linkedinUrl) : null,
        position: body.position ?? null,
        company: body.company ?? null,
        location: body.location ?? null,
        headline: body.headline ?? null,
        summary: body.summary ?? null,
        // source stays default 'manual'
      }).returning(createdColumns)

      if (!created) {
        throw createError({ statusCode: 500, statusMessage: 'Failed to create candidate' })
      }

      // Primary email row + cache sync, same transaction (single code path)
      if (body.email) {
        await insertPrimaryEmail(tx, orgId, created.id, body.email, { source: 'manual' })
      }

      // Re-select so the response carries the synced cache value
      const [synced] = await tx.select(createdColumns).from(candidate).where(eq(candidate.id, created.id))

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
