import { eq, and, sql } from 'drizzle-orm'
import { jobClientContact } from '../../../../database/schema'
import { idParamSchema } from '../../../../utils/schemas/job'
import { createJobContactSchema } from '../../../../utils/schemas/person'
import { isUniqueViolation } from '../../../../utils/candidateEmail'

/**
 * POST /api/jobs/:id/contacts
 * Link a job to a client contact. The person must hold an ACTIVE
 * client_contact role (app-enforced per design; the role's company is NOT
 * required to match the job — design has no company↔job rule).
 * isPrimary=true clears other primaries in the same tx (job row locked
 * FOR UPDATE); the partial unique index is the race backstop → 409.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readBody422(event, createJobContactSchema)

  let linkRow: typeof jobClientContact.$inferSelect
  try {
    linkRow = await db.transaction(async (tx) => {
      // Lock the job row — serializes primary-contact mutations on it
      const lockedJob = await tx.execute(sql`
        SELECT id FROM job WHERE id = ${id} AND organization_id = ${orgId} FOR UPDATE
      `)
      if (lockedJob.length === 0) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' })
      }

      // Person must exist in this org
      const person = await tx.execute(sql`
        SELECT id FROM candidate WHERE id = ${body.candidateId} AND organization_id = ${orgId}
      `)
      if (person.length === 0) {
        throw createError({ statusCode: 404, statusMessage: 'Candidate not found' })
      }

      // …and hold an ACTIVE client_contact role
      const activeRole = await tx.execute(sql`
        SELECT id FROM person_role
        WHERE candidate_id = ${body.candidateId}
          AND organization_id = ${orgId}
          AND role = 'client_contact'
          AND ended_at IS NULL
        LIMIT 1
      `)
      if (activeRole.length === 0) {
        throw createError({
          statusCode: 422,
          statusMessage: 'Person must have an active client_contact role',
        })
      }

      if (body.isPrimary) {
        await tx.update(jobClientContact)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(and(
            eq(jobClientContact.organizationId, orgId),
            eq(jobClientContact.jobId, id),
          ))
      }

      const [inserted] = await tx.insert(jobClientContact).values({
        organizationId: orgId,
        jobId: id,
        candidateId: body.candidateId,
        label: body.label || null,
        isPrimary: body.isPrimary ?? false,
      }).returning()

      if (!inserted) {
        throw createError({ statusCode: 500, statusMessage: 'Insert failed' })
      }
      return inserted
    })
  }
  catch (err) {
    if (isUniqueViolation(err)) {
      // Duplicate (job_id, candidate_id) link — or a lost primary race
      throw createError({ statusCode: 409, statusMessage: 'Contact already linked to this job' })
    }
    throw err
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'job_client_contact',
    resourceId: linkRow.id,
    metadata: {
      jobId: id,
      candidateId: body.candidateId,
      label: linkRow.label,
      isPrimary: linkRow.isPrimary,
    },
  })

  setResponseStatus(event, 201)
  return linkRow
})
