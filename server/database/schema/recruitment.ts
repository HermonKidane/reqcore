import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  pgEnum,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { organization, user } from './auth'
import { job, application, candidate } from './app'

// ─────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────

export const recruitmentWorkflowStatusEnum = pgEnum('recruitment_workflow_status', [
  'active',
  'completed',
  'cancelled',
])

export const recruitmentStepStatusEnum = pgEnum('recruitment_step_status', [
  'pending',
  'in_progress',
  'blocked',
  'completed',
  'skipped',
])

export const recruitmentStepEventTypeEnum = pgEnum('recruitment_step_event_type', [
  'created',
  'started',
  'completed',
  'blocked',
  'unblocked',
  'updated',
  'skipped',
  'note',
])

export const aiRunStatusEnum = pgEnum('ai_run_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'approved',
  'rejected',
])

export type RecruitmentStepStatus = typeof recruitmentStepStatusEnum.enumValues[number]
export type RecruitmentWorkflowStatus = typeof recruitmentWorkflowStatusEnum.enumValues[number]

// ─────────────────────────────────────────────
// 30-Step Recruitment Workflow — ALL scoped by organizationId
// Additive layer on top of the legacy coarse application.status.
//
// Tenant scoping: every table carries organizationId directly EXCEPT
// recruitmentStepTemplate (scoped via its process template) and
// recruitmentStepInstance (scoped via its workflow) — deliberate
// normalization; the service layer always resolves parents org-first.
//
// Deletion policy: cascades follow the org/job/application deletion
// chain (hard tenant delete also removes workflow history). Within a
// live workflow, events are append-only and never deleted.
// ─────────────────────────────────────────────

/**
 * Versioned workflow definition (e.g. "30-Step Recruitment Process" v1).
 * One org can have several templates; `isDefault` marks the one used
 * to auto-instantiate workflows for new applications.
 */
export const recruitmentProcessTemplate = pgTable('recruitment_process_template', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  version: integer('version').notNull().default(1),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('recruitment_process_template_organization_id_idx').on(t.organizationId),
  // One default template per org (partial unique — race-safe lazy seeding)
  uniqueIndex('recruitment_process_template_org_default_idx')
    .on(t.organizationId)
    .where(sql`is_default = true`),
]))

/**
 * Step definition within a process template.
 * Steps 1–2 are job-level, 3–26 candidate/application-level, 27–30 placement-level.
 * `requiredFields` lists the completion-data keys that must be present to
 * mark the step complete. `completionRules` holds free-form rule metadata.
 * `promptTemplateId` links an optional AI prompt (vertical slice, later phase).
 */
export const recruitmentStepTemplate = pgTable('recruitment_step_template', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  templateId: text('template_id').notNull().references(() => recruitmentProcessTemplate.id, { onDelete: 'cascade' }),
  stepNumber: integer('step_number').notNull(),
  phase: text('phase').notNull(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  requiredFields: jsonb('required_fields').$type<string[]>().notNull().default([]),
  completionRules: jsonb('completion_rules').$type<Record<string, unknown>>(),
  promptTemplateId: text('prompt_template_id').references(() => aiPromptTemplate.id, { onDelete: 'set null' }),
  displayOrder: integer('display_order').notNull().default(0),
}, (t) => ([
  index('recruitment_step_template_template_id_idx').on(t.templateId),
  uniqueIndex('recruitment_step_template_template_step_idx').on(t.templateId, t.stepNumber),
  uniqueIndex('recruitment_step_template_template_key_idx').on(t.templateId, t.key),
]))

/**
 * Per-job/per-application workflow instance.
 * jobId/applicationId live HERE, not on upstream tables (zero upstream drift).
 * applicationId is null for job-level workflows (steps 1–2 only).
 */
export const recruitmentWorkflow = pgTable('recruitment_workflow', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').references(() => application.id, { onDelete: 'cascade' }),
  templateId: text('template_id').notNull().references(() => recruitmentProcessTemplate.id, { onDelete: 'restrict' }),
  status: recruitmentWorkflowStatusEnum('status').notNull().default('active'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
}, (t) => ([
  index('recruitment_workflow_organization_id_idx').on(t.organizationId),
  index('recruitment_workflow_job_id_idx').on(t.jobId),
  index('recruitment_workflow_application_id_idx').on(t.applicationId),
  index('recruitment_workflow_org_status_idx').on(t.organizationId, t.status),
  // One ACTIVE workflow per application (partial unique — race-safe lazy creation;
  // cancelled/completed workflows may coexist, allowing re-opening later)
  uniqueIndex('recruitment_workflow_app_active_idx')
    .on(t.organizationId, t.applicationId)
    .where(sql`application_id IS NOT NULL AND status = 'active'`),
]))

