import { eq, and, or, ilike, desc, sql, count } from 'drizzle-orm'
import { clientCompany, personRole } from '../../database/schema'
import { clientCompanyQuerySchema } from '../../utils/schemas/person'

/**
 * GET /api/client-companies
 * List client companies with active client_contact counts.
 * Optional name search (LIKE meta-characters escaped).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const query = await getValidatedQuery(event, clientCompanyQuerySchema.parse)
  const offset = (query.page - 1) * query.limit

  const conditions = [eq(clientCompany.organizationId, orgId)]
  if (query.search) {
    const escaped = query.search.replace(/[%_\\]/g, '\\$&')
    conditions.push(ilike(clientCompany.name, `%${escaped}%`))
  }
  const where = and(...conditions)

  const [data, total] = await Promise.all([
    db
      .select({
        id: clientCompany.id,
        name: clientCompany.name,
        website: clientCompany.website,
        createdAt: clientCompany.createdAt,
        activeContactCount: sql<number>`count(${personRole.id}) filter (where ${personRole.role} = 'client_contact' and ${personRole.endedAt} is null)::int`,
      })
      .from(clientCompany)
      .leftJoin(personRole, eq(personRole.clientCompanyId, clientCompany.id))
      .where(where)
      .groupBy(clientCompany.id)
      .orderBy(desc(clientCompany.createdAt))
      .limit(query.limit)
      .offset(offset),
    db.$count(clientCompany, where),
  ])

  return { data, total, page: query.page, limit: query.limit }
})
