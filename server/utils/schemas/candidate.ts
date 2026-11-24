import { z } from 'zod'
import {
  DAY_RATE_MAX,
  NOTICE_PERIODS,
  RIGHT_TO_WORK,
  SALARY_MAX,
  SKILL_MAX_LENGTH,
  SKILLS_MAX,
  SOURCE_CHANNELS,
  WORK_PREFERENCES,
} from '~~/shared/candidate-qualifiers'
import { normalisePhone, PHONE_MAX_LENGTH } from '~~/shared/phone'
import { profileParseEducationSchema, profileParseExperienceSchema } from '../ai/profileParse'

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

// ── Add Candidate 2.0: qualifiers ─────────────────────────────────────────
// Create: blank / null / absent = not set. Update: null clears, blank /
// absent = no change (same convention as the text fields below).
const wholeAmount = (max: number) => z.number().int('Must be a whole number').min(0, 'Cannot be negative').max(max, `Must be ${max.toLocaleString('en-GB')} or less`)
const currencyRule = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Must be a 3-letter currency code')

const qualifierFields = {
  sourceChannel: z.preprocess(blankToUndefined, z.enum(SOURCE_CHANNELS).nullish()),
  salaryCurrency: z.preprocess(blankToUndefined, currencyRule.nullish()),
  salaryCurrent: z.preprocess(blankToUndefined, wholeAmount(SALARY_MAX).nullish()),
  salaryExpected: z.preprocess(blankToUndefined, wholeAmount(SALARY_MAX).nullish()),
  dayRate: z.preprocess(blankToUndefined, wholeAmount(DAY_RATE_MAX).nullish()),
  noticePeriod: z.preprocess(blankToUndefined, z.enum(NOTICE_PERIODS).nullish()),
  rightToWork: z.preprocess(blankToUndefined, z.enum(RIGHT_TO_WORK).nullish()),
  workPreference: z.preprocess(blankToUndefined, z.enum(WORK_PREFERENCES).nullish()),
}

/** Schema for creating a new candidate */
export const createCandidateSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.preprocess(
    blankToUndefined,
    z
      .string()
      .email('Invalid email address')
      .max(255)
      .transform((v) => v.toLowerCase().trim())
      .optional(),
  ),
  // Normalised the same way the form does it on blur (shared/phone.ts)
  phone: z.string().max(PHONE_MAX_LENGTH).transform((v) => normalisePhone(v) || undefined).optional(),
  linkedinUrl: z.preprocess(blankToUndefined, linkedinUrlRule.optional()),
  position: z.preprocess(blankToUndefined, z.string().max(200).trim().optional()),
  company: z.preprocess(blankToUndefined, z.string().max(200).trim().optional()),
  location: z.preprocess(blankToUndefined, z.string().max(200).trim().optional()),
  headline: z.preprocess(blankToUndefined, z.string().max(300).trim().optional()),
  summary: z.preprocess(blankToUndefined, z.string().max(5000).trim().optional()),
  ...qualifierFields,
  // Saved in the same transaction as the person (Add Candidate 2.0)
  skills: z.array(z.string().trim().min(1).max(SKILL_MAX_LENGTH)).max(SKILLS_MAX).optional(),
  experiences: z.array(profileParseExperienceSchema).max(30).optional(),
  education: z.array(profileParseEducationSchema).max(20).optional(),
})

/** Schema for updating an existing candidate (all fields optional) */
export const updateCandidateSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100).optional(),
  lastName: z.string().trim().min(1, 'Last name is required').max(100).optional(),
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
  phone: z.string().max(PHONE_MAX_LENGTH).transform((v) => normalisePhone(v)).nullish(),
  // null = clear the field; blank / absent = no change
  linkedinUrl: z.preprocess(blankToUndefined, linkedinUrlRule.nullish()),
  position: z.preprocess(blankToUndefined, z.string().max(200).trim().nullish()),
  company: z.preprocess(blankToUndefined, z.string().max(200).trim().nullish()),
  location: z.preprocess(blankToUndefined, z.string().max(200).trim().nullish()),
  headline: z.preprocess(blankToUndefined, z.string().max(300).trim().nullish()),
  summary: z.preprocess(blankToUndefined, z.string().max(5000).trim().nullish()),
  ...qualifierFields,
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

const optionalQueryText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional())

/** Query for GET /api/candidates/duplicates — everything optional */
export const candidateDuplicatesQuerySchema = z.object({
  email: optionalQueryText(255),
  linkedinUrl: optionalQueryText(500),
  phone: optionalQueryText(PHONE_MAX_LENGTH),
  firstName: optionalQueryText(100),
  lastName: optionalQueryText(100),
  company: optionalQueryText(200),
  excludeId: optionalQueryText(100),
})

/** JSON body for POST /api/candidates/parse (the other form is multipart) */
export const CV_PARSE_TEXT_MIN = 50
export const CV_PARSE_TEXT_MAX = 60_000
export const parseCandidateTextSchema = z.object({
  text: z.string()
    .min(CV_PARSE_TEXT_MIN, `Paste at least ${CV_PARSE_TEXT_MIN} characters`)
    .max(CV_PARSE_TEXT_MAX, `That text is too long. The limit is ${CV_PARSE_TEXT_MAX.toLocaleString('en-GB')} characters.`),
})
