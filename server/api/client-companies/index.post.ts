import { sql } from 'drizzle-orm'
import { clientCompany } from '../../database/schema'
import { createClientCompanySchema } from '../../utils/schemas/person'
import { isUniqueViolation } from '../../utils/candidateEmail'

/**
 * POST /api/client-companies
 * normalized_name is ALWAYS computed by Postgres (lower(btrim(name))).
 * 409 on normalized-name duplicate (case/whitespace-insensitive).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const body = await readBody422(event, createClientCompanySchema)

  let company: typeof clientCompany.$inferSelect
  try {
    const [inserted] = await db.insert(clientCompany).values({
      organizationId: orgId,
      name: body.name,
      normalizedName: sql`lower(btrim(${body.name}))`,
      website: body.website || null,
    }).returning()
    if (!inserted) {
      throw createError({ statusCode: 500, statusMessage: 'Insert failed' })
    }
    company = inserted
  }
  catch (err) {
    if (isUniqueViolation(err)) {
      throw createError({ statusCode: 409, statusMessage: 'Company already exists' })
    }
    throw err
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'client_company',
    resourceId: company.id,
    metadata: { name: company.name },
  })

  setResponseStatus(event, 201)
  return company
})