/**
 * Individual step state within a workflow.
 * One instance per (workflow, stepTemplate) — enforced by unique index.
 */
export const recruitmentStepInstance = pgTable('recruitment_step_instance', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workflowId: text('workflow_id').notNull().references(() => recruitmentWorkflow.id, { onDelete: 'cascade' }),
  stepTemplateId: text('step_template_id').notNull().references(() => recruitmentStepTemplate.id, { onDelete: 'cascade' }),
  assignedToId: text('assigned_to_id').references(() => user.id, { onDelete: 'set null' }),
  status: recruitmentStepStatusEnum('status').notNull().default('pending'),
  dueAt: timestamp('due_at'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  completionData: jsonb('completion_data').$type<Record<string, unknown>>(),
  riskLevel: text('risk_level'),
  blockedReason: text('blocked_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  uniqueIndex('recruitment_step_instance_workflow_step_idx').on(t.workflowId, t.stepTemplateId),
  index('recruitment_step_instance_status_idx').on(t.status),
  index('recruitment_step_instance_assigned_to_idx').on(t.assignedToId),
  index('recruitment_step_instance_due_at_idx').on(t.dueAt),
]))

/**
 * Immutable evidence/audit trail for step instances.
 * Append-only — no UPDATE or DELETE via the API.
 */
export const recruitmentStepEvent = pgTable('recruitment_step_event', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  stepInstanceId: text('step_instance_id').notNull().references(() => recruitmentStepInstance.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
  eventType: recruitmentStepEventTypeEnum('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  source: text('source').notNull().default('user'),
  occurredAt: timestamp('occurred_at').notNull().defaultNow(),
}, (t) => ([
  index('recruitment_step_event_org_idx').on(t.organizationId),
  index('recruitment_step_event_instance_idx').on(t.stepInstanceId, t.occurredAt),
]))

/**
 * Versioned AI prompt per step.
 * organizationId NULL = platform-wide default prompt; org rows override.
 * Prompt content lives here as DATA (versioned), never hard-coded in UI.
 */
export const aiPromptTemplate = pgTable('ai_prompt_template', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
  stepKey: text('step_key').notNull(),
  // Session W slice 1: one step may carry several prompts —
  // 'assist' (typed notes, the original), 'prep' (before a call),
  // 'outcome' (from a transcript after the call).
  purpose: text('purpose').notNull().default('assist'),
  name: text('name').notNull(),
  version: integer('version').notNull().default(1),
  systemPrompt: text('system_prompt').notNull(),
  userPromptTemplate: text('user_prompt_template').notNull(),
  inputSchema: jsonb('input_schema').$type<Record<string, unknown>>(),
  outputSchema: jsonb('output_schema').$type<Record<string, unknown>>(),
  safetyNotes: text('safety_notes'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('ai_prompt_template_org_idx').on(t.organizationId),
  index('ai_prompt_template_step_key_idx').on(t.stepKey),
  // Versioned prompts: one row per (scope, stepKey, version). Prompt rows are
  // insert-only — edits create a new version, preserving aiRun provenance.
  // Slice 1: `purpose` joins the key so prep/outcome prompts version independently.
  uniqueIndex('ai_prompt_template_global_version_idx')
    .on(t.stepKey, t.purpose, t.version)
    .where(sql`organization_id IS NULL`),
  uniqueIndex('ai_prompt_template_org_version_idx')
    .on(t.organizationId, t.stepKey, t.purpose, t.version)
    .where(sql`organization_id IS NOT NULL`),
]))

/**
 * Call transcripts (Session W slice 1, plumbing P1). Pasted today; Vonage
 * fetch later (source 'vonage'). The text is the recruiter's own record of a
 * call the other party was told is transcribed (`consentNoted`). Retention:
 * 12 months by default (job lands in slice 2) — see MIGRATIONS.md.
 * Deleting a transcript nulls `ai_run.transcript_id`; the run's inputSnapshot
 * stays as the audit copy of what the model actually saw.
 */
export const callTranscript = pgTable('call_transcript', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').references(() => candidate.id, { onDelete: 'set null' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
  applicationId: text('application_id').references(() => application.id, { onDelete: 'set null' }),
  stepInstanceId: text('step_instance_id').references(() => recruitmentStepInstance.id, { onDelete: 'set null' }),
  // pasted | upload | vonage
  source: text('source').notNull().default('pasted'),
  text: text('text').notNull(),
  charCount: integer('char_count').notNull().default(0),
  recordedAt: timestamp('recorded_at'),
  durationSeconds: integer('duration_seconds'),
  consentNoted: boolean('consent_noted').notNull().default(false),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('call_transcript_org_idx').on(t.organizationId),
  index('call_transcript_candidate_idx').on(t.candidateId),
  index('call_transcript_step_instance_idx').on(t.stepInstanceId),
]))

