/**
 * LinkedIn URL helpers — normalization + org-scoped duplicate lookup.
 *
 * Shared by the extension capture route and the manual create/update
 * candidate routes. The DB-side duplicate lookup uses the SAME
 * normalization as normalizeLinkedinUrl(), done in SQL so we never pull
 * every candidate's URL into memory.
 */

import { sql, type SQL } from 'drizzle-orm'

/**
 * Minimal structural type for the duplicate lookup (same shape as the
 * Executor in candidateEmail.ts). tx/db don't assign cleanly to it
 * (conditional-generic execute<> signature — same pre-existing TS wart as
 * candidateEmail.ts), so call sites cast.
 */
export interface DupExecutor {
  execute: <T = unknown>(query: SQL) => Promise<T[]>
}

/** lowercase, strip protocol / leading www. / query / fragment / trailing slash */
export function normalizeLinkedinUrl(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('?')[0]!
    .split('#')[0]!
    .replace(/\/+$/, '')
}

/**
 * Stored form of a user-entered LinkedIn URL: trimmed, and prefixed with
 * https:// when no protocol is present (users paste 'linkedin.com/in/…').
 * The candidate detail page uses this value as an href.
 */
export function canonicalLinkedinUrl(raw: string): string {
  const trimmed = raw.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/**
 * Find the candidate (if any) who owns this LinkedIn URL — org-scoped,
 * normalized the same way normalizeLinkedinUrl() does it. Returns
 * candidate id or null.
 */
export async function findCandidateIdByLinkedinUrl(
  executor: DupExecutor,
  orgId: string,
  url: string,
): Promise<string | null> {
  const wanted = normalizeLinkedinUrl(url)
  const rows = await executor.execute<{ id: string }>(sql`
    SELECT id FROM candidate
    WHERE organization_id = ${orgId}
      AND linkedin_url IS NOT NULL
      AND rtrim(split_part(split_part(
            regexp_replace(regexp_replace(lower(btrim(linkedin_url)), '^https?://', ''), '^www[.]', ''),
            '?', 1), '#', 1), '/') = ${wanted}
    LIMIT 1
  `)
  return rows[0]?.id ?? null
}
