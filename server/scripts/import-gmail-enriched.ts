/**
 * Imports Gmail-enriched connections (contacts pull + mailbox header mining)
 * into the sandbox ATS.
 *
 * Evidence classes (info/gmail-header-mining-privacy.md):
 *  - A: self-attested — person emailed FROM the address (mining) OR address in
 *      the owner's own Google contacts with matching name (contacts pull)
 *  - B: To/Cc only → quarantine, never imported
 *
 * Per person (union of both sources, A-class only):
 *  - existing candidate (canonical URL match) → attach emails via the shared
 *    code path; sets primary if none (work-domain preferred)
 *  - new person → create candidate (source='gmail_import') + emails + connection role
 *  - idempotent: existing normalized emails skipped; rerun-safe
 *  - import_batch record (purpose, lawful_basis, retention_review_at)
 *
 * Usage: npx tsx server/scripts/import-gmail-enriched.ts <org-id> <contacts-json> <mining-json>
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

const [orgId, contactsPath, miningPath] = process.argv.slice(2)
if (!orgId || !contactsPath || !miningPath) {
  console.error('Usage: import-gmail-enriched.ts <org-id> <contacts-json> <mining-json>')
  process.exit(1)
}

/** Canonical form — MUST match the other import scripts */
function canonicalUrl(url: string): string {
  let u = (url || '').trim().toLowerCase()
  u = u.replace(/^https?:\/\//, '')
  u = u.replace(/^(www\.|cn\.|uk\.)?linkedin\.com/, '')
  u = u.split('?')[0].split('#')[0]
  u = u.replace(/\/+$/, '')
  return u.startsWith('/') ? u : `/${u}`
}

/** Versioned free-provider domain list — design doc V1 */
const FREE_PROVIDER_DOMAINS_V1 = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.co.uk',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'live.com', 'msn.com', 'gmx.com',
  'proton.me', 'protonmail.com', 'yandex.com', 'mail.com', 'btinternet.com',
  'virginmedia.com', 'sky.com',
])

