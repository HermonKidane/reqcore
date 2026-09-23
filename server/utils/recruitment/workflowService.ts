import { eq, and, asc, desc, sql } from 'drizzle-orm'
import {
  recruitmentProcessTemplate,
  recruitmentStepTemplate,
  recruitmentWorkflow,
  recruitmentStepInstance,
  recruitmentStepEvent,
  type RecruitmentStepStatus,
} from '../../database/schema'
import {
  CANONICAL_PROCESS_NAME,
  CANONICAL_PROCESS_VERSION,
  CANONICAL_STEPS,
} from '~~/shared/recruitment/canonical-steps'

/**
 * ─────────────────────────────────────────────────────────────────────
 * Recruitment workflow service — lazy, idempotent, race-safe creation of
 * process templates, workflows, and step instances.
 *
 * The canonical 30 steps are seeded as versioned DATA per org on
 * first use (no manual seed step required for new orgs).
 *
 * Race safety: partial unique indexes (one default template per org,
 * one active workflow per application) + INSERT ... ON CONFLICT DO
 * NOTHING + re-read. Concurrent first-views can never duplicate.
 *
 * Self-healing: every ensure step backfills missing rows
 * (step templates, instances) rather than assuming a prior call
 * completed — a crash mid-seed repairs itself on the next call.
 * ─────────────────────────────────────────────────────────────────────
 */

/**
 * Ensure the org has a COMPLETE default process template (header +
 * all 30 step templates). Returns the template id.
 */
export async function ensureDefaultProcessTemplate(orgId: string): Promise<string> {
  const find = () => db.query.recruitmentProcessTemplate.findFirst({
    where: and(
      eq(recruitmentProcessTemplate.organizationId, orgId),
      eq(recruitmentProcessTemplate.isDefault, true),
    ),
  })

  const existing = await find()
  if (existing) {
    // Self-heal: a template row may exist without its step templates
    // (interrupted seed). Backfill idempotently and return.
    await ensureCanonicalStepTemplates(existing.id)
    return existing.id
  }

  // Best-effort insert; a concurrent request may win — the partial unique
  // index turns the race into a no-op. Re-read with retries: under READ
  // COMMITTED the winner's row may not be committed yet when we re-read.
  await db.insert(recruitmentProcessTemplate)
    .values({
      organizationId: orgId,
      name: CANONICAL_PROCESS_NAME,
      version: CANONICAL_PROCESS_VERSION,
      isDefault: true,
    })
    .onConflictDoNothing()

  const winner = await withRetry(find)
  if (!winner) {
    throw new Error(`Failed to create default process template for org ${orgId}`)
  }

  await ensureCanonicalStepTemplates(winner.id)
  return winner.id
}

/**
 * Idempotently insert all canonical step templates for a template.
 * Unique (templateId, stepNumber) + ON CONFLICT DO NOTHING makes
 * concurrent or repeated calls harmless; also repairs partial seeds.
 */
async function ensureCanonicalStepTemplates(templateId: string): Promise<void> {
  await db.insert(recruitmentStepTemplate)
    .values(CANONICAL_STEPS.map(s => ({
      templateId,
      stepNumber: s.stepNumber,
      phase: s.phase,
      key: s.key,
      name: s.name,
      description: s.description,
      requiredFields: s.requiredFields,
      completionRules: s.completionRules,
      displayOrder: s.stepNumber,
    })))
    .onConflictDoNothing()
}

/**
 * Ensure an active workflow with a COMPLETE set of step instances
 * exists for an application. Returns the workflow id.
 */
export async function ensureApplicationWorkflow(
  orgId: string,
  app: { id: string, jobId: string },
): Promise<string> {
  const findActive = () => db.query.recruitmentWorkflow.findFirst({
    where: and(
      eq(recruitmentWorkflow.organizationId, orgId),
      eq(recruitmentWorkflow.applicationId, app.id),
      eq(recruitmentWorkflow.status, 'active'),
    ),
  })

  const existing = await findActive()
  if (existing) {
    await ensureStepInstances(orgId, existing.id, existing.templateId)
    return existing.id
  }

  // No active workflow: if a terminal workflow (completed/cancelled)
  // exists, return it as-is. Reopening must be an explicit future
  // operation — never a side effect of a GET (would reset progress).
  const terminal = await db.query.recruitmentWorkflow.findFirst({
    where: and(
      eq(recruitmentWorkflow.organizationId, orgId),
      eq(recruitmentWorkflow.applicationId, app.id),
    ),
    orderBy: desc(recruitmentWorkflow.startedAt),
  })
  if (terminal) return terminal.id

  const templateId = await ensureDefaultProcessTemplate(orgId)

  await db.insert(recruitmentWorkflow)
    .values({
      organizationId: orgId,
      jobId: app.jobId,
      applicationId: app.id,
      templateId,
      status: 'active',
    })
    .onConflictDoNothing()

  const workflow = await withRetry(findActive)
  if (!workflow) {
    throw new Error(`Failed to create workflow for application ${app.id}`)
  }

  await ensureStepInstances(orgId, workflow.id, workflow.templateId)
  return workflow.id
}

