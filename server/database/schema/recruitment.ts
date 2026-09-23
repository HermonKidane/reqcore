import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { organization, user } from './auth'
import { job, application } from './app'

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
  uniqueIndex('ai_prompt_template_global_version_idx')
    .on(t.stepKey, t.version)
    .where(sql`organization_id IS NULL`),
  uniqueIndex('ai_prompt_template_org_version_idx')
    .on(t.organizationId, t.stepKey, t.version)
    .where(sql`organization_id IS NOT NULL`),
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
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptSnapshot: jsonb('prompt_snapshot').$type<{
    systemPrompt: string
    userPromptTemplate: string
    renderedUserPrompt?: string
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
}))
