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
  foreignKey,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { organization, user } from './auth'

// ─────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────

export const jobStatusEnum = pgEnum('job_status', ['draft', 'open', 'closed', 'archived'])
export const jobTypeEnum = pgEnum('job_type', ['full_time', 'part_time', 'contract', 'internship'])
export const applicationStatusEnum = pgEnum('application_status', [
  'new', 'screening', 'interview', 'offer', 'hired', 'rejected',
])
export const documentTypeEnum = pgEnum('document_type', ['resume', 'cover_letter', 'other'])
/**
 * Fluid person roles WITH simultaneity + history. 'candidate' is deliberately
 * ABSENT — candidacy stays derived from `application` rows, never a role.
 */
export const personRoleValueEnum = pgEnum('person_role_value', ['prospect', 'connection', 'client_contact'])
export const questionTypeEnum = pgEnum('question_type', [
  'short_text', 'long_text', 'single_select', 'multi_select',
  'number', 'date', 'url', 'checkbox', 'file_upload',
])

// ─────────────────────────────────────────────
// ATS Domain Tables — ALL scoped by organizationId
// ─────────────────────────────────────────────

/**
 * Jobs / Positions within an organization.
 */
export const job = pgTable('job', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  location: text('location'),
  type: jobTypeEnum('type').notNull().default('full_time'),
  status: jobStatusEnum('status').notNull().default('draft'),
  // ── SEO / Rich Results fields ──
  salaryMin: integer('salary_min'),
  salaryMax: integer('salary_max'),
  salaryCurrency: text('salary_currency'),
  salaryUnit: text('salary_unit'),
  remoteStatus: text('remote_status'),
  validThrough: timestamp('valid_through'),
  // ── Application form settings ──
  requireResume: boolean('require_resume').notNull().default(false),
  requireCoverLetter: boolean('require_cover_letter').notNull().default(false),
  // ── Timestamps ──
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('job_organization_id_idx').on(t.organizationId),
  // Composite unique backing the tenant-scoped FK from job_client_contact
  uniqueIndex('job_org_id_unique').on(t.organizationId, t.id),
]))

/**
 * Candidates (applicants) belonging to a specific tenant.
 * NOTE: `candidate` is the PERSON spine of this schema — `person_role`,
 * `candidate_email` and `job_client_contact` all reference it.
 * `email` is a nullable denormalized cache of the primary candidate_email row
 * (NULL iff the person has no primary email). Never write it directly outside
 * the email-mutation code path.
 */
export const candidate = pgTable('candidate', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  // ── LinkedIn / source metadata ──
  linkedinUrl: text('linkedin_url'),
  company: text('company'),
  position: text('position'),
  source: text('source').default('manual'),
  connectedOn: timestamp('connected_on'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('candidate_organization_id_idx').on(t.organizationId),
  uniqueIndex('candidate_org_email_idx').on(t.organizationId, t.email),
  index('candidate_linkedin_url_idx').on(t.linkedinUrl),
  // Composite unique backing the tenant-scoped FKs from candidate_email / person_role / job_client_contact
  uniqueIndex('candidate_org_id_unique').on(t.organizationId, t.id),
]))

/**
 * Import batches — GDPR accountability record (purpose, lawful basis, retention review).
 * One row per import run; candidate_email.source_detail.batch references this id.
 */
export const importBatch = pgTable('import_batch', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  batchKey: text('batch_key').notNull(),
  purpose: text('purpose').notNull(),
  lawfulBasis: text('lawful_basis').notNull(),
  sourceFile: text('source_file').notNull(),
  stats: jsonb('stats').$type<Record<string, unknown>>(),
  retentionReviewAt: timestamp('retention_review_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('import_batch_organization_id_idx').on(t.organizationId),
  uniqueIndex('import_batch_org_batch_key_idx').on(t.organizationId, t.batchKey),
]))

/**
 * Multi-email store for a person. Uniqueness is org-wide on the NORMALIZED
 * (lower+btrim) email. At most one primary per candidate (partial unique index).
 * `source_detail` is immutable write-once provenance for GDPR audit.
 */
