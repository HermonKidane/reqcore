import { eq, and } from 'drizzle-orm'
import { task, candidate, job, application, recruitmentStepInstance, aiRun, member } from '../database/schema'
import type { CreateTaskInput } from './schemas/task'
import { queueTaskSync } from './graph/sync'

/**
 * Task creation shared by POST /api/tasks, /api/tasks/bulk and system-made
 * tasks (privacy-notice reminders). Every linked id is checked against the
 * org — a cross-tenant link is a 404, never a silent null.
 */
export async function assertTaskLinks(orgId: string, input: Pick<CreateTaskInput, 'ownerId' | 'candidateId' | 'jobId' | 'applicationId' | 'stepInstanceId' | 'aiRunId'>): Promise<void> {
  const checks: Promise<unknown>[] = []
  const nf = (what: string) => Promise.reject(createError({ statusCode: 404, statusMessage: `${what} not found` }))
  if (input.ownerId) {
    checks.push(db.query.member.findFirst({
      where: and(eq(member.userId, input.ownerId), eq(member.organizationId, orgId)),
      columns: { id: true },
    }).then(r => r ?? Promise.reject(createError({ statusCode: 422, statusMessage: 'Owner is not a member of this organization' }))))
  }
  if (input.candidateId) {
    checks.push(db.query.candidate.findFirst({ where: and(eq(candidate.id, input.candidateId), eq(candidate.organizationId, orgId)), columns: { id: true } }).then(r => r ?? nf('Candidate')))
  }
  if (input.jobId) {
    checks.push(db.query.job.findFirst({ where: and(eq(job.id, input.jobId), eq(job.organizationId, orgId)), columns: { id: true } }).then(r => r ?? nf('Job')))
  }
  if (input.applicationId) {
    checks.push(db.query.application.findFirst({ where: and(eq(application.id, input.applicationId), eq(application.organizationId, orgId)), columns: { id: true } }).then(r => r ?? nf('Application')))
  }
  if (input.stepInstanceId) {
    checks.push(db.query.recruitmentStepInstance.findFirst({
      where: eq(recruitmentStepInstance.id, input.stepInstanceId),
      with: { workflow: { columns: { organizationId: true } } },
    }).then(r => (r && r.workflow.organizationId === orgId) ? r : nf('Step')))
  }
  if (input.aiRunId) {
    checks.push(db.query.aiRun.findFirst({ where: and(eq(aiRun.id, input.aiRunId), eq(aiRun.organizationId, orgId)), columns: { id: true } }).then(r => r ?? nf('AI run')))
  }
  await Promise.all(checks)
}

export async function createTask(params: {
  orgId: string
  createdById: string
  input: CreateTaskInput
  source: 'manual' | 'ai_run' | 'system'
}): Promise<typeof task.$inferSelect> {
  const { orgId, createdById, input, source } = params
  await assertTaskLinks(orgId, input)
  const [row] = await db.insert(task).values({
    organizationId: orgId,
    title: input.title,
    notes: input.notes ?? null,
    dueAt: input.dueAt ?? null,
    allDay: input.allDay ?? true,
    ownerId: input.ownerId ?? createdById,
    candidateId: input.candidateId ?? null,
    jobId: input.jobId ?? null,
    applicationId: input.applicationId ?? null,
    stepInstanceId: input.stepInstanceId ?? null,
    source,
    aiRunId: input.aiRunId ?? null,
    createdById,
  }).returning()
  if (!row) throw createError({ statusCode: 500, statusMessage: 'Failed to create task' })
  queueTaskSync(row.id)
  return row
}

/** The list/detail shape: task + its links' display names + sync state. */
export const taskWith = {
  owner: { columns: { id: true, name: true } },
  candidate: { columns: { id: true, firstName: true, lastName: true } },
  job: { columns: { id: true, title: true } },
  application: { columns: { id: true } },
  syncs: { columns: { provider: true, state: true, error: true, todoTaskId: true, outlookEventId: true, lastSyncedAt: true } },
} as const
