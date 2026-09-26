import { eq, and, desc, isNull, isNotNull } from 'drizzle-orm'
import { candidate, personRole, clientCompany } from '../../../../database/schema'
import { candidateIdParamSchema } from '../../../../utils/schemas/candidate'

/**
 * GET /api/candidates/:id/roles
 * List all roles for a person — active first (startedAt DESC), then ended
 * (endedAt DESC, startedAt DESC). Same shape/ordering as the `roles` block
 * on GET /api/candidates/:id.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  const person = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    columns: { id: true },
  })
  if (!person) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const roleColumns = {
    id: personRole.id,
    role: personRole.role,
    clientCompanyId: personRole.clientCompanyId,
    companyName: clientCompany.name,
    startedAt: personRole.startedAt,
    endedAt: personRole.endedAt,
  }

  const [active, ended] = await Promise.all([
    db
      .select(roleColumns)
      .from(personRole)
      .leftJoin(clientCompany, eq(clientCompany.id, personRole.clientCompanyId))
      .where(and(
        eq(personRole.organizationId, orgId),
        eq(personRole.candidateId, id),
        isNull(personRole.endedAt),
      ))
      .orderBy(desc(personRole.startedAt)),
    db
      .select(roleColumns)
      .from(personRole)
      .leftJoin(clientCompany, eq(clientCompany.id, personRole.clientCompanyId))
      .where(and(
        eq(personRole.organizationId, orgId),
        eq(personRole.candidateId, id),
        isNotNull(personRole.endedAt),
      ))
      .orderBy(desc(personRole.endedAt), desc(personRole.startedAt)),
  ])

  return [
    ...active.map((r) => ({ ...r, active: true })),
    ...ended.map((r) => ({ ...r, active: false })),
  ]
})
