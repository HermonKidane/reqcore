/**
 * Imports the 324 LinkedIn message-recovered emails as NEW candidates.
 *
 * Design: info/design-0011-0013-person-model.md §Second-import policy
 * (fable5-reviewed; corrected 2026-09-24: these are the no-email connections,
 * verified 0 overlap with the existing 419).
 *
 * Input: a JSON array (preprocessed from the CSV — see myrecruiter info/):
 *   [{ row, firstName, lastName, url, email, company, position, connectedOn }]
 *
 * Per person (grouped by canonical URL):
 *   - skip if a candidate with that canonical linkedin_url already exists (idempotent)
 *   - quarantine emails whose normalized form already exists in candidate_email
 *   - create candidate (source='linkedin') + candidate_email rows
 *     (source='linkedin_message_recovery', source_detail with batch + row)
 *   - primary = alphabetically-first work-domain email, else alphabetically-first
 *     (FREE_PROVIDER_DOMAINS_V1 — the versioned list from the design doc)
 *   - person_role(role='connection') active row
 *   - exactly ONE import_batch row per org (purpose, lawful basis, retention review)
 *
 * Exit codes: 0 = fully clean; 2 = quarantines exist (report printed); 1 = failure.
 *
 * Usage: docker exec <app> npx tsx server/scripts/import-linkedin-message-emails.ts \
 *          <org-id> /path/to/li-emails.json
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import * as schema from '../database/schema'
import { insertPrimaryEmail } from '../utils/candidateEmail'

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

const [orgId, jsonPath] = process.argv.slice(2)
if (!orgId || !jsonPath) {
  console.error('Usage: import-linkedin-message-emails.ts <org-id> <json-path>')
  process.exit(1)
}

/** Versioned free-provider domain list — design doc §Second-import policy (V1) */
const FREE_PROVIDER_DOMAINS_V1 = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.co.uk',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'live.com', 'msn.com', 'gmx.com',
  'proton.me', 'protonmail.com', 'yandex.com', 'mail.com', 'btinternet.com',
  'virginmedia.com', 'sky.com',
])