function domainOf(email: string): string {
  return email.split('@')[1]?.trim().toLowerCase() ?? ''
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

interface MatchInput {
  url: string
  name: string
  company?: string
  emails: string[] // evidence-A addresses only
  evidence: string // 'A_mining' | 'A_contacts' | 'A_both'
}

const client = postgres(process.env.DATABASE_URL)
const db = drizzle(client, { schema })

async function main() {
  // ── merge inputs ──
  const byPerson = new Map<string, { name: string; company: string; emails: Set<string>; mining: boolean; contacts: boolean }>()
  const contactsRaw: { url: string; name: string; company: string; emails: string[] }[] = JSON.parse(readFileSync(contactsPath, 'utf-8'))
  for (const m of contactsRaw) {
    if (!m.name?.trim()) continue // skip empty-name matches
    const key = canonicalUrl(m.url)
    const p = byPerson.get(key) ?? { name: m.name.trim(), company: m.company ?? '', emails: new Set(), mining: false, contacts: false }
    for (const e of m.emails) p.emails.add(e.trim().toLowerCase())
    p.contacts = true
    byPerson.set(key, p)
  }
  const miningRaw: { people: { url: string; name: string; company: string; email?: string; evidence: string | null }[] } = JSON.parse(readFileSync(miningPath, 'utf-8'))
  for (const p of miningRaw.people) {
    if (p.evidence !== 'A' || !p.email) continue
    const key = canonicalUrl(p.url)
    const e = byPerson.get(key) ?? { name: p.name.trim(), company: p.company ?? '', emails: new Set(), mining: false, contacts: false }
    e.emails.add(p.email.trim().toLowerCase())
    e.mining = true
    byPerson.set(key, e)
  }

  const people = [...byPerson.entries()]
    .filter(([, p]) => p.name && p.emails.size > 0)
    .sort((a, b) => cmp(a[0], b[0]))
  console.log(`── Gmail-enriched import: ${people.length} people with evidence-A emails ──`)

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_lock(224469)`)

    const batchKey = `gmail-enriched-${new Date().toISOString().slice(0, 10)}`
    const inserted = await tx.insert(schema.importBatch).values({
      organizationId: orgId,
      batchKey,
      purpose: 'Recover email addresses of LinkedIn connections (no email in export) from the controller\'s own Google Workspace: contacts records + mailbox message headers (metadata only, self-attested From addresses only)',
      lawfulBasis: 'legitimate_interest: first-party business correspondence data; self-attested addresses; no body content processed; erasure/opt-out supported; Art-14 notice required before outreach',
      sourceFile: 'contacts-matched.json + gmail-mining-results.json',
      retentionReviewAt: `${new Date().getFullYear() + 1}-09-24`,
    }).onConflictDoNothing({ target: [schema.importBatch.organizationId, schema.importBatch.batchKey] })
      .returning({ id: schema.importBatch.id })
    let batchId: string
    if (inserted.length > 0) {
      batchId = inserted[0].id
    }
    else {
      const existing = await tx.query.importBatch.findFirst({
        where: (b, { and, eq }) => and(eq(b.organizationId, orgId), eq(b.batchKey, batchKey)),
      })
      batchId = existing!.id
    }

    // existing candidates by canonical URL
    const candRows = await tx.execute<{ id: string; u: string }>(sql`
      SELECT id, linkedin_url AS u FROM candidate
      WHERE organization_id = ${orgId} AND linkedin_url IS NOT NULL
    `)
    const byUrl = new Map<string, string>()
    for (const r of candRows) {
      const key = canonicalUrl(r.u)
      if (!byUrl.has(key)) byUrl.set(key, r.id)
    }

    const existingEmailRows = await tx.execute<{ ne: string }>(sql`
      SELECT normalized_email AS ne FROM candidate_email WHERE organization_id = ${orgId}
    `)
    const existingEmails = new Set(existingEmailRows.map(r => r.ne))

    const stats = { attached_to_existing: 0, created: 0, emails_inserted: 0, emails_skipped: 0, quarantined_collisions: 0 }
    const quarantine: string[] = []

    for (const [url, p] of people) {
      const candidateId = byUrl.get(url)
      const emails = [...p.emails].sort(cmp)
      const clean = emails.filter(e => !existingEmails.has(e))
      const collisions = emails.filter(e => existingEmails.has(e))
      for (const e of collisions) {
        quarantine.push(`${p.name}: <${e}> already exists (skipped)`)
        stats.quarantined_collisions++
      }
      if (clean.length === 0) continue

      // primary candidate among the clean emails (work-domain preferred)
      const work = clean.filter(e => !FREE_PROVIDER_DOMAINS_V1.has(domainOf(e)))
      const primary = (work.length > 0 ? work : clean)[0]
      const rest = clean.filter(e => e !== primary)

      if (!candidateId) {
        // create new candidate
        const newId = crypto.randomUUID()
        const nameParts = p.name.split(' ')
        await tx.execute(sql`
          INSERT INTO candidate (id, organization_id, first_name, last_name, email, linkedin_url, company, source, created_at, updated_at)
          VALUES (${newId}, ${orgId}, ${nameParts[0]}, ${nameParts.slice(1).join(' ')}, NULL, ${url}, ${p.company || null}, 'gmail_import', now(), now())
        `)
        const prov = (ev: string) => ({ batch: batchId, matchedBy: 'gmail_contacts', evidence: ev })
        await insertPrimaryEmail(tx, orgId, newId, primary, {
          source: 'gmail_headers',
          sourceDetail: prov(p.mining && p.contacts ? 'A_both' : p.mining ? 'A_mining' : 'A_contacts'),
        })
        stats.emails_inserted++
        existingEmails.add(primary)
        for (const e of rest) {
          await tx.execute(sql`
            INSERT INTO candidate_email (id, organization_id, candidate_id, email, normalized_email, is_primary, source, source_detail, created_at, updated_at)
            VALUES (${crypto.randomUUID()}, ${orgId}, ${newId}, ${e}, lower(btrim(${e})), false, 'gmail_headers',
              ${JSON.stringify(prov(p.mining && p.contacts ? 'A_both' : p.mining ? 'A_mining' : 'A_contacts'))}::jsonb, now(), now())
          `)
          stats.emails_inserted++
          existingEmails.add(e)
        }
        await tx.execute(sql`
          INSERT INTO person_role (id, organization_id, candidate_id, role, started_at, created_at, updated_at)
          VALUES (${crypto.randomUUID()}, ${orgId}, ${newId}, 'connection', now(), now(), now())
          ON CONFLICT DO NOTHING
        `)
        byUrl.set(url, newId)
        stats.created++
      }
      else {
        // attach to existing candidate; set primary only if none
        const hasPrimary = await tx.execute<{ n: string }>(sql`
          SELECT count(*)::text AS n FROM candidate_email WHERE candidate_id = ${candidateId} AND is_primary = true
        `)
        const prov = (ev: string) => ({ batch: batchId, matchedBy: 'gmail_contacts', evidence: ev })
        const ev = p.mining && p.contacts ? 'A_both' : p.mining ? 'A_mining' : 'A_contacts'
        if (hasPrimary[0].n === '0') {
          await insertPrimaryEmail(tx, orgId, candidateId, primary, { source: 'gmail_headers', sourceDetail: prov(ev) })
          stats.emails_inserted++
          existingEmails.add(primary)
          for (const e of rest) {
            await tx.execute(sql`
              INSERT INTO candidate_email (id, organization_id, candidate_id, email, normalized_email, is_primary, source, source_detail, created_at, updated_at)
              VALUES (${crypto.randomUUID()}, ${orgId}, ${candidateId}, ${e}, lower(btrim(${e})), false, 'gmail_headers',
                ${JSON.stringify(prov(ev))}::jsonb, now(), now())
            `)
            stats.emails_inserted++
            existingEmails.add(e)
          }
        }
        else {
          for (const e of rest) {
            await tx.execute(sql`
              INSERT INTO candidate_email (id, organization_id, candidate_id, email, normalized_email, is_primary, source, source_detail, created_at, updated_at)
              VALUES (${crypto.randomUUID()}, ${orgId}, ${candidateId}, ${e}, lower(btrim(${e})), false, 'gmail_headers',
                ${JSON.stringify(prov(ev))}::jsonb, now(), now())
            `)
            stats.emails_inserted++
            existingEmails.add(e)
          }
        }
        stats.attached_to_existing++
      }
    }

    await tx.execute(sql`
      UPDATE import_batch SET stats = ${JSON.stringify({ ...stats, quarantine, ran_at: new Date().toISOString() })}::jsonb
      WHERE id = ${batchId}
    `)
    await tx.execute(sql`SELECT pg_advisory_unlock(224469)`)

    console.log(`Created: ${stats.created} | attached to existing: ${stats.attached_to_existing}`)
    console.log(`Emails inserted: ${stats.emails_inserted} | pre-existing (skipped): ${stats.quarantined_collisions}`)
    if (quarantine.length > 0) {
      console.log(`Quarantine (${quarantine.length}):`)
      for (const q of quarantine) console.log(`  ${q}`)
    }
  })
}

main()
  .catch((err) => {
    console.error('Import failed:', err)
    process.exitCode = 1
  })
  .finally(() => client.end())