/**
 * AI request/response history. Never overwritten — every run is a new row.
 * `promptSnapshot` preserves the exact prompt used (prompt templates are
 * insert-only/versioned, but the snapshot is the ground truth for audit).
 * Approval workflow: status approved/rejected + reviewedBy/reviewedAt/reviewNote.
 */
export const aiRun = pgTable('ai_run', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  stepInstanceId: text('step_instance_id').references(() => recruitmentStepInstance.id, { onDelete: 'set null' }),
  promptTemplateId: text('prompt_template_id').notNull().references(() => aiPromptTemplate.id, { onDelete: 'restrict' }),
  requestedById: text('requested_by_id').references(() => user.id, { onDelete: 'set null' }),
  // Slice 1: which prompt purpose ran, and the transcript it read (if any).
  purpose: text('purpose').notNull().default('assist'),
  transcriptId: text('transcript_id').references(() => callTranscript.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  // Full prompt configuration used for the run (design-ai-slice.md §5
  // implementation contract). TS-only $type widening — PG jsonb is untyped,
  // no migration.
  promptSnapshot: jsonb('prompt_snapshot').$type<{
    templateId: string
    name: string
    version: number
    systemPrompt: string
    userPromptTemplate: string
    renderedUserPrompt: string
    inputSchema: Record<string, unknown> | null
    outputSchema: Record<string, unknown> | null
    safetyNotes: string | null
  }>().notNull(),
  inputSnapshot: jsonb('input_snapshot').$type<Record<string, unknown>>().notNull(),
  output: jsonb('output').$type<Record<string, unknown>>(),
  status: aiRunStatusEnum('status').notNull().default('pending'),
  error: text('error'),
  reviewedById: text('reviewed_by_id').references(() => user.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at'),
  reviewNote: text('review_note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
}, (t) => ([
  index('ai_run_org_idx').on(t.organizationId),
  index('ai_run_org_status_created_idx').on(t.organizationId, t.status, t.createdAt),
  index('ai_run_step_instance_idx').on(t.stepInstanceId),
  index('ai_run_prompt_template_idx').on(t.promptTemplateId),
]))

// ─────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────

export const recruitmentProcessTemplateRelations = relations(recruitmentProcessTemplate, ({ one, many }) => ({
  organization: one(organization, { fields: [recruitmentProcessTemplate.organizationId], references: [organization.id] }),
  steps: many(recruitmentStepTemplate),
  workflows: many(recruitmentWorkflow),
}))

export const recruitmentStepTemplateRelations = relations(recruitmentStepTemplate, ({ one, many }) => ({
  template: one(recruitmentProcessTemplate, { fields: [recruitmentStepTemplate.templateId], references: [recruitmentProcessTemplate.id] }),
  promptTemplate: one(aiPromptTemplate, { fields: [recruitmentStepTemplate.promptTemplateId], references: [aiPromptTemplate.id] }),
  instances: many(recruitmentStepInstance),
}))

export const recruitmentWorkflowRelations = relations(recruitmentWorkflow, ({ one, many }) => ({
  organization: one(organization, { fields: [recruitmentWorkflow.organizationId], references: [organization.id] }),
  job: one(job, { fields: [recruitmentWorkflow.jobId], references: [job.id] }),
  application: one(application, { fields: [recruitmentWorkflow.applicationId], references: [application.id] }),
  template: one(recruitmentProcessTemplate, { fields: [recruitmentWorkflow.templateId], references: [recruitmentProcessTemplate.id] }),
  stepInstances: many(recruitmentStepInstance),
}))

export const recruitmentStepInstanceRelations = relations(recruitmentStepInstance, ({ one, many }) => ({
  workflow: one(recruitmentWorkflow, { fields: [recruitmentStepInstance.workflowId], references: [recruitmentWorkflow.id] }),
  stepTemplate: one(recruitmentStepTemplate, { fields: [recruitmentStepInstance.stepTemplateId], references: [recruitmentStepTemplate.id] }),
  assignedTo: one(user, { fields: [recruitmentStepInstance.assignedToId], references: [user.id] }),
  events: many(recruitmentStepEvent),
}))

export const recruitmentStepEventRelations = relations(recruitmentStepEvent, ({ one }) => ({
  organization: one(organization, { fields: [recruitmentStepEvent.organizationId], references: [organization.id] }),
  stepInstance: one(recruitmentStepInstance, { fields: [recruitmentStepEvent.stepInstanceId], references: [recruitmentStepInstance.id] }),
  actor: one(user, { fields: [recruitmentStepEvent.actorId], references: [user.id] }),
}))

export const aiPromptTemplateRelations = relations(aiPromptTemplate, ({ one, many }) => ({
  organization: one(organization, { fields: [aiPromptTemplate.organizationId], references: [organization.id] }),
  stepTemplates: many(recruitmentStepTemplate),
  aiRuns: many(aiRun),
}))

export const aiRunRelations = relations(aiRun, ({ one }) => ({
  organization: one(organization, { fields: [aiRun.organizationId], references: [organization.id] }),
  stepInstance: one(recruitmentStepInstance, { fields: [aiRun.stepInstanceId], references: [recruitmentStepInstance.id] }),
  promptTemplate: one(aiPromptTemplate, { fields: [aiRun.promptTemplateId], references: [aiPromptTemplate.id] }),
  requestedBy: one(user, { fields: [aiRun.requestedById], references: [user.id] }),
  reviewedBy: one(user, { fields: [aiRun.reviewedById], references: [user.id] }),
  transcript: one(callTranscript, { fields: [aiRun.transcriptId], references: [callTranscript.id] }),
}))

// ─────────────────────────────────────────────
// Session W slice 1 — tasks (plumbing P3: ATS master copy, synced to Microsoft To Do / Outlook)
// ─────────────────────────────────────────────

export const taskStatusEnum = pgEnum('task_status', ['open', 'done', 'cancelled'])

/**
 * The recruiter's to-do list. ATS row is the master copy; `task_sync` tracks
 * the remote copies. Rows are never hard-deleted — cancel instead, so the
 * remote copy can be removed and the audit stays.
 */
export const task = pgTable('task', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  notes: text('notes'),
  dueAt: timestamp('due_at'),
  // all-day tasks go to To Do only; timed tasks also get an Outlook event
  allDay: boolean('all_day').notNull().default(true),
  status: taskStatusEnum('status').notNull().default('open'),
  ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').references(() => candidate.id, { onDelete: 'set null' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
  applicationId: text('application_id').references(() => application.id, { onDelete: 'set null' }),
  stepInstanceId: text('step_instance_id').references(() => recruitmentStepInstance.id, { onDelete: 'set null' }),
  // manual | ai_run | system
  source: text('source').notNull().default('manual'),
  aiRunId: text('ai_run_id').references(() => aiRun.id, { onDelete: 'set null' }),
  completedAt: timestamp('completed_at'),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('task_org_owner_status_due_idx').on(t.organizationId, t.ownerId, t.status, t.dueAt),
  index('task_candidate_idx').on(t.candidateId),
  index('task_application_idx').on(t.applicationId),
  index('task_job_idx').on(t.jobId),
]))

