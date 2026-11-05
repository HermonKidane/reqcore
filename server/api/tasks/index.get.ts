import { eq, and, lt, gte, isNull, isNotNull, asc, desc, sql } from 'drizzle-orm'
import { task } from '../../database/schema'
import { taskQuerySchema } from '../../utils/schemas/task'
import { taskWith } from '../../utils/tasks'

/**
 * GET /api/tasks — task:read
 * ?scope=mine|all (all = owners/admins) &status=open|done|cancelled
 * &due=overdue|today|week|later|none|any &candidateId &applicationId &jobId &limit
 * Ordered: due first (nulls last), then newest. Day boundaries are server
 * UTC for now (TODO: Europe/London once the org has a timezone setting).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { task: ['read'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const query = await getValidatedQuery(event, taskQuerySchema.parse)

  if (query.scope === 'all') {
    // Only owners/admins may see everyone's list
    const role = (session as any).role ?? null
    const membership = await db.query.member.findFirst({
      where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.organizationId, orgId)),
      columns: { role: true },
    })
    const r = membership?.role ?? role
    if (r !== 'owner' && r !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: 'Only admins can see everyone\'s tasks' })
    }
  }

  const now = new Date()
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const endOfToday = new Date(startOfToday.getTime() + 24 * 3600 * 1000)
  const endOfWeek = new Date(startOfToday.getTime() + 7 * 24 * 3600 * 1000)

  const conds = [eq(task.organizationId, orgId), eq(task.status, query.status)]
  if (query.scope === 'mine') conds.push(eq(task.ownerId, userId))
  if (query.candidateId) conds.push(eq(task.candidateId, query.candidateId))
  if (query.applicationId) conds.push(eq(task.applicationId, query.applicationId))
  if (query.jobId) conds.push(eq(task.jobId, query.jobId))
  switch (query.due) {
    case 'overdue': conds.push(isNotNull(task.dueAt), lt(task.dueAt, startOfToday)); break
    case 'today': conds.push(gte(task.dueAt, startOfToday), lt(task.dueAt, endOfToday)); break
    case 'week': conds.push(gte(task.dueAt, endOfToday), lt(task.dueAt, endOfWeek)); break
    case 'later': conds.push(gte(task.dueAt, endOfWeek)); break
    case 'none': conds.push(isNull(task.dueAt)); break
  }

  const rows = await db.query.task.findMany({
    where: and(...conds),
    with: taskWith,
    orderBy: [sql`${task.dueAt} ASC NULLS LAST`, desc(task.createdAt), asc(task.id)],
    limit: query.limit,
  })

  return { tasks: rows, total: rows.length, now: now.toISOString() }
})
