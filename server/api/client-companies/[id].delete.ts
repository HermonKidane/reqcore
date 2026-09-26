import { eq, and } from 'drizzle-orm'
import { clientCompany } from '../../database/schema'
import { idParamSchema } from '../../utils/schemas/job'
import { isFkViolation } from '../../utils/candidateEmail'

/**
 * DELETE /api/client-companies/:id
 * Hard delete. The DB enforces the gate: person_role references the company
 * with ON DELETE RESTRICT → any role history raises SQLSTATE 23503, caught
 * here and mapped to 409 (the FK is the only reliable gate — a role can be
 * created between any pre-check and the delete). No pre-check shortcut.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const existing = await db.query.clientCompany.findFirst({
    where: and(eq(clientCompany.id, id), eq(clientCompany.organizationId, orgId)),
    columns: { id: true, name: true },
  })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  try {
    await db.delete(clientCompany)
      .where(and(eq(clientCompany.id, id), eq(clientCompany.organizationId, orgId)))
  }
  catch (err) {
    if (isFkViolation(err)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Company has role history and cannot be deleted',
      })
    }
    throw err
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'deleted',
    resourceType: 'client_company',
    resourceId: id,
    metadata: { name: existing.name },
  })

  setResponseStatus(event, 204)
  return null
})