/**
 * Idempotently create step instances (with 'created' events) for every
 * step template that doesn't have one yet. Repairs partial instance
 * sets after an interrupted creation.
 */
async function ensureStepInstances(
  orgId: string,
  workflowId: string,
  templateId: string,
): Promise<void> {
  const steps = await db.query.recruitmentStepTemplate.findMany({
    where: eq(recruitmentStepTemplate.templateId, templateId),
    orderBy: asc(recruitmentStepTemplate.displayOrder),
  })
  if (steps.length === 0) return // template not yet seeded; next call repairs

  const stepById = new Map(steps.map(s => [s.id, s]))

  await db.transaction(async (tx) => {
    // Unique (workflowId, stepTemplateId) + ON CONFLICT DO NOTHING;
    // RETURNING yields only rows actually inserted by THIS call.
    const created = await tx.insert(recruitmentStepInstance)
      .values(steps.map(st => ({
        workflowId,
        stepTemplateId: st.id,
        status: 'pending' as RecruitmentStepStatus,
      })))
      .onConflictDoNothing()
      .returning({ id: recruitmentStepInstance.id, stepTemplateId: recruitmentStepInstance.stepTemplateId })

    if (created.length > 0) {
      await tx.insert(recruitmentStepEvent).values(
        created.map(i => ({
          organizationId: orgId,
          stepInstanceId: i.id,
          eventType: 'created' as const,
          source: 'system',
          payload: {
            stepNumber: stepById.get(i.stepTemplateId)?.stepNumber,
            key: stepById.get(i.stepTemplateId)?.key,
            fromStatus: null,
            toStatus: 'pending',
          },
        })),
      )
    }
  })
}

/**
 * Retry a read until it returns a row (short backoff). Covers the
 * window where a concurrent creator's insert is committed between
 * our ON CONFLICT DO NOTHING and our re-read (READ COMMITTED).
 */
async function withRetry<T>(find: () => Promise<T | undefined>, attempts = 4): Promise<T | undefined> {
  for (let i = 0; i < attempts; i++) {
    const row = await find()
    if (row) return row
    await new Promise(res => setTimeout(res, 50 * (i + 1)))
  }
  return undefined
}

/**
 * Append an immutable step event.
 */export async function recordStepEvent(params: {
  organizationId: string
  stepInstanceId: string
  actorId?: string | null
  eventType: typeof recruitmentStepEvent.$inferInsert.eventType
  payload?: Record<string, unknown>
  source?: string
}): Promise<void> {
  await db.insert(recruitmentStepEvent).values({
    organizationId: params.organizationId,
    stepInstanceId: params.stepInstanceId,
    actorId: params.actorId ?? null,
    eventType: params.eventType,
    payload: params.payload ?? null,
    source: params.source ?? 'user',
  })
}

/**
 * If every instance of the workflow is in a terminal state (completed
 * or skipped), mark the workflow completed. Requires at least one
 * instance (an empty workflow is never "done"). Conditional UPDATE:
 * never overwrites a cancelled workflow, and the NOT EXISTS guard
 * keeps it convergent. Also called from the GET endpoint as a
 * self-heal for any missed convergence.
 */
export async function completeWorkflowIfDone(workflowId: string): Promise<boolean> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE recruitment_workflow
    SET status = 'completed', completed_at = ${new Date()}
    WHERE id = ${workflowId}
      AND status = 'active'
      AND EXISTS (SELECT 1 FROM recruitment_step_instance WHERE workflow_id = ${workflowId})
      AND NOT EXISTS (
        SELECT 1 FROM recruitment_step_instance
        WHERE workflow_id = ${workflowId}
          AND status NOT IN ('completed', 'skipped')
      )
    RETURNING id
  `)
  return result.length > 0
}
