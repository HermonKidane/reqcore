/**
 * SINGLE CODE PATH for all candidate_email mutations + candidate.email cache sync.
 *
 * Design: info/design-0011-0013-person-model.md invariants I1–I3 (fable5-reviewed).
 *
 * Rules enforced here:
 * - candidate_email.normalized_email is ALWAYS computed by Postgres
 *   (lower(btrim(email))) — never JavaScript string operations.
 * - All lookups/dedupe go through candidate_email (org-wide normalized
 *   uniqueness), not the candidate.email cache.
 * - Every mutation syncs the candidate.email cache IN THE SAME TRANSACTION.
 * - Callers must run inside db.transaction(...) and pass the tx.
 */

import { sql, type SQL } from 'drizzle-orm'

/** Minimal structural type: everything here only needs execute() */
type Executor = {
  execute: <T = unknown>(query: SQL) => Promise<T[]>
}

export interface EmailProvenance {
  source: string
  sourceDetail?: Record<string, unknown>
}

/** JS-side approximation for pre-validation ONLY. The DB is the source of truth. */
export function normalizeEmailJs(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * True if the error is a Postgres unique-violation (SQLSTATE 23505) —
 * e.g. a lost race against candidate_email's org-wide unique index.
 *
 * drizzle-orm 0.45 wraps query errors in DrizzleQueryError (a plain Error
 * with no .code); the original postgres-js error — which carries .code —
 * sits at .cause. Walk the cause chain so both shapes match.
 */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err
  for (let depth = 0; current && typeof current === 'object' && depth < 4; depth++) {
    if ((current as { code?: unknown }).code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * True if the error is a Postgres foreign-key violation (SQLSTATE 23503) —
 * e.g. client_company delete blocked by person_role's ON DELETE RESTRICT.
 * Same cause-chain walk as isUniqueViolation (drizzle 0.45 wrapping).
 */
export function isFkViolation(err: unknown): boolean {
  let current: unknown = err
  for (let depth = 0; current && typeof current === 'object' && depth < 4; depth++) {
    if ((current as { code?: unknown }).code === '23503') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * Find the candidate (if any) who owns this email — via candidate_email,
 * normalized, org-scoped. Returns candidate id or null.
 */
export async function findCandidateIdByEmail(
  tx: Executor,
  orgId: string,
  email: string,
): Promise<string | null> {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT c.id FROM candidate c
    JOIN candidate_email ce ON ce.candidate_id = c.id
    WHERE c.organization_id = ${orgId}
      AND ce.normalized_email = lower(btrim(${email}))
    LIMIT 1
  `)
  return rows[0]?.id ?? null
}

/**
 * True if the normalized email is owned by a DIFFERENT candidate.
 */
export async function emailOwnedByOtherCandidate(
  tx: Executor,
  orgId: string,
  email: string,
  excludeCandidateId: string,
): Promise<boolean> {
  const owner = await findCandidateIdByEmail(tx, orgId, email)
  return owner !== null && owner !== excludeCandidateId
}

/**
 * Sync candidate.email cache from the primary candidate_email row
 * (NULL when no primary exists). Must be called in the same tx as the
 * email mutation, after the mutation.
 */
export async function syncEmailCache(tx: Executor, candidateId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE candidate SET email = (
      SELECT email FROM candidate_email
      WHERE candidate_id = ${candidateId} AND is_primary = true
    )
    WHERE id = ${candidateId}
  `)
}

/**
 * Insert a new primary email row for a candidate and sync the cache.
 * Throws on org-wide normalized conflict (caller should map to 409).
 * Pre: candidate row exists; caller holds the tx.
 * Locks the candidate row (serializes concurrent mutations).
 */
export async function insertPrimaryEmail(
  tx: Executor,
  orgId: string,
  candidateId: string,
  email: string,
  provenance: EmailProvenance,
): Promise<void> {
  await tx.execute(sql`SELECT id FROM candidate WHERE id = ${candidateId} FOR UPDATE`)
  await tx.execute(sql`
    INSERT INTO candidate_email
      (id, organization_id, candidate_id, email, normalized_email, is_primary, source, source_detail, created_at, updated_at)
    VALUES
      (${crypto.randomUUID()}, ${orgId}, ${candidateId}, ${email}, lower(btrim(${email})), true,
       ${provenance.source}, ${provenance.sourceDetail ? JSON.stringify(provenance.sourceDetail) : null}::jsonb,
       now(), now())
  `)
  await syncEmailCache(tx, candidateId)
}

/**
 * Replace the candidate's PRIMARY email: updates the existing primary row
 * (or inserts one if none exists) and syncs the cache.
 * Locks the candidate row first (serializes concurrent mutations).
 * Throws on org-wide normalized conflict with another owner.
 */
export async function replacePrimaryEmail(
  tx: Executor,
  orgId: string,
  candidateId: string,
  email: string,
  provenance: EmailProvenance,
): Promise<void> {
  await tx.execute(sql`SELECT id FROM candidate WHERE id = ${candidateId} FOR UPDATE`)

  const existing = await tx.execute<{ id: string }>(sql`
    SELECT id FROM candidate_email
    WHERE candidate_id = ${candidateId} AND is_primary = true
    LIMIT 1
  `)

  if (existing.length > 0) {
    await tx.execute(sql`
      UPDATE candidate_email
      SET email = ${email}, normalized_email = lower(btrim(${email})), updated_at = now()
      WHERE id = ${existing[0].id}
    `)
  }
  else {
    await tx.execute(sql`
      INSERT INTO candidate_email
        (id, organization_id, candidate_id, email, normalized_email, is_primary, source, source_detail, created_at, updated_at)
      VALUES
        (${crypto.randomUUID()}, ${orgId}, ${candidateId}, ${email}, lower(btrim(${email})), true,
         ${provenance.source}, ${provenance.sourceDetail ? JSON.stringify(provenance.sourceDetail) : null}::jsonb,
         now(), now())
    `)
  }
  await syncEmailCache(tx, candidateId)
}
