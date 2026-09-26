import { z } from 'zod'

// ─────────────────────────────────────────────
// Candidate validation schemas — shared across API routes
// ─────────────────────────────────────────────

/** Schema for creating a new candidate */
export const createCandidateSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address')
    .max(255)
    .transform((v) => v.toLowerCase().trim()),
  phone: z.string().max(50).optional(),
})

/** Schema for updating an existing candidate (all fields optional) */
export const updateCandidateSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100).optional(),
  lastName: z.string().min(1, 'Last name is required').max(100).optional(),
  email: z
    .string()
    .email('Invalid email address')
    .max(255)
    .transform((v) => v.toLowerCase().trim())
    .optional(),
  phone: z.string().max(50).nullish(),
})

/** Schema for candidate list query params */
export const candidateQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  /** Filter: person holds ≥1 ACTIVE role of this value (never 'candidate' — application-derived) */
  role: z.enum(['prospect', 'connection', 'client_contact']).optional(),
  /** Filter: person holds an ACTIVE client_contact role at this company */
  companyId: z.string().uuid().optional(),
})

/** Reusable schema for `:id` route params */
export const candidateIdParamSchema = z.object({
  id: z.string().min(1),
})
