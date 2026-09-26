import { z } from 'zod'

// ─────────────────────────────────────────────
// Person-model validation schemas — roles, client companies, job↔contacts
// Implements: info/design-person-apis.md (spec: design-0011-0013-person-model.md)
// ─────────────────────────────────────────────

/** person_role.role values — 'candidate' is deliberately absent (application-derived) */
export const personRoleValueSchema = z.enum(['prospect', 'connection', 'client_contact'])

/** Schema for starting a person role (also the restart path — inserts a NEW row) */
export const createPersonRoleSchema = z.object({
  role: personRoleValueSchema,
  clientCompanyId: z.string().min(1).optional(),
}).superRefine((val, ctx) => {
  if (val.role === 'client_contact' && !val.clientCompanyId) {
    ctx.addIssue({ code: 'custom', message: 'clientCompanyId is required for client_contact roles', path: ['clientCompanyId'] })
  }
  if (val.role !== 'client_contact' && val.clientCompanyId) {
    ctx.addIssue({ code: 'custom', message: 'clientCompanyId is only allowed for client_contact roles', path: ['clientCompanyId'] })
  }
})

/** Schema for the person-role lifecycle PATCH — only 'end' exists (history is immutable) */
export const updatePersonRoleSchema = z.object({
  action: z.literal('end'),
})

/** Schema for creating a client company (name trim rejects whitespace-only) */
export const createClientCompanySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  website: z.string().trim().max(500).optional(),
})

/** Schema for updating a client company (PATCH semantics — all optional) */
export const updateClientCompanySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200).optional(),
  website: z.string().trim().max(500).nullable().optional(),
})

/** Query params for the client-company list */
export const clientCompanyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
})

/** Schema for linking a job to a client contact */
export const createJobContactSchema = z.object({
  candidateId: z.string().min(1),
  label: z.string().trim().max(100).optional(),
  isPrimary: z.boolean().optional(),
})

/** Schema for updating a job↔contact link */
export const updateJobContactSchema = z.object({
  label: z.string().trim().max(100).nullable().optional(),
  isPrimary: z.boolean().optional(),
})

/** Route params for /api/jobs/:id/contacts/:linkId */
export const jobContactParamsSchema = z.object({
  id: z.string().min(1),
  linkId: z.string().min(1),
})
