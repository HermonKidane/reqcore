import { z } from 'zod'

/**
 * Consent to represent (Session W slice 1, step 6 #5 → gates step 7).
 * Rows are insert + revoke only; there is no edit.
 */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

export const createConsentSchema = z.object({
  scope: z.enum(['all_clients', 'named_clients', 'role_types']),
  clientCompanyIds: z.array(z.string().min(1).max(64)).max(50).default([]),
  roleTypes: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  // Checked per request: a bound built at module load goes stale minutes after boot.
  givenAt: z.coerce.date().refine(d => d.getTime() <= Date.now() + 5 * 60_000, 'Consent cannot be dated in the future'),
  channel: z.enum(['call', 'email', 'whatsapp', 'in_person', 'other']),
  evidenceQuote: z.string().trim().min(1, 'Record the candidate\'s words').max(1000),
}).strict().superRefine((v, ctx) => {
  if (v.scope === 'named_clients' && v.clientCompanyIds.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['clientCompanyIds'], message: 'Pick at least one client' })
  }
  if (v.scope === 'role_types' && v.roleTypes.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['roleTypes'], message: 'Name at least one role type' })
  }
})

export const revokeConsentSchema = z.object({
  revokedReason: z.preprocess(blankToUndefined, z.string().trim().max(500).optional()),
}).strict()

export const consentParamsSchema = z.object({
  id: z.string().min(1).max(64),
  consentId: z.string().min(1).max(64),
})
