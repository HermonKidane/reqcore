import { eq, and, sql } from 'drizzle-orm'
import { personRole } from '../../../../database/schema'
import { candidateIdParamSchema } from '../../../../utils/schemas/candidate'
import { createPersonRoleSchema } from '../../../../utils/schemas/person'
import { isUniqueViolation } from '../../../../utils/candidateEmail'

/**
 * POST /api/candidates/:id/roles
 * Start a role for a person. This is ALSO the restart path: an ended
 * identical role never blocks (partial unique indexes only cover active
 * rows) — restart inserts a NEW row, preserving history.
 * 409 on an identical ACTIVE role (or a lost race — unique-violation map).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)
  const body = await readBody422(event, createPersonRoleSchema)

  let roleRow: typeof personRole.$inferSelect
  try {
    roleRow = await db.transaction(async (tx) => {
      // Lock the person row — serializes concurrent role mutations on them
      const locked = await tx.execute(sql`
        SELECT id FROM candidate WHERE id = ${id} AND organization_id = ${orgId} FOR UPDATE
      `)
      if (locked.length === 0) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' })
      }

      // Company must exist in this org when required (zod already enforced
      // the required-iff-client_contact rule)
      if (body.clientCompanyId) {
        const company = await tx.execute(sql`
          SELECT id FROM client_company WHERE id = ${body.clientCompanyId} AND organization_id = ${orgId}
        `)
        if (company.length === 0) {
          throw createError({ statusCode: 404, statusMessage: 'Company not found' })
        }
      }

      const [inserted] = await tx.insert(personRole).values({
        organizationId: orgId,
        candidateId: id,
        role: body.role,
        clientCompanyId: body.clientCompanyId ?? null,
      }).returning()

      if (!inserted) {
        throw createError({ statusCode: 500, statusMessage: 'Insert failed' })
      }
      return inserted
    })
  }
  catch (err) {
    if (isUniqueViolation(err)) {
      throw createError({ statusCode: 409, statusMessage: 'Role already active' })
    }
    throw err
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'status_changed',
    resourceType: 'person_role',
    resourceId: roleRow.id,
    metadata: {
      role: roleRow.role,
      from: null,
      to: 'active',
      companyId: roleRow.clientCompanyId,
    },
  })

  setResponseStatus(event, 201)
  return {
    id: roleRow.id,
    role: roleRow.role,
    clientCompanyId: roleRow.clientCompanyId,
    startedAt: roleRow.startedAt,
    endedAt: roleRow.endedAt,
  }
})
