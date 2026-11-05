import { eq, and, isNull, desc } from 'drizzle-orm'
import { representationConsent, jobClientContact, personRole, clientCompany } from '../database/schema'

/**
 * Consent-to-represent checks (Session W slice 1, step 7 #1).
 *
 * The job's client company is resolved the way the AI input context does it
 * today: PRIMARY job_client_contact → that person's active client_contact
 * role → client_company. TODO(cj-1.0): read `job.client_company_id` once
 * Companies & Jobs 1.0 lands.
 */
export async function resolveJobClientCompany(orgId: string, jobId: string): Promise<{ id: string, name: string } | null> {
  const primary = await db.query.jobClientContact.findFirst({
    where: and(
      eq(jobClientContact.jobId, jobId),
      eq(jobClientContact.organizationId, orgId),
      eq(jobClientContact.isPrimary, true),
    ),
    columns: { candidateId: true },
  })
  if (!primary) return null
  const role = await db.query.personRole.findFirst({
    where: and(
      eq(personRole.candidateId, primary.candidateId),
      eq(personRole.organizationId, orgId),
      eq(personRole.role, 'client_contact'),
      isNull(personRole.endedAt),
    ),
    orderBy: desc(personRole.startedAt),
    columns: { clientCompanyId: true },
  })
  if (!role?.clientCompanyId) return null
  const company = await db.query.clientCompany.findFirst({
    where: and(eq(clientCompany.id, role.clientCompanyId), eq(clientCompany.organizationId, orgId)),
    columns: { id: true, name: true },
  })
  return company ?? null
}

export type ConsentCheck =
  | { ok: true, consentId: string, scope: string }
  | { ok: false, code: 'consent_required' | 'client_unknown', clientCompany: { id: string, name: string } | null }

/**
 * Does an unrevoked consent cover this client? `all_clients` always does;
 * `named_clients` when the company is listed; `role_types` is shown to the
 * recruiter, not enforced (slice 1) — it counts as covering.
 */
export async function checkConsentForClient(orgId: string, candidateId: string, client: { id: string, name: string } | null): Promise<ConsentCheck> {
  if (!client) return { ok: false, code: 'client_unknown', clientCompany: null }
  const rows = await db.query.representationConsent.findMany({
    where: and(
      eq(representationConsent.organizationId, orgId),
      eq(representationConsent.candidateId, candidateId),
      isNull(representationConsent.revokedAt),
    ),
    orderBy: desc(representationConsent.givenAt),
    columns: { id: true, scope: true, clientCompanyIds: true },
  })
  for (const row of rows) {
    if (row.scope === 'all_clients' || row.scope === 'role_types') return { ok: true, consentId: row.id, scope: row.scope }
    if (row.scope === 'named_clients' && (row.clientCompanyIds ?? []).includes(client.id)) return { ok: true, consentId: row.id, scope: row.scope }
  }
  return { ok: false, code: 'consent_required', clientCompany: client }
}