/** Canonical form: path only (/in/slug), lowercase, no host/query/fragment/trailing slash */
function canonicalUrl(url: string): string {
  let u = url.trim().toLowerCase()
  u = u.replace(/^https?:\/\//, '')
  u = u.replace(/^(www\.|cn\.|uk\.)?linkedin\.com/, '')
  u = u.split('?')[0].split('#')[0]
  u = u.replace(/\/+$/, '')
  return u.startsWith('/') ? u : `/${u}`
}

/** Locale-independent comparator for deterministic alphabetical ordering */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function domainOf(email: string): string {
  return email.split('@')[1]?.trim().toLowerCase() ?? ''
}

interface CsvRow {
  row: number
  firstName: string | null
  lastName: string | null
  url: string | null
  email: string | null
  company: string | null
  position: string | null
  connectedOn: string | null
}

const client = postgres(process.env.DATABASE_URL)
const db = drizzle(client, { schema })

const BATCH_KEY = '2026-09-24-li-msg-recovery'
const SOURCE_FILE = 'linkedin-message-emails-2026-09-23.csv'

async function main() {
  const rows: CsvRow[] = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  console.log(`── LinkedIn message-email import: ${rows.length} CSV rows ──`)

    // Group rows by canonical URL (deterministic order)
    const byPerson = new Map<string, CsvRow[]>()
    for (const r of rows) {
      if (!r.url) continue
      const key = canonicalUrl(r.url)
      if (!byPerson.has(key)) byPerson.set(key, [])
      byPerson.get(key)!.push(r)
    }
    const people = [...byPerson.entries()].sort((a, b) => cmp(a[0], b[0]))
    console.log(`People to import: ${people.length}`)

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_lock(224467)`)

    // 1. Batch record (insert-or-fetch)
    const inserted = await tx.insert(schema.importBatch).values({
      organizationId: orgId,
      batchKey: BATCH_KEY,
      purpose: 'Import emails of LinkedIn connections recovered from own messages.csv export; people had no email in Connections.csv. Creates new candidates with provenance.',
      lawfulBasis: 'legitimate_interest: first-party relationship data from the data controller\'s own LinkedIn export; individuals are existing connections; no third-party data, no new purpose; retention review scheduled',
      sourceFile: SOURCE_FILE,
      retentionReviewAt: '2027-09-24',
    }).onConflictDoNothing({ target: [schema.importBatch.organizationId, schema.importBatch.batchKey] })
      .returning({ id: schema.importBatch.id })
    let batchId: string
    if (inserted.length > 0) {
      batchId = inserted[0].id
    }
    else {
      const existing = await tx.query.importBatch.findFirst({
        where: (b, { and, eq }) => and(eq(b.organizationId, orgId), eq(b.batchKey, BATCH_KEY)),
      })
      batchId = existing!.id
    }

    // 2. Existing candidate URLs in this org (idempotency) — canonicalized in JS.
    //    >1 candidate with the same canonical URL = ambiguous → quarantine.
    const urlRows = await tx.execute<{ id: string; u: string }>(sql`
      SELECT id, linkedin_url AS u FROM candidate
      WHERE organization_id = ${orgId} AND linkedin_url IS NOT NULL
    `)
    const urlOwners = new Map<string, string[]>()
    for (const r of urlRows) {
      const key = canonicalUrl(r.u)
      if (!urlOwners.has(key)) urlOwners.set(key, [])
      urlOwners.get(key)!.push(r.id)
    }

    // 3. Existing normalized emails org-wide (collision detection)
    const emailRows = await tx.execute<{ ne: string }>(sql`
      SELECT normalized_email AS ne FROM candidate_email WHERE organization_id = ${orgId}
    `)
    const existingEmails = new Set(emailRows.map(r => r.ne))

    const quarantine: { person: string; row: number; email: string; reason: string }[] = []
    let created = 0
    let skippedExisting = 0
    let emailsInserted = 0
    let emailsQuarantined = 0

    for (const [url, personRows] of people) {
      const first = personRows[0]

      const owners = urlOwners.get(url)
      if (owners && owners.length > 1) {
        quarantine.push({ person: url, row: first.row, email: '', reason: `ambiguous: ${owners.length} existing candidates share this URL` })
        continue
      }
      if (owners) {
        skippedExisting++
        continue
      }

      // Partition the person's emails: pre-dedupe within the person, then
      // quarantine any that collide with existing candidate_email rows.
      const seenInPerson = new Set<string>()
      const clean: { email: string; row: number }[] = []
      for (const r of personRows) {
        if (!r.email) continue
        const ne = r.email.trim().toLowerCase()
        if (seenInPerson.has(ne)) {
          quarantine.push({ person: url, row: r.row, email: r.email, reason: 'duplicate email within person (ignored)' })
          continue
        }
        seenInPerson.add(ne)
        if (existingEmails.has(ne)) {
          quarantine.push({ person: url, row: r.row, email: r.email, reason: 'email already exists in candidate_email' })
          emailsQuarantined++
        }
        else {
          clean.push({ email: r.email.trim(), row: r.row })
        }
      }

      if (clean.length === 0) {
        quarantine.push({ person: url, row: first.row, email: '', reason: 'all emails quarantined — person skipped' })
        continue
      }

      // Deterministic primary: work-domain preferred, then alphabetical
      const sorted = [...clean].sort((a, b) => cmp(a.email, b.email))
      const workSorted = sorted.filter(e => !FREE_PROVIDER_DOMAINS_V1.has(domainOf(e.email)))
      const primary = (workSorted.length > 0 ? workSorted : sorted)[0]
      const secondaries = sorted.filter(e => e !== primary)

      const candidateId = crypto.randomUUID()
      const conn = first.connectedOn ? sql`${first.connectedOn}::date` : sql`NULL`

      await tx.execute(sql`
        INSERT INTO candidate
          (id, organization_id, first_name, last_name, email, linkedin_url, company, position, source, connected_on, created_at, updated_at)
        VALUES
          (${candidateId}, ${orgId}, ${first.firstName}, ${first.lastName}, NULL,
           ${first.url}, ${first.company}, ${first.position}, 'linkedin', ${conn}, now(), now())
      `)

      const provenance = (row: number) => ({ batch: batchId, file: SOURCE_FILE, row, matchedBy: 'profile_url' })

      // Primary via the shared single code path (locks candidate, inserts, syncs cache)
      await insertPrimaryEmail(tx, orgId, candidateId, primary.email, {
        source: 'linkedin_message_recovery',
        sourceDetail: provenance(primary.row),
      })
      emailsInserted++
      existingEmails.add(primary.email.trim().toLowerCase())

      for (const sec of secondaries) {
        await tx.execute(sql`
          INSERT INTO candidate_email
            (id, organization_id, candidate_id, email, normalized_email, is_primary, source, source_detail, created_at, updated_at)
          VALUES
            (${crypto.randomUUID()}, ${orgId}, ${candidateId}, ${sec.email}, lower(btrim(${sec.email})), false,
             'linkedin_message_recovery', ${JSON.stringify(provenance(sec.row))}::jsonb, now(), now())
        `)
        emailsInserted++
        existingEmails.add(sec.email.trim().toLowerCase())
      }

      // Connection role (idempotent)
      await tx.execute(sql`
        INSERT INTO person_role (id, organization_id, candidate_id, role, started_at, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${orgId}, ${candidateId}, 'connection', now(), now(), now())
        ON CONFLICT DO NOTHING
      `)

      urlOwners.set(url, [candidateId])
      created++
    }

    // 4. Batch stats — merge with any prior run's stats (rerun-safe history)
    const prior = await tx.execute<{ stats: Record<string, unknown> | null }>(sql`
      SELECT stats FROM import_batch WHERE id = ${batchId}
    `)
    const runs = Array.isArray(prior[0]?.stats?.runs) ? prior[0].stats.runs : []
    runs.push({
      csv_rows: rows.length,
      people: people.length,
      candidates_created: created,
      candidates_skipped_existing: skippedExisting,
      emails_inserted: emailsInserted,
      emails_quarantined: emailsQuarantined,
      quarantine_count: quarantine.length,
      ran_at: new Date().toISOString(),
    })
    await tx.execute(sql`
      UPDATE import_batch SET stats = ${JSON.stringify({ runs })}::jsonb
      WHERE id = ${batchId}
    `)

    await tx.execute(sql`SELECT pg_advisory_unlock(224467)`)

    console.log(`Candidates created: ${created} | skipped (already existed): ${skippedExisting}`)
    console.log(`Emails inserted: ${emailsInserted} | quarantined: ${emailsQuarantined}`)
    if (quarantine.length > 0) {
      console.log('Quarantine report:')
      for (const q of quarantine) console.log(`  row ${q.row} ${q.person}: <${q.email}> — ${q.reason}`)
      process.exitCode = 2
    }
    else {
      console.log('OK — import clean, no quarantines.')
    }
  })
}

main()
  .catch((err) => {
    console.error('Import failed:', err)
    process.exitCode = 1
  })
  .finally(() => client.end())
