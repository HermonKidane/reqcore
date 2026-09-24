/**
 * Backfills candidate_email rows from legacy candidate.email values
 * (migration 0011 data migration — runs AFTER 0011 schema has applied).
 *
 * Design: info/design-0011-0013-person-model.md (fable5-reviewed, 5 rounds).
 *
 * For every candidate with a valid non-blank email, inserts ONE
 * candidate_email row (is_primary=true, source='import'). Normalization is
 * computed BY POSTGRES (lower(btrim(email))) — the exact same expression
 * as the pre-check and the unique index, never JavaScript string ops.
 *
 * Idempotent — safe to rerun. Single-transaction, advisory-locked,
 * deterministic order (created_at, id).
 *
 * Outputs a quarantine report for:
 *  - blank/whitespace-only legacy emails (left in place, not inserted)
 *  - org-wide normalized-email collisions (skipped candidate keeps its
 *    candidate.email cache but has NO candidate_email row — manual merge
 *    required before declaring the backfill complete)
 *
 * Exit codes: 0 = complete (full row/cache parity), 2 = quarantine/parity
 * work remains (report printed), 1 = failure.
 *
 * Usage: npm run db:backfill-emails
 * Requires DATABASE_URL in .env (loaded via dotenv or shell env).
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '../database/schema'
import { importBatch } from '../database/schema'

const processWithLoadEnv = process as NodeJS.Process & {
  loadEnvFile?: (path?: string) => void
}

if (!process.env.DATABASE_URL && typeof processWithLoadEnv.loadEnvFile === 'function') {
  try {
    processWithLoadEnv.loadEnvFile('.env')
  }
  catch {
    // .env not present — rely on shell environment
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const client = postgres(process.env.DATABASE_URL)
const db = drizzle(client, { schema })

const ADVISORY_LOCK_ID = 224466
const BATCH_KEY = '0011-backfill'

interface CollisionRow {
  organization_id: string
  ne: string
  candidate_ids: string[]
  count: string
}

interface ParityRow {
  id: string
  organization_id: string
  cache: string | null
  primary_email: string | null
}

async function main() {
  console.log('── 0011 backfill: candidate_email from candidate.email ──')

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_ID})`)

    // 1. Pre-check: org-wide normalized collisions, with candidate IDs (report only).
    //    Normalizer MUST stay identical to the unique index expression: lower(btrim(email)).
    const collisions = await tx.execute<CollisionRow>(sql`
      SELECT organization_id, lower(btrim(email)) AS ne,
             array_agg(id ORDER BY created_at, id) AS candidate_ids, count(*)
      FROM candidate
      WHERE email IS NOT NULL AND btrim(email) <> ''
      GROUP BY organization_id, lower(btrim(email))
      HAVING count(*) > 1
    `)
    const collisionByCandidate = new Map<string, string[]>()
    for (const row of collisions) {
      for (const id of row.candidate_ids.slice(1)) collisionByCandidate.set(id, row.candidate_ids)
    }
    console.log(`Pre-check: ${collisions.length} normalized collision group(s), ${collisionByCandidate.size} candidate row(s) affected`)

    // 2. Batch records — insert-or-fetch, conflict-targeted (race-safe)
    const orgIds = (await tx.execute<{ organization_id: string }>(sql`
      SELECT DISTINCT organization_id FROM candidate WHERE email IS NOT NULL AND btrim(email) <> ''
    `)).map(r => r.organization_id)

    const batchIds = new Map<string, string>()
    for (const orgId of orgIds) {
      const inserted = await tx.insert(importBatch).values({
        organizationId: orgId,
        batchKey: BATCH_KEY,
        purpose: 'Backfill candidate_email rows from legacy candidate.email values (migration 0011)',
        lawfulBasis: 'legitimate_interest: data already lawfully held in candidate.email (first-party ATS records); re-structured in place — no new collection, no new purpose, retention unchanged, access restricted to org members',
        sourceFile: 'candidate.email column (pre-0011 legacy data)',
      }).onConflictDoNothing({ target: [importBatch.organizationId, importBatch.batchKey] })
        .returning({ id: importBatch.id })
      if (inserted.length > 0) {
        batchIds.set(orgId, inserted[0].id)
      }
      else {
        const existing = await tx.query.importBatch.findFirst({
          where: (b, { and, eq }) => and(eq(b.organizationId, orgId), eq(b.batchKey, BATCH_KEY)),
        })
        batchIds.set(orgId, existing!.id)
      }
    }

    // 3. Backfill — per-row parameterized raw INSERT, normalized BY POSTGRES,
    //    conflict targeted at (organization_id, normalized_email) ONLY.
    //    A primary-index conflict throws loudly instead of being swallowed.
    const candidates = await tx.execute<{ id: string; organization_id: string; email: string; created_at: string }>(sql`
      SELECT id, organization_id, email, created_at FROM candidate
      WHERE email IS NOT NULL AND btrim(email) <> ''
      ORDER BY created_at, id
    `)

    const quarantine: { candidateId: string; organizationId: string; email: string; conflictingCandidateIds?: string[] }[] = []
    let inserted = 0
    let skippedExisting = 0
    let skippedBlank = 0
    const blankCache = await tx.execute<{ id: string; organization_id: string; email: string }>(sql`
      SELECT id, organization_id, email FROM candidate WHERE email IS NOT NULL AND btrim(email) = ''
    `)
    skippedBlank = blankCache.length
    for (const b of blankCache) quarantine.push({ candidateId: b.id, organizationId: b.organization_id, email: b.email, conflictingCandidateIds: undefined })

    for (const c of candidates) {
      const conflict = collisionByCandidate.get(c.id)
      if (conflict) {
        quarantine.push({ candidateId: c.id, organizationId: c.organization_id, email: c.email, conflictingCandidateIds: conflict })
        continue
      }
      const result = await tx.execute<{ id: string }>(sql`
        INSERT INTO candidate_email
          (id, organization_id, candidate_id, email, normalized_email, is_primary, source, source_detail, created_at, updated_at)
        VALUES
          (${crypto.randomUUID()}, ${c.organization_id}, ${c.id}, ${c.email}, lower(btrim(${c.email})), true, 'import',
           ${JSON.stringify({ batch: batchIds.get(c.organization_id), matchedBy: 'legacy_candidate_email' })}::jsonb, now(), now())
        ON CONFLICT (organization_id, normalized_email) DO NOTHING
        RETURNING id
      `)
      if (result.length > 0) inserted++
      else skippedExisting++
    }

    // 4. Full row/cache parity audit — invariant I3, BOTH directions, in SQL:
    //    candidates that have a non-blank cache OR a primary row, where the
    //    cache IS DISTINCT FROM the primary email (catches missing primary,
    //    missing cache, and mismatch in one query).
    const realViolations = await tx.execute<ParityRow>(sql`
      SELECT c.id, c.organization_id, c.email AS cache, ce.email AS primary_email
      FROM candidate c
      LEFT JOIN candidate_email ce ON ce.candidate_id = c.id AND ce.is_primary = true
      WHERE ((c.email IS NOT NULL AND btrim(c.email) <> '') OR ce.id IS NOT NULL)
        AND c.email IS DISTINCT FROM ce.email
      ORDER BY c.created_at, c.id
    `)

    // 5. Batch stats
    for (const [orgId, batchId] of batchIds) {
      await tx.execute(sql`
        UPDATE import_batch SET stats = ${JSON.stringify({
          inserted,
          skipped_existing: skippedExisting,
          skipped_blank: skippedBlank,
          quarantined: quarantine.filter(q => q.organizationId === orgId).length,
          parity_violations: realViolations.filter(v => v.organization_id === orgId).length,
          ran_at: new Date().toISOString(),
        })}::jsonb
        WHERE id = ${batchId}
      `)
    }

    await tx.execute(sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`)

    console.log(`Inserted: ${inserted} | already existed: ${skippedExisting} | blank skipped: ${skippedBlank}`)
    console.log(`Quarantined: ${quarantine.length} | parity violations: ${realViolations.length}`)
    if (quarantine.length > 0) {
      console.log('Quarantine report:')
      for (const q of quarantine) {
        console.log(`  ${q.conflictingCandidateIds ? 'collision' : 'blank'}: candidate ${q.candidateId} <${q.email}>${q.conflictingCandidateIds ? ` conflicts with ${q.conflictingCandidateIds.join(', ')}` : ''}`)
      }
    }
    if (realViolations.length > 0) {
      console.log('WARNING — backfill NOT complete. Row/cache parity violations (manual merge required):')
      for (const v of realViolations) console.log(`  candidate ${v.id}: cache=<${v.cache}> primary=<${v.primary_email}>`)
      process.exitCode = 2
    }
    else if (quarantine.length > 0) {
      console.log('WARNING — quarantined rows remain (see report above); backfill incomplete for those candidates.')
      process.exitCode = 2
    }
    else {
      console.log('OK — every candidate with an email has a primary candidate_email row and caches match.')
    }
  })
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err)
    process.exitCode = 1
  })
  .finally(() => client.end())
