import { eq, and, inArray } from 'drizzle-orm'
import {
  member,
  recruitmentStepInstance,
  recruitmentStepEvent,
  type RecruitmentStepStatus,
} from '../../database/schema'
import { stepInstanceIdParamSchema, updateStepInstanceSchema } from '../../utils/schemas/recruitment'
import { completeWorkflowIfDone } from '../../utils/recruitment/workflowService'

/**
 * PATCH /api/step-instances/:id
 * Step instance state machine:
 *   start    pending|blocked              → in_progress
 *   complete pending|in_progress|blocked  → completed (required fields enforced)
 *   block    pending|in_progress          → blocked (reason required)
 *   unblock  blocked                      → pending
 *   skip     pending|in_progress|blocked  → skipped
 *   update   patch dueAt / assignedToId / riskLevel / completionData (non-terminal)
 *
 * Race-safe: transitions use conditional UPDATE ... WHERE status IN (from)
 * — concurrent mutations fail with 409 instead of clobbering.
 * Atomic: state change + immutable event are committed together.
 * Completing directly from blocked is intentional (blocker resolved in
 * one action — the event trail records the fromStatus).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { workflow: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const { id } = await getValidatedRouterParams(event, stepInstanceIdParamSchema.parse)
  const body = await readValidatedBody(event, updateStepInstanceSchema.parse)

  // Load instance scoped through its workflow's organization
  const instance = await db.query.recruitmentStepInstance.findFirst({
    where: eq(recruitmentStepInstance.id, id),
    with: {
      stepTemplate: { columns: { id: true, name: true, requiredFields: true } },
      workflow: { columns: { id: true, organizationId: true, applicationId: true, status: true } },
    },
  })

  if (!instance || instance.workflow.organizationId !== orgId) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // A cancelled workflow is immutable — no step mutations
  if (instance.workflow.status === 'cancelled') {
    throw createError({ statusCode: 409, statusMessage: 'Workflow is cancelled' })
  }

  const TERMINAL: RecruitmentStepStatus[] = ['completed', 'skipped']
  if (TERMINAL.includes(instance.status)) {
    throw createError({
      statusCode: 409,
      statusMessage: `Step is already ${instance.status} and cannot be changed`,
    })
  }

  // Validate assignee belongs to this org (FK alone can't check tenancy)
  if (body.action === 'update' && body.assignedToId) {
    const assigneeMembership = await db.query.member.findFirst({
      where: and(eq(member.userId, body.assignedToId), eq(member.organizationId, orgId)),
      columns: { id: true },
    })
    if (!assigneeMembership) {
      throw createError({ statusCode: 422, statusMessage: 'Assignee is not a member of this organization' })
    }
  }

  const now = new Date()

  /**
   * Precise non-empty rule for required completion fields:
   * strings must be non-blank; arrays/objects non-empty; false and 0 are valid values.
   */
  function isEmptyValue(v: unknown): boolean {
    if (v === undefined || v === null) return true
    if (typeof v === 'string') return v.trim() === ''
    if (Array.isArray(v)) return v.length === 0
    if (typeof v === 'object') return Object.keys(v as object).length === 0
    return false
  }

  let eventType: typeof recruitmentStepEvent.$inferInsert.eventType
  let eventPayload: Record<string, unknown> = {}
  let toStatus: RecruitmentStepStatus = instance.status
  let apply: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<boolean>

  switch (body.action) {
    case 'start': {
      eventType = 'started'
      toStatus = 'in_progress'
      apply = async tx => transition(tx, id, ['pending', 'blocked'], { status: 'in_progress', startedAt: instance.startedAt ?? now })
      break
    }

    case 'complete': {
      const merged = { ...(instance.completionData ?? {}), ...body.completionData }
      const missing = (instance.stepTemplate.requiredFields ?? []).filter(f => isEmptyValue(merged[f]))
      if (missing.length > 0) {
        throw createError({
          statusCode: 422,
          statusMessage: `Missing required fields: ${missing.join(', ')}`,
        })
      }
      eventType = 'completed'
      toStatus = 'completed'
      eventPayload = { completionData: merged }
      apply = async tx => transition(tx, id, ['pending', 'in_progress', 'blocked'], {
        status: 'completed',
        completedAt: now,
        completionData: merged,
        blockedReason: null,
      })
      break
    }

    case 'block': {
      eventType = 'blocked'
      toStatus = 'blocked'
      eventPayload = { reason: body.reason }
      apply = async tx => transition(tx, id, ['pending', 'in_progress'], { status: 'blocked', blockedReason: body.reason })
      break
    }

    case 'unblock': {
      eventType = 'unblocked'
      toStatus = 'pending'
      apply = async tx => transition(tx, id, ['blocked'], { status: 'pending', blockedReason: null })
      break
    }

    case 'skip': {
      eventType = 'skipped'
      toStatus = 'skipped'
      eventPayload = body.reason ? { reason: body.reason } : {}
      apply = async tx => transition(tx, id, ['pending', 'in_progress', 'blocked'], { status: 'skipped', completedAt: now })
      break
    }

    case 'update': {
      const set: Partial<typeof recruitmentStepInstance.$inferInsert> = {}
      const changed: string[] = []
      if (body.dueAt !== undefined) { set.dueAt = body.dueAt; changed.push('dueAt') }
      if (body.assignedToId !== undefined) { set.assignedToId = body.assignedToId; changed.push('assignedToId') }
      if (body.riskLevel !== undefined) { set.riskLevel = body.riskLevel; changed.push('riskLevel') }
      if (body.completionData) {
        set.completionData = { ...(instance.completionData ?? {}), ...body.completionData }
        changed.push('completionData')
      }
      if (changed.length === 0) {
        throw createError({ statusCode: 422, statusMessage: 'Nothing to update' })
      }
      eventType = 'updated'
      eventPayload = { changed }
      apply = async tx => transition(tx, id, ['pending', 'in_progress', 'blocked'], set)
      break
    }
  }

  // Atomic: conditional state transition + immutable event in one transaction
  const applied = await db.transaction(async (tx) => {
    const ok = await apply(tx)
    if (!ok) return false
    await tx.insert(recruitmentStepEvent).values({
      organizationId: orgId,
      stepInstanceId: id,
      actorId: userId,
      eventType,
      payload: { fromStatus: instance.status, toStatus, ...eventPayload },
      source: 'user',
    })
    return true
  })

  if (!applied) {
    throw createError({ statusCode: 409, statusMessage: 'Step status changed concurrently — refresh and retry' })
  }

  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'updated',
    resourceType: 'step_instance',
    resourceId: id,
    metadata: { step: instance.stepTemplate.name, event: eventType, applicationId: instance.workflow.applicationId },
  })

  // completed AND skipped are both terminal for workflow convergence
  if (eventType === 'completed' || eventType === 'skipped') {
    await completeWorkflowIfDone(instance.workflow.id)
  }

  const fresh = await db.query.recruitmentStepInstance.findFirst({
    where: eq(recruitmentStepInstance.id, id),
    with: {
      stepTemplate: { columns: { id: true, stepNumber: true, phase: true, key: true, name: true, description: true, requiredFields: true } },
      assignedTo: { columns: { id: true, name: true, email: true } },
    },
  })

  return fresh
})

/**
 * Conditional transition helper — lives outside the handler so the
 * switch table above stays readable.
 */
async function transition(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  id: string,
  from: RecruitmentStepStatus[],
  set: Partial<typeof recruitmentStepInstance.$inferInsert>,
) {
  const [updated] = await tx.update(recruitmentStepInstance)
    .set({ ...set, updatedAt: new Date() })
    .where(and(
      eq(recruitmentStepInstance.id, id),
      inArray(recruitmentStepInstance.status, from),
    ))
    .returning({ id: recruitmentStepInstance.id })
  return updated !== undefined
}
