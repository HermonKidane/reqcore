import { z } from 'zod'

// ─────────────────────────────────────────────
// Browser extension (C1) validation schemas
// ─────────────────────────────────────────────

/** Schema for creating an extension API key (settings UI) */
export const createExtensionKeySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
})

// Scrapers send '' when a field isn't on the page — treat as not provided
// (guardrail 11: never reject a capture for missing optional data)
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

const photoContentTypeEnum = z.enum(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Schema for POST /api/extension/capture (extension-facing intake).
 * Intentionally permissive per guardrail 11: extensions accept incomplete
 * records (email optional) — data quality is follow-up work, not a 422.
 *
 * C2 (AI page parsing): firstName/lastName become optional when the
 * extension also sends `pageText` for server-side AI extraction — exactly
 * one of (both names) or (pageText) must be present (422 otherwise).
 * `pageText` is the visible text of a single profile page; the endpoint
 * rejects bodies over 200_000 chars with 413 BEFORE parsing (the schema cap
 * below is only a hard memory-safety bound; never store pageText).
 */
export const extensionCaptureSchema = z.object({
  firstName: z.preprocess(blankToUndefined, z.string().trim().min(1).max(200).optional()),
  lastName: z.preprocess(blankToUndefined, z.string().trim().min(1).max(200).optional()),
  email: z.preprocess(blankToUndefined, z.string().trim().max(320).email().optional()),
  phone: z.preprocess(blankToUndefined, z.string().trim().max(50).optional()),
  linkedinUrl: z.preprocess(blankToUndefined, z.string().trim().max(500).url().optional()),
  company: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
  position: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
  location: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
  // Visible text of ONE profile page (AI extraction input). The 250k schema
  // cap is a memory-safety bound only; the endpoint 413s above 200_000.
  pageText: z.string().max(250_000).optional(),
  // The page the text came from — context for extraction, never stored.
  pageUrl: z.preprocess(blankToUndefined, z.string().trim().max(500).url().optional()),
  // Work history as displayed on the source page (free-text dates). On update
  // the candidate's 'linkedin'-sourced rows are replaced wholesale by this
  // array (when non-empty); 'manual'/'import' rows are never touched.
  experiences: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    company: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
    location: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
    startText: z.preprocess(blankToUndefined, z.string().trim().max(50).optional()),
    endText: z.preprocess(blankToUndefined, z.string().trim().max(50).optional()),
    isCurrent: z.boolean().optional(),
    description: z.preprocess(blankToUndefined, z.string().trim().max(4000).optional()),
  })).max(30).optional(),
  source: z.enum([
    'linkedin',
    'linkedin_recruiter',
    'reed',
    'cv_library',
    'totaljobs',
    'indeed',
    'dice',
    'ziprecruiter',
    'monster',
    'other',
  ]),
  sourceDetail: z.preprocess(blankToUndefined, z.string().trim().max(500).optional()),
  duplicatePolicy: z.enum(['skip', 'update']).default('skip'),
  photo: z.object({
    contentType: photoContentTypeEnum,
    // 2 MB decoded ≈ 2.8M base64 chars; cap the raw string before decoding
    dataBase64: z.string().min(1).max(2_900_000),
  }).optional(),
}).superRefine((val, ctx) => {
  // C2: names are required UNLESS the extension sent pageText for AI parsing.
  if (!val.pageText && !(val.firstName && val.lastName)) {
    ctx.addIssue({
      code: 'custom',
      path: ['firstName'],
      message: 'firstName and lastName are required unless pageText is provided',
    })
  }
})

export type ExtensionCaptureBody = z.infer<typeof extensionCaptureSchema>
