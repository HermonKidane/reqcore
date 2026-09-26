import { eq, and, sql } from 'drizzle-orm'
import { jobClientContact } from '../../../../database/schema'
import { jobContactParamsSchema, updateJobContactSchema } from '../../../../utils/schemas/person'
import { isUniqueViolation } from '../../../../utils/candidateEmail'

/**
 * PATCH /api/jobs/:id/contacts/:linkId
 * Update a link's label and/or primary flag. Setting isPrimary=true clears
 * other primaries in the same tx (job row locked FOR UPDATE; partial unique
 * index is the backstop). Setting false is allowed — zero primaries is a
 * valid state.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id, linkId } = await getValidatedRouterParams(event, jobContactParamsSchema.parse)
  const body = await readBody422(event, updateJobContactSchema)

  let updated: typeof jobClientContact.$inferSelect
  try {
    updated = await db.transaction(async (tx) => {
      const lockedJob = await tx.execute(sql`
        SELECT id FROM job WHERE id = ${id} AND organization_id = ${orgId} FOR UPDATE
      `)
      if (lockedJob.length === 0) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' })
      }

      const [link] = await tx.update(jobClientContact)
        .set({ updatedAt: new Date() })
        .where(and(
          eq(jobClientContact.id, linkId),
          eq(jobClientContact.organizationId, orgId),
          eq(jobClientContact.jobId, id),
        ))
        .returning()

      if (!link) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' })
      }

      if (body.isPrimary === true) {
        await tx.update(jobClientContact)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(and(
            eq(jobClientContact.organizationId, orgId),
            eq(jobClientContact.jobId, id),
            sql`${jobClientContact.id} <> ${linkId}`,
          ))
        link.isPrimary = true
      }
      else if (body.isPrimary === false) {
        link.isPrimary = false
      }

      if (body.label !== undefined) {
        link.label = body.label || null
      }

      const [final] = await tx.update(jobClientContact)
        .set({ isPrimary: link.isPrimary, label: link.label, updatedAt: new Date() })
        .where(and(
          eq(jobClientContact.id, linkId),
          eq(jobClientContact.organizationId, orgId),
          eq(jobClientContact.jobId, id),
        ))
        .returning()

      if (!final) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' })
      }
      return final
    })
  }
  catch (err) {
    if (isUniqueViolation(err)) {
      // Partial-unique backstop on (job_id) WHERE is_primary — unreachable
      // while all primary writes serialize on the job lock; 409 for parity
      throw createError({ statusCode: 409, statusMessage: 'Primary contact conflict' })
    }
    throw err
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'job_client_contact',
    resourceId: linkId,
    metadata: {
      jobId: id,
      candidateId: updated.candidateId,
      label: updated.label,
      isPrimary: updated.isPrimary,
    },
  })

  return updated
})