export const candidateEmail = pgTable('candidate_email', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull(),
  email: text('email').notNull(),
  normalizedEmail: text('normalized_email').notNull(),
  label: text('label'),
  isPrimary: boolean('is_primary').notNull().default(false),
  source: text('source').notNull().default('manual'),
  sourceDetail: jsonb('source_detail').$type<Record<string, unknown>>(),
  optOutAt: timestamp('opt_out_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('candidate_email_organization_id_idx').on(t.organizationId),
  index('candidate_email_candidate_id_idx').on(t.candidateId),
  uniqueIndex('candidate_email_org_normalized_idx').on(t.organizationId, t.normalizedEmail),
  uniqueIndex('candidate_email_one_primary').on(t.candidateId).where(sql`is_primary`),
  check('candidate_email_normalized_nonempty', sql`normalized_email <> ''`),
  // Tenant-scoped FK: candidate (organization_id, id)
  foreignKey({
    columns: [t.organizationId, t.candidateId],
    foreignColumns: [candidate.organizationId, candidate.id],
    name: 'candidate_email_candidate_fk',
  }).onDelete('cascade'),
]))

/**
 * Minimal client company. Deliberately small — no logo/address/industry yet.
 * `candidate.company` text remains a legacy display cache, never joined here.
 */
export const clientCompany = pgTable('client_company', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  website: text('website'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('client_company_organization_id_idx').on(t.organizationId),
  uniqueIndex('client_company_org_normalized_name_idx').on(t.organizationId, t.normalizedName),
  check('client_company_normalized_nonempty', sql`normalized_name <> ''`),
  // Composite unique backing the tenant-scoped FK from person_role
  uniqueIndex('client_company_org_id_unique').on(t.organizationId, t.id),
]))

/**
 * Fluid roles held by a person (the `candidate` row). History via ended_at —
 * rows are never deleted via the API; ending a role sets ended_at, restarting
 * creates a NEW row. companyId is required iff role = client_contact.
 */
export const personRole = pgTable('person_role', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull(),
  role: personRoleValueEnum('role').notNull(),
  clientCompanyId: text('client_company_id'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('person_role_organization_id_idx').on(t.organizationId),
  index('person_role_candidate_id_idx').on(t.candidateId),
  index('person_role_active_idx').on(t.candidateId).where(sql`ended_at IS NULL`),
  check('person_role_company_iff_client_contact', sql`("role" = 'client_contact') = ("client_company_id" IS NOT NULL)`),
  // Same semantics as NULLS NOT DISTINCT, expressed as two partial uniques
  // (drizzle-kit 0.31.9's bundled pg-core predates the nullsNotDistinct API).
  uniqueIndex('person_role_active_unique_company').on(t.candidateId, t.role, t.clientCompanyId).where(sql`ended_at IS NULL AND client_company_id IS NOT NULL`),
  uniqueIndex('person_role_active_unique_nocompany').on(t.candidateId, t.role).where(sql`ended_at IS NULL AND client_company_id IS NULL`),
  // Tenant-scoped FKs
  foreignKey({
    columns: [t.organizationId, t.candidateId],
    foreignColumns: [candidate.organizationId, candidate.id],
    name: 'person_role_candidate_fk',
  }).onDelete('cascade'),
  foreignKey({
    columns: [t.organizationId, t.clientCompanyId],
    foreignColumns: [clientCompany.organizationId, clientCompany.id],
    name: 'person_role_client_company_fk',
  }).onDelete('restrict'),
]))

/**
 * Job ↔ client-contact links (Hermon decision 2026-09-24: MANY contacts per
 * job, at most one flagged primary). candidate must hold an ACTIVE
 * client_contact role at link time (app-enforced); if the role later ends the
 * link row stays as history.
 */
export const jobClientContact = pgTable('job_client_contact', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull(),
  candidateId: text('candidate_id').notNull(),
  label: text('label'),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('job_client_contact_organization_id_idx').on(t.organizationId),
  index('job_client_contact_job_id_idx').on(t.jobId),
  uniqueIndex('job_client_contact_job_candidate_idx').on(t.jobId, t.candidateId),
  uniqueIndex('job_client_contact_one_primary').on(t.jobId).where(sql`is_primary`),
  // Tenant-scoped FKs
  foreignKey({
    columns: [t.organizationId, t.jobId],
    foreignColumns: [job.organizationId, job.id],
    name: 'job_client_contact_job_fk',
  }).onDelete('cascade'),
  foreignKey({
    columns: [t.organizationId, t.candidateId],
    foreignColumns: [candidate.organizationId, candidate.id],
    name: 'job_client_contact_candidate_fk',
  }).onDelete('cascade'),
]))

/**
 * An application links a candidate to a job within the same organization.
 */
export const application = pgTable('application', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidate.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  status: applicationStatusEnum('status').notNull().default('new'),
  score: integer('score'),
  notes: text('notes'),
  coverLetterText: text('cover_letter_text'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('application_organization_id_idx').on(t.organizationId),
  index('application_candidate_id_idx').on(t.candidateId),
  index('application_job_id_idx').on(t.jobId),
  uniqueIndex('application_org_candidate_job_idx').on(t.organizationId, t.candidateId, t.jobId),
]))

