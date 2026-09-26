import { eq, and, sql } from 'drizzle-orm'
import { clientCompany } from '../../database/schema'
import { idParamSchema } from '../../utils/schemas/job'
import { updateClientCompanySchema } from '../../utils/schemas/person'
import { isUniqueViolation } from '../../utils/candidateEmail'

/**
 * PATCH /api/client-companies/:id
 * Rename recomputes normalized_name (Postgres lower(btrim(name)));
 * collision → 409. Website can be set or cleared (null).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readBody422(event, updateClientCompanySchema)

  const existing = await db.query.clientCompany.findFirst({
    where: and(eq(clientCompany.id, id), eq(clientCompany.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  let updated: typeof clientCompany.$inferSelect
  try {
    const [result] = await db.update(clientCompany)
      .set({
        ...(body.name !== undefined
          ? { name: body.name, normalizedName: sql`lower(btrim(${body.name}))` }
          : {}),
        ...(body.website !== undefined ? { website: body.website || null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(clientCompany.id, id), eq(clientCompany.organizationId, orgId)))
      .returning()
    if (!result) {
      throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }
    updated = result
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
    action: 'updated',
    resourceType: 'client_company',
    resourceId: id,
    metadata: { name: updated.name },
  })

  return updated
})
