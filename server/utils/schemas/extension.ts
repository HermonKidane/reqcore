import { z } from 'zod'

// ─────────────────────────────────────────────
// Browser extension (C1) validation schemas
// ─────────────────────────────────────────────

/** Schema for creating an extension API key (settings UI) */
export const createExtensionKeySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
})

const photoContentTypeEnum = z.enum(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Schema for POST /api/extension/capture (extension-facing intake).
 * Intentionally permissive per guardrail 11: extensions accept incomplete
 * records (email optional) — data quality is follow-up work, not a 422.
 */
export const extensionCaptureSchema = z.object({
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().min(1).max(200),
  email: z.string().trim().max(320).email().optional(),
  phone: z.string().trim().max(50).optional(),
  linkedinUrl: z.string().trim().max(500).url().optional(),
  company: z.string().trim().max(200).optional(),
  position: z.string().trim().max(200).optional(),
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
  sourceDetail: z.string().trim().max(500).optional(),
  duplicatePolicy: z.enum(['skip', 'update']).default('skip'),
  photo: z.object({
    contentType: photoContentTypeEnum,
    // 2 MB decoded ≈ 2.8M base64 chars; cap the raw string before decoding
    dataBase64: z.string().min(1).max(2_900_000),
  }).optional(),
})

export type ExtensionCaptureBody = z.infer<typeof extensionCaptureSchema>