/** Remote copy bookkeeping, one row per (task, provider). */
export const taskSync = pgTable('task_sync', {
  taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
  // microsoft
  provider: text('provider').notNull(),
  todoListId: text('todo_list_id'),
  todoTaskId: text('todo_task_id'),
  outlookEventId: text('outlook_event_id'),
  // pending | synced | error
  state: text('state').notNull().default('pending'),
  error: text('error'),
  remoteEtag: text('remote_etag'),
  lastSyncedAt: timestamp('last_synced_at'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  primaryKey({ columns: [t.taskId, t.provider], name: 'task_sync_pk' }),
  index('task_sync_todo_task_idx').on(t.todoTaskId),
]))

export const callTranscriptRelations = relations(callTranscript, ({ one, many }) => ({
  organization: one(organization, { fields: [callTranscript.organizationId], references: [organization.id] }),
  candidate: one(candidate, { fields: [callTranscript.candidateId], references: [candidate.id] }),
  job: one(job, { fields: [callTranscript.jobId], references: [job.id] }),
  application: one(application, { fields: [callTranscript.applicationId], references: [application.id] }),
  stepInstance: one(recruitmentStepInstance, { fields: [callTranscript.stepInstanceId], references: [recruitmentStepInstance.id] }),
  createdBy: one(user, { fields: [callTranscript.createdById], references: [user.id] }),
  aiRuns: many(aiRun),
}))

export const taskRelations = relations(task, ({ one, many }) => ({
  organization: one(organization, { fields: [task.organizationId], references: [organization.id] }),
  owner: one(user, { fields: [task.ownerId], references: [user.id] }),
  createdBy: one(user, { fields: [task.createdById], references: [user.id] }),
  candidate: one(candidate, { fields: [task.candidateId], references: [candidate.id] }),
  job: one(job, { fields: [task.jobId], references: [job.id] }),
  application: one(application, { fields: [task.applicationId], references: [application.id] }),
  stepInstance: one(recruitmentStepInstance, { fields: [task.stepInstanceId], references: [recruitmentStepInstance.id] }),
  aiRun: one(aiRun, { fields: [task.aiRunId], references: [aiRun.id] }),
  syncs: many(taskSync),
}))

export const taskSyncRelations = relations(taskSync, ({ one }) => ({
  task: one(task, { fields: [taskSync.taskId], references: [task.id] }),
}))
