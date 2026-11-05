import { z } from 'zod'

// ─────────────────────────────────────────────
// Candidate validation schemas — shared across API routes
// ─────────────────────────────────────────────

/** Blank / whitespace-only strings mean "not provided" (→ undefined). */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

const linkedinUrlRule = z
  .string()
  .max(500)
  .regex(/linkedin\.com\//i, 'Must be a LinkedIn profile URL')
  .trim()

/** Schema for creating a new candidate */
export const createCandidateSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.preprocess(
    blankToUndefined,
    z
      .string()
      .email('Invalid email address')
      .max(255)
      .transform((v) => v.toLowerCase().trim())
      .optional(),
  ),
  phone: z.string().max(50).optional(),
  linkedinUrl: z.preprocess(blankToUndefined, linkedinUrlRule.optional()),
  position: z.preprocess(blankToUndefined, z.string().max(200).trim().optional()),
  company: z.preprocess(blankToUndefined, z.string().max(200).trim().optional()),
  location: z.preprocess(blankToUndefined, z.string().max(200).trim().optional()),
  headline: z.preprocess(blankToUndefined, z.string().max(300).trim().optional()),
  summary: z.preprocess(blankToUndefined, z.string().max(5000).trim().optional()),
})

/** Schema for updating an existing candidate (all fields optional) */
export const updateCandidateSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100).optional(),
  lastName: z.string().min(1, 'Last name is required').max(100).optional(),
  // blank / absent = no change (emails are never removed here)
  email: z.preprocess(
    blankToUndefined,
    z
      .string()
      .email('Invalid email address')
      .max(255)
      .transform((v) => v.toLowerCase().trim())
      .optional(),
  ),
  phone: z.string().max(50).nullish(),
  // null = clear the field; blank / absent = no change
  linkedinUrl: z.preprocess(blankToUndefined, linkedinUrlRule.nullish()),
  position: z.preprocess(blankToUndefined, z.string().max(200).trim().nullish()),
  company: z.preprocess(blankToUndefined, z.string().max(200).trim().nullish()),
  location: z.preprocess(blankToUndefined, z.string().max(200).trim().nullish()),
  headline: z.preprocess(blankToUndefined, z.string().max(300).trim().nullish()),
  summary: z.preprocess(blankToUndefined, z.string().max(5000).trim().nullish()),
  // ── Session W slice 1: contact rules + Art 14 dates ──
  doNotContact: z.boolean().optional(),
  doNotContactSource: z.preprocess(blankToUndefined, z.enum(['call', 'email', 'whatsapp', 'sms', 'linkedin', 'other']).nullish()),
  doNotContactNote: z.preprocess(blankToUndefined, z.string().max(1000).trim().nullish()),
  collectedAt: z.preprocess(blankToUndefined, z.coerce.date().nullish()),
  privacyNoticeSentAt: z.preprocess(blankToUndefined, z.coerce.date().nullish()),
}).superRefine((v, ctx) => {
  if (v.doNotContact === true && !v.doNotContactSource) {
    ctx.addIssue({ code: 'custom', path: ['doNotContactSource'], message: 'Say how the person asked not to be contacted' })
  }
  if (v.doNotContact === false && !v.doNotContactNote) {
    ctx.addIssue({ code: 'custom', path: ['doNotContactNote'], message: 'Add a note explaining why the flag is being cleared' })
  }
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
