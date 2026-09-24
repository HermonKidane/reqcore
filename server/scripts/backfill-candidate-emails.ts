/**
 * Backfills candidate_email rows from legacy candidate.email values
 * (migration 0011 data migration — runs AFTER 0011 schema has applied).
 *
 * Design: info/design-0011-0013-person-model.md (fable5-reviewed).
 *
 * For every candidate with a valid non-blank email, inserts ONE
 * candidate_email row (is_primary=true, source='import') with
 * ON CONFLICT (organization_id, normalized_email) DO NOTHING.
 *
 * Idempotent — safe to rerun. Deterministic order (created_at, id).
 *
 * Outputs a quarantine report for:
 *  - blank/whitespace-only legacy emails (left in place, not inserted)
 *  - org-wide normalized-email collisions (skipped candidate keeps its
 *    candidate.email cache but has NO candidate_email row — manual merge
 *    required before declaring the backfill complete)
 *
 * Usage: npm run db:backfill-emails
 * Requires DATABASE_URL in .env (loaded via dotenv or shell env).
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '../database/schema'
import { candidate, candidateEmail, importBatch } from '../database/schema'

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

interface CollisionRow {
  organization_id: string
  ne: string
  candidate_ids: string[]
  count: string
}

interface QuarantineEntry {
  candidateId: string
  organizationId: string
  email: string
  reason: 'blank_email' | 'collision'
  conflictingCandidateIds?: string[]
}

async function main() {
  console.log('── 0011 backfill: candidate_email from candidate.email ──')

  // 1. Pre-check: org-wide normalized collisions, with candidate IDs (report only)
  const collisions = await db.execute<CollisionRow>(sql`
    SELECT organization_id, lower(btrim(email)) AS ne, array_agg(id ORDER BY created_at, id) AS candidate_ids, count(*)
    FROM candidate
    WHERE email IS NOT NULL AND btrim(email) <> ''
    GROUP BY organization_id, lower(btrim(email))
    HAVING count(*) > 1
  `)
  const collisionByCandidate = new Map<string, string[]>()
  for (const row of collisions) {
    const ids = row.candidate_ids
    // everyone after the first (deterministic keeper) is a collision victim
    for (const id of ids.slice(1)) collisionByCandidate.set(id, ids)
  }
  console.log(`Pre-check: ${collisions.length} normalized collision group(s), ${collisionByCandidate.size} candidate row(s) affected`)

  // 2. Create the backfill batch record (idempotent per org)
  const orgIds = (await db.execute<{ organization_id: string }>(sql`
    SELECT DISTINCT organization_id FROM candidate WHERE email IS NOT NULL AND btrim(email) <> ''
  `)).map(r => r.organization_id)

  const BATCH_KEY = '0011-backfill'
  const batchIds = new Map<string, string>()
  for (const orgId of orgIds) {
    const existing = await db.query.importBatch.findFirst({
      where: (b, { and, eq: eqOp }) => and(eqOp(b.organizationId, orgId), eqOp(b.batchKey, BATCH_KEY)),
    })
    if (existing) {
      batchIds.set(orgId, existing.id)
    }
    else {
      const inserted = await db.insert(importBatch).values({
        organizationId: orgId,
        batchKey: BATCH_KEY,
        purpose: 'Backfill candidate_email rows from legacy candidate.email values (migration 0011)',
        lawfulBasis: 'legitimate_interest: data already lawfully held in candidate.email (first-party ATS records); re-structured in place, no new data introduced',
        sourceFile: 'candidate.email column (pre-0011 legacy data)',
      }).returning({ id: importBatch.id })
      batchIds.set(orgId, inserted[0].id)
    }
  }

  // 3. Backfill with ON CONFLICT DO NOTHING, deterministic order
  const candidates = await db.select().from(candidate)
    .where(sql`email IS NOT NULL AND btrim(email) <> ''`)
    .orderBy(candidate.createdAt, candidate.id)

  const quarantine: QuarantineEntry[] = []
  let inserted = 0
  let skippedExisting = 0
  let skippedBlank = 0

  for (const c of candidates) {
    if (!c.email || !c.email.trim()) {
      skippedBlank++
      quarantine.push({ candidateId: c.id, organizationId: c.organizationId, email: c.email ?? '', reason: 'blank_email' })
      continue
    }
    const conflict = collisionByCandidate.get(c.id)
    if (conflict) {
      // Skip insert; candidate keeps its cache, flagged for manual merge.
      // ON CONFLICT would also catch this, but we report explicitly.
      quarantine.push({
        candidateId: c.id,
        organizationId: c.organizationId,
        email: c.email,
        reason: 'collision',
        conflictingCandidateIds: conflict,
      })
      continue
    }
    const result = await db.insert(candidateEmail).values({
      organizationId: c.organizationId,
      candidateId: c.id,
      email: c.email,
      normalizedEmail: c.email.trim().toLowerCase(),
      isPrimary: true,
      source: 'import',
      sourceDetail: { batch: batchIds.get(c.organizationId), matchedBy: 'legacy_candidate_email' },
    }).onConflictDoNothing().returning({ id: candidateEmail.id })
    if (result.length > 0) inserted++
    else skippedExisting++
  }

  // 4. Cache-parity audit: candidates whose email cache has no primary row
  const parityViolations = await db.execute<{ id: string; organization_id: string; email: string | null }>(sql`
    SELECT c.id, c.organization_id, c.email
    FROM candidate c
    WHERE c.email IS NOT NULL AND btrim(c.email) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM candidate_email ce
        WHERE ce.candidate_id = c.id AND ce.is_primary = true
      )
  `)

  // 5. Update batch stats
  for (const [orgId, batchId] of batchIds) {
    await db.execute(sql`
      UPDATE import_batch SET stats = ${JSON.stringify({
        inserted,
        skipped_existing: skippedExisting,
        skipped_blank: skippedBlank,
        quarantined: quarantine.filter(q => q.organizationId === orgId).length,
        parity_violations: parityViolations.filter(v => v.organization_id === orgId).length,
        ran_at: new Date().toISOString(),
      })}::jsonb
      WHERE id = ${batchId}
    `)
  }

  console.log(`Inserted: ${inserted} | already existed: ${skippedExisting} | blank skipped: ${skippedBlank}`)
  console.log(`Quarantined: ${quarantine.length} | cache-parity violations: ${parityViolations.length}`)
  if (quarantine.length > 0) {
    console.log('Quarantine report:')
    for (const q of quarantine) console.log(`  ${q.reason}: candidate ${q.candidateId} <${q.email}>${q.conflictingCandidateIds ? ` conflicts with ${q.conflictingCandidateIds.join(', ')}` : ''}`)
  }
  if (parityViolations.length > 0) {
    console.log('WARNING — backfill NOT complete. Candidates with email cache but no primary row (manual merge required):')
    for (const v of parityViolations) console.log(`  candidate ${v.id} <${v.email}>`)
    process.exitCode = 2
  }
  else {
    console.log('OK — every candidate with an email has a primary candidate_email row.')
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err)
    process.exitCode = 1
  })
  .finally(() => client.end())