/**
 * Documents stored in MinIO (resumes, cover letters, etc.).
 * `storageKey` is the S3 object key in the bucket.
 * `parsedContent` holds the structured JSON output from PDF parsing.
 */
export const document = pgTable('document', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidate.id, { onDelete: 'cascade' }),
  type: documentTypeEnum('type').notNull().default('resume'),
  storageKey: text('storage_key').notNull().unique(),
  originalFilename: text('original_filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes'),
  parsedContent: jsonb('parsed_content'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('document_organization_id_idx').on(t.organizationId),
  index('document_candidate_id_idx').on(t.candidateId),
]))

// ─────────────────────────────────────────────
// Custom Application Form Questions
// ─────────────────────────────────────────────

/**
 * Custom questions configured by the recruiter for a specific job.
 * These appear on the public application form alongside the standard fields.
 * `options` is only used for `single_select` and `multi_select` types.
 */
export const jobQuestion = pgTable('job_question', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  type: questionTypeEnum('type').notNull().default('short_text'),
  label: text('label').notNull(),
  description: text('description'),
  required: boolean('required').notNull().default(false),
  options: jsonb('options').$type<string[]>(),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('job_question_organization_id_idx').on(t.organizationId),
  index('job_question_job_id_idx').on(t.jobId),
]))

/**
 * Applicant responses to custom questions, stored per application.
 * `value` is stored as JSONB to support different response types
 * (string, string[], number, boolean).
 */
export const questionResponse = pgTable('question_response', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => application.id, { onDelete: 'cascade' }),
  questionId: text('question_id').notNull().references(() => jobQuestion.id, { onDelete: 'cascade' }),
  value: jsonb('value').$type<string | string[] | number | boolean>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('question_response_organization_id_idx').on(t.organizationId),
  index('question_response_application_id_idx').on(t.applicationId),
  index('question_response_question_id_idx').on(t.questionId),
]))

// ─────────────────────────────────────────────
// Invite Links & Join Requests
// ─────────────────────────────────────────────

export const joinRequestStatusEnum = pgEnum('join_request_status', ['pending', 'approved', 'rejected'])

/**
 * Shareable invite links generated by org owners/admins.
 * Anyone with the link (and authenticated) can join at the specified role.
 * `token` is a cryptographic random hex string — NOT the primary key —
 * to prevent ID enumeration.
 */
export const inviteLink = pgTable('invite_link', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  createdById: text('created_by_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  role: text('role').notNull().default('member'),
  maxUses: integer('max_uses'),
  useCount: integer('use_count').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('invite_link_organization_id_idx').on(t.organizationId),
  index('invite_link_token_idx').on(t.token),
]))

/**
 * Join requests submitted by authenticated users wanting to join an org.
 * Only one pending request per user per org at a time (enforced in API).
 */
export const joinRequest = pgTable('join_request', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  message: text('message'),
  status: joinRequestStatusEnum('status').notNull().default('pending'),
  reviewedById: text('reviewed_by_id').references(() => user.id),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('join_request_organization_id_idx').on(t.organizationId),
  index('join_request_user_id_idx').on(t.userId),
  index('join_request_status_idx').on(t.status),
]))

// ─────────────────────────────────────────────
// Collaboration: Comments
// ─────────────────────────────────────────────

export const commentTargetEnum = pgEnum('comment_target', ['candidate', 'application', 'job'])

/**
 * Internal comments left by team members on candidates, applications, or jobs.
 * Scoped by organizationId for tenant isolation.
 */
export const comment = pgTable('comment', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  targetType: commentTargetEnum('target_type').notNull(),
  targetId: text('target_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('comment_organization_id_idx').on(t.organizationId),
  index('comment_target_idx').on(t.targetType, t.targetId),
  index('comment_author_id_idx').on(t.authorId),
]))

// ─────────────────────────────────────────────
// Collaboration: Activity Log
// ─────────────────────────────────────────────

export const activityActionEnum = pgEnum('activity_action', [
  'created', 'updated', 'deleted', 'status_changed',
  'comment_added', 'member_invited', 'member_removed', 'member_role_changed',
])

/**
 * Immutable audit trail for all significant actions within an organization.
 * Append-only — no UPDATE or DELETE allowed via the API.
 */
