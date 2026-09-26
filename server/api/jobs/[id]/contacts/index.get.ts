import { eq, and, asc, desc, inArray, isNull } from 'drizzle-orm'
import { job, jobClientContact, candidate, personRole, candidateEmail } from '../../../../database/schema'
import { idParamSchema } from '../../../../utils/schemas/job'

/**
 * GET /api/jobs/:id/contacts
 * List the job's client contacts, primary first, then lastName.
 * `roleActive` = the person still holds ≥1 active client_contact role
 * (false = historical link, UI greys it). The link row survives role end.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const jobRow = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!jobRow) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const links = await db
    .select({
      id: jobClientContact.id,
      candidateId: jobClientContact.candidateId,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      label: jobClientContact.label,
      isPrimary: jobClientContact.isPrimary,
      primaryEmail: candidateEmail.email,
    })
    .from(jobClientContact)
    .innerJoin(candidate, eq(candidate.id, jobClientContact.candidateId))
    .leftJoin(candidateEmail, and(
      eq(candidateEmail.candidateId, candidate.id),
      eq(candidateEmail.isPrimary, true),
    ))
    .where(and(
      eq(jobClientContact.organizationId, orgId),
      eq(jobClientContact.jobId, id),
    ))
    .orderBy(desc(jobClientContact.isPrimary), asc(candidate.lastName), asc(candidate.firstName))

  // Batch: which of these people hold ANY active client_contact role
  const candidateIds = [...new Set(links.map((l) => l.candidateId))]
  const activeRoleIds = new Set<string>()
  if (candidateIds.length > 0) {
    const activeRows = await db
      .select({ candidateId: personRole.candidateId })
      .from(personRole)
      .where(and(
        eq(personRole.organizationId, orgId),
        eq(personRole.role, 'client_contact'),
        inArray(personRole.candidateId, candidateIds),
        isNull(personRole.endedAt),
      ))
    for (const row of activeRows) activeRoleIds.add(row.candidateId)
  }

  const data = links.map((l) => ({ ...l, roleActive: activeRoleIds.has(l.candidateId) }))
  return { data }
})
