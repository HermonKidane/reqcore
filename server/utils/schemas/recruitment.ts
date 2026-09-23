import { z } from 'zod'

// ─────────────────────────────────────────────
// Recruitment workflow validation schemas
// ─────────────────────────────────────────────

/** Reusable schema for `:id` route params */
export const stepInstanceIdParamSchema = z.object({
  id: z.string().min(1),
})

/**
 * Step instance mutation — a single `action` with its payload.
 * Terminal states (completed / skipped) reject further mutations server-side.
 */
export const updateStepInstanceSchema = z.discriminatedUnion('action', [
  // pending|blocked → in_progress (sets startedAt on first start)
  z.object({ action: z.literal('start') }),

  // → completed; requires all template requiredFields present in completionData
  z.object({
    action: z.literal('complete'),
    completionData: z.record(z.string(), z.unknown()).default({}),
  }),

  // → blocked; reason is mandatory
  z.object({
    action: z.literal('block'),
    reason: z.string().min(1, 'A blocker reason is required').max(2000),
  }),

  // blocked → pending
  z.object({ action: z.literal('unblock') }),

  // → skipped (e.g. step 24 relocation when not applicable)
  z.object({
    action: z.literal('skip'),
    reason: z.string().max(2000).optional(),
  }),

  // Patch mutable fields on a non-terminal instance
  z.object({
    action: z.literal('update'),
    dueAt: z.coerce.date().nullish(),
    assignedToId: z.string().min(1).nullish(),
    riskLevel: z.enum(['low', 'medium', 'high']).nullish(),
    completionData: z.record(z.string(), z.unknown()).optional(),
  }),
])

export type UpdateStepInstanceInput = z.infer<typeof updateStepInstanceSchema>
