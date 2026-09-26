import { eq, and, desc, sql } from 'drizzle-orm'
import { clientCompany, personRole, candidate, candidateEmail } from '../../database/schema'
import { idParamSchema } from '../../utils/schemas/job'

/**
 * GET /api/client-companies/:id
 * Company detail + its contacts (people with a client_contact role here,
 * one entry per person — active if they hold ANY active client_contact role
 * here). primaryEmail comes from the ACTIVE PRIMARY candidate_email row
 * (not the candidate.email cache, which has documented exceptions).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const company = await db.query.clientCompany.findFirst({
    where: and(eq(clientCompany.id, id), eq(clientCompany.organizationId, orgId)),
  })
  if (!company) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const rows = await db
    .select({
      candidateId: candidate.id,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      roleStartedAt: personRole.startedAt,
      roleEndedAt: personRole.endedAt,
      primaryEmail: candidateEmail.email,
    })
    .from(personRole)
    .innerJoin(candidate, eq(candidate.id, personRole.candidateId))
    .leftJoin(candidateEmail, and(
      eq(candidateEmail.candidateId, candidate.id),
      eq(candidateEmail.isPrimary, true),
    ))
    .where(and(
      eq(personRole.organizationId, orgId),
      eq(personRole.clientCompanyId, id),
      eq(personRole.role, 'client_contact'),
    ))
    .orderBy(
      sql`case when ${personRole.endedAt} is null then 0 else 1 end`,
      desc(personRole.endedAt),
      desc(personRole.startedAt),
    )

  // Collapse to one entry per person (restart history = multiple rows)
  const byPerson = new Map<string, {
    candidateId: string
    firstName: string
    lastName: string
    active: boolean
    startedAt: Date
    endedAt: Date | null
    primaryEmail: string | null
  }>()

  for (const row of rows) {
    const existing = byPerson.get(row.candidateId)
    if (!existing) {
      byPerson.set(row.candidateId, {
        candidateId: row.candidateId,
        firstName: row.firstName,
        lastName: row.lastName,
        active: row.roleEndedAt === null,
        startedAt: row.roleStartedAt,
        endedAt: row.roleEndedAt,
        primaryEmail: row.primaryEmail,
      })
    }
    else {
      existing.active = existing.active || row.roleEndedAt === null
      if (row.roleStartedAt < existing.startedAt) existing.startedAt = row.roleStartedAt
      if (row.roleEndedAt && (!existing.endedAt || row.roleEndedAt > existing.endedAt)) {
        existing.endedAt = row.roleEndedAt
      }
      existing.primaryEmail = existing.primaryEmail ?? row.primaryEmail
    }
  }

  // Tenure semantics: an ACTIVE contact with restart history shows
  // endedAt = null (they are still here); startedAt = first start.
  for (const contact of byPerson.values()) {
    if (contact.active) contact.endedAt = null
  }

  // Active contacts first (rows already ordered; Map preserves insertion order)
  const contacts = [...byPerson.values()]

  return { ...company, contacts }
})