export const activityLog = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  action: activityActionEnum('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('activity_log_organization_id_idx').on(t.organizationId),
  index('activity_log_actor_id_idx').on(t.actorId),
  index('activity_log_resource_idx').on(t.resourceType, t.resourceId),
  index('activity_log_created_at_idx').on(t.createdAt),
]))

// ─────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────

export const jobRelations = relations(job, ({ one, many }) => ({
  organization: one(organization, { fields: [job.organizationId], references: [organization.id] }),
  applications: many(application),
  questions: many(jobQuestion),
}))

export const candidateRelations = relations(candidate, ({ one, many }) => ({
  organization: one(organization, { fields: [candidate.organizationId], references: [organization.id] }),
  applications: many(application),
  documents: many(document),
  emails: many(candidateEmail),
  roles: many(personRole),
  jobContactLinks: many(jobClientContact),
}))

export const candidateEmailRelations = relations(candidateEmail, ({ one }) => ({
  organization: one(organization, { fields: [candidateEmail.organizationId], references: [organization.id] }),
  candidate: one(candidate, { fields: [candidateEmail.candidateId], references: [candidate.id] }),
}))

export const importBatchRelations = relations(importBatch, ({ one }) => ({
  organization: one(organization, { fields: [importBatch.organizationId], references: [organization.id] }),
}))

export const clientCompanyRelations = relations(clientCompany, ({ one, many }) => ({
  organization: one(organization, { fields: [clientCompany.organizationId], references: [organization.id] }),
  roles: many(personRole),
}))

export const personRoleRelations = relations(personRole, ({ one }) => ({
  organization: one(organization, { fields: [personRole.organizationId], references: [organization.id] }),
  candidate: one(candidate, { fields: [personRole.candidateId], references: [candidate.id] }),
  clientCompany: one(clientCompany, { fields: [personRole.clientCompanyId], references: [clientCompany.id] }),
}))

export const jobClientContactRelations = relations(jobClientContact, ({ one }) => ({
  organization: one(organization, { fields: [jobClientContact.organizationId], references: [organization.id] }),
  job: one(job, { fields: [jobClientContact.jobId], references: [job.id] }),
  candidate: one(candidate, { fields: [jobClientContact.candidateId], references: [candidate.id] }),
}))

export const applicationRelations = relations(application, ({ one, many }) => ({
  organization: one(organization, { fields: [application.organizationId], references: [organization.id] }),
  candidate: one(candidate, { fields: [application.candidateId], references: [candidate.id] }),
  job: one(job, { fields: [application.jobId], references: [job.id] }),
  responses: many(questionResponse),
}))

export const documentRelations = relations(document, ({ one }) => ({
  organization: one(organization, { fields: [document.organizationId], references: [organization.id] }),
  candidate: one(candidate, { fields: [document.candidateId], references: [candidate.id] }),
}))

export const jobQuestionRelations = relations(jobQuestion, ({ one }) => ({
  organization: one(organization, { fields: [jobQuestion.organizationId], references: [organization.id] }),
  job: one(job, { fields: [jobQuestion.jobId], references: [job.id] }),
}))

export const questionResponseRelations = relations(questionResponse, ({ one }) => ({
  organization: one(organization, { fields: [questionResponse.organizationId], references: [organization.id] }),
  application: one(application, { fields: [questionResponse.applicationId], references: [application.id] }),
  question: one(jobQuestion, { fields: [questionResponse.questionId], references: [jobQuestion.id] }),
}))

export const commentRelations = relations(comment, ({ one }) => ({
  organization: one(organization, { fields: [comment.organizationId], references: [organization.id] }),
  author: one(user, { fields: [comment.authorId], references: [user.id] }),
}))

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  organization: one(organization, { fields: [activityLog.organizationId], references: [organization.id] }),
  actor: one(user, { fields: [activityLog.actorId], references: [user.id] }),
}))

export const inviteLinkRelations = relations(inviteLink, ({ one }) => ({
  organization: one(organization, { fields: [inviteLink.organizationId], references: [organization.id] }),
  createdBy: one(user, { fields: [inviteLink.createdById], references: [user.id] }),
}))

export const joinRequestRelations = relations(joinRequest, ({ one }) => ({
  user: one(user, { fields: [joinRequest.userId], references: [user.id] }),
  organization: one(organization, { fields: [joinRequest.organizationId], references: [organization.id] }),
  reviewedBy: one(user, { fields: [joinRequest.reviewedById], references: [user.id] }),
}))

// ─────────────────────────────────────────────
// CSV Candidate Import
// ─────────────────────────────────────────────

