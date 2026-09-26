import { eq, and, sql } from 'drizzle-orm'
import { personRole } from '../../database/schema'
import { idParamSchema } from '../../utils/schemas/job'
import { updatePersonRoleSchema } from '../../utils/schemas/person'

/**
 * PATCH /api/person-roles/:id
 * The ONLY person_role mutation after insert: { action: 'end' } sets
 * ended_at = now (immutable history — no DELETE, no other UPDATE).
 * Double-end → 409. Person row locked FOR UPDATE to serialize.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readBody422(event, updatePersonRoleSchema)
  void body // only 'end' exists today

  const updated = await db.transaction(async (tx) => {
    const locked = await tx.execute<{
      id: string
      role: string
      client_company_id: string | null
      candidate_id: string
      ended_at: string | null
    }>(sql`
      SELECT id, role, client_company_id, candidate_id, ended_at
      FROM person_role
      WHERE id = ${id} AND organization_id = ${orgId}
      FOR UPDATE
    `)
    const row = locked[0]
    if (!row) {
      throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }
    if (row.ended_at !== null) {
      throw createError({ statusCode: 409, statusMessage: 'Role already ended' })
    }

    // Lock the person row too — serializes against concurrent role starts
    // (restarts) on the same person, per the spec's lock discipline
    await tx.execute(sql`
      SELECT id FROM candidate WHERE id = ${row.candidate_id} AND organization_id = ${orgId} FOR UPDATE
    `)

    const [updated] = await tx.update(personRole)
      .set({ endedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(personRole.id, id), eq(personRole.organizationId, orgId)))
      .returning()

    return { updated, row }
  })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'status_changed',
    resourceType: 'person_role',
    resourceId: id,
    metadata: {
      role: updated.row.role,
      from: 'active',
      to: 'ended',
      companyId: updated.row.client_company_id,
    },
  })

  return updated.updated
})