export const importStatusEnum = pgEnum('import_status', [
  'uploaded',
  'mapped',
  'processing',
  'committed',
  'failed',
  'cancelled',
])

export const importRowStatusEnum = pgEnum('import_row_status', [
  'ready',
  'duplicate_existing',
  'duplicate_in_file',
  'error',
  'committed',
  'skipped',
])

export const duplicatePolicyEnum = pgEnum('duplicate_policy', ['skip', 'update'])

/**
 * Tracks a CSV candidate import job.
 * Lifecycle: uploaded → mapped → processing → committed | failed | cancelled
 */
export const candidateImport = pgTable('candidate_import', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  createdById: text('created_by_id').notNull().references(() => user.id, { onDelete: 'cascade' }),

  // Target job (nullable — import to pool or specific job)
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),

  // File info
  originalFilename: text('original_filename').notNull(),
  fileSizeBytes: integer('file_size_bytes'),

  // CSV columns from header row
  columns: text('columns').array().notNull(),

  // Field mapping: { "Column Name": "email" | "ignore" | "prop:id" | "__new_property__" }
  mapping: jsonb('mapping').$type<Record<string, string>>(),

  // New properties to create during mapping
  newProperties: jsonb('new_properties').$type<Array<{ column: string; name: string; type: string }>>(),

  // Stats
  status: importStatusEnum('status').notNull().default('uploaded'),
  totalRows: integer('total_rows').notNull().default(0),
  readyRows: integer('ready_rows').notNull().default(0),
  duplicateRows: integer('duplicate_rows').notNull().default(0),
  duplicateInFileRows: integer('duplicate_in_file_rows').notNull().default(0),
  errorRows: integer('error_rows').notNull().default(0),

  // Results (set after commit)
  createdCount: integer('created_count'),
  updatedCount: integer('updated_count'),
  skippedCount: integer('skipped_count'),
  appliedCount: integer('applied_count'),
  duplicatePolicy: duplicatePolicyEnum('duplicate_policy'),
  committedAt: timestamp('committed_at'),
  committedById: text('committed_by_id').references(() => user.id),

  // Error details
  errorMessage: text('error_message'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('candidate_import_organization_id_idx').on(t.organizationId),
  index('candidate_import_org_created_idx').on(t.organizationId, t.createdAt),
  index('candidate_import_org_status_idx').on(t.organizationId, t.status),
  index('candidate_import_org_job_idx').on(t.organizationId, t.jobId),
]))

/**
 * Individual CSV rows for preview, validation, and commit.
 */
export const candidateImportRow = pgTable('candidate_import_row', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  importId: text('import_id').notNull().references(() => candidateImport.id, { onDelete: 'cascade' }),

  rowIndex: integer('row_index').notNull(),

  // Raw CSV data (preserved for audit/debug)
  rawData: jsonb('raw_data').$type<Record<string, string>>().notNull(),

  // Normalized data after mapping
  normalizedData: jsonb('normalized_data').$type<{
    email?: string
    firstName?: string
    lastName?: string
    displayName?: string
    phone?: string
    linkedinUrl?: string
    company?: string
    position?: string
    connectedOn?: string
  }>(),

  status: importRowStatusEnum('status').notNull().default('ready'),
  errorMessage: text('error_message'),

  // Set after commit
  candidateId: text('candidate_id').references(() => candidate.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  uniqueIndex('candidate_import_row_import_row_idx').on(t.importId, t.rowIndex),
  index('candidate_import_row_org_import_idx').on(t.organizationId, t.importId),
  index('candidate_import_row_import_status_idx').on(t.importId, t.status),
  index('candidate_import_row_candidate_id_idx').on(t.candidateId),
]))

// Relations
export const candidateImportRelations = relations(candidateImport, ({ one, many }) => ({
  organization: one(organization, { fields: [candidateImport.organizationId], references: [organization.id] }),
  createdBy: one(user, { fields: [candidateImport.createdById], references: [user.id] }),
  committedBy: one(user, { fields: [candidateImport.committedById], references: [user.id] }),
  job: one(job, { fields: [candidateImport.jobId], references: [job.id] }),
  rows: many(candidateImportRow),
}))

export const candidateImportRowRelations = relations(candidateImportRow, ({ one }) => ({
  organization: one(organization, { fields: [candidateImportRow.organizationId], references: [organization.id] }),
  import: one(candidateImport, { fields: [candidateImportRow.importId], references: [candidateImport.id] }),
  candidate: one(candidate, { fields: [candidateImportRow.candidateId], references: [candidate.id] }),
}))
