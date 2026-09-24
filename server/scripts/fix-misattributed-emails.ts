/**
 * Post-import data-quality FIX for the LinkedIn message-email import.
 *
 * Background: the 2026-09-23 audit extracted emails from messages.csv BODY
 * TEXT. Verification (after import) found 53 (person, email) pairs where the
 * email appears ONLY in messages sent TO the person — i.e. addresses written
 * by the account owner (r2r.net addresses, colleagues, clients) in the
 * conversation, NOT the person's own email. 43 people affected.
 *
 * This script, per affected person:
 *  - deletes the mis-attributed candidate_email row(s)
 *  - if they have another email left: promote the alphabetically-first
 *    work-domain-preferred remaining email to primary (single code path)
 *  - if no emails remain: cache becomes NULL (person stays, as a connection
 *    with no email — same posture as the 12.9k backlog)
 * Records the correction in the import batch stats.
 *
 * Input: CSV (url, email, who) — canonical /in/ URLs.
 * Usage: npx tsx server/scripts/fix-misattributed-emails.ts <org-id> <csv-path>
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import * as schema from '../database/schema'
import { syncEmailCache } from '../utils/candidateEmail'

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

const [orgId, csvPath] = process.argv.slice(2)
if (!orgId || !csvPath) {
  console.error('Usage: fix-misattributed-emails.ts <org-id> <csv-path>')
  process.exit(1)
}

/** Canonical form — MUST match import-linkedin-message-emails.ts */
function canonicalUrl(url: string): string {
  let u = url.trim().toLowerCase()
  u = u.replace(/^https?:\/\//, '')
  u = u.replace(/^(www\.|cn\.|uk\.)?linkedin\.com/, '')
  u = u.split('?')[0].split('#')[0]
  u = u.replace(/\/+$/, '')
  return u.startsWith('/') ? u : `/${u}`
}

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

interface SusRow { url: string; email: string; who: string }

const client = postgres(process.env.DATABASE_URL)
const db = drizzle(client, { schema })

// Minimal CSV parse (3 fields, no quoted commas expected in URLs/emails/names with this generator)
const susRows: SusRow[] = readFileSync(csvPath, 'utf-8').trim().split('\n').map((line) => {
  const parts = line.split(',')
  return { url: parts[0], email: parts[1], who: parts.slice(2).join(',') }
})

async function main() {
  console.log(`── Mis-attributed email fix: ${susRows.length} pairs ──`)

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_lock(224468)`)

    // Build canonical-URL → candidate map for the org
    const candRows = await tx.execute<{ id: string; u: string }>(sql`
      SELECT id, linkedin_url AS u FROM candidate
      WHERE organization_id = ${orgId} AND linkedin_url IS NOT NULL
    `)
    const byUrl = new Map<string, string>()
    for (const r of candRows) {
      const key = canonicalUrl(r.u)
      if (!byUrl.has(key)) byUrl.set(key, r.id)
    }

    let rowsDeleted = 0
    let promoted = 0
    let emptied = 0
    const skipped: string[] = []
    const fixedPeople = new Set<string>()

    for (const s of susRows) {
      const candidateId = byUrl.get(canonicalUrl(s.url))
      if (!candidateId) {
        skipped.push(`${s.who}: no candidate for ${s.url}`)
        continue
      }
      const deleted = await tx.execute(sql`
        DELETE FROM candidate_email
        WHERE candidate_id = ${candidateId} AND normalized_email = lower(btrim(${s.email}))
      `)
      rowsDeleted += deleted.count ?? 0
      fixedPeople.add(candidateId)
    }

    // Re-resolve primary per affected person
    for (const candidateId of fixedPeople) {
      const remaining = await tx.execute<{ email: string }>(sql`
        SELECT email FROM candidate_email WHERE candidate_id = ${candidateId} ORDER BY email
      `)
      if (remaining.length === 0) {
        await tx.execute(sql`UPDATE candidate SET email = NULL, updated_at = now() WHERE id = ${candidateId}`)
        emptied++
      }
      else {
        const sorted = remaining.map(r => r.email).sort(cmp)
        const work = sorted.filter(e => !FREE_PROVIDER_DOMAINS_V1.has(domainOf(e)))
        const newPrimary = (work.length > 0 ? work : sorted)[0]
        // Promote the chosen EXISTING row in place (no insert — avoids the
        // org-wide normalized unique collision), then sync the cache.
        await tx.execute(sql`UPDATE candidate_email SET is_primary = false, updated_at = now() WHERE candidate_id = ${candidateId}`)
        await tx.execute(sql`
          UPDATE candidate_email SET is_primary = true, updated_at = now()
          WHERE candidate_id = ${candidateId} AND email = ${newPrimary}
        `)
        await syncEmailCache(tx, candidateId)
        promoted++
      }
    }

    // Record in batch stats
    await tx.execute(sql`
      UPDATE import_batch SET stats = stats || ${JSON.stringify({
        misattributed_email_fix: {
          pairs: susRows.length,
          rows_deleted: rowsDeleted,
          people_promoted_other_email: promoted,
          people_left_without_email: emptied,
          fixed_at: new Date().toISOString(),
        },
      })}::jsonb
      WHERE organization_id = ${orgId} AND batch_key = '2026-09-24-li-msg-recovery'
    `)

    await tx.execute(sql`SELECT pg_advisory_unlock(224468)`)

    console.log(`Deleted rows: ${rowsDeleted} | re-promoted: ${promoted} | left email-less: ${emptied}`)
    if (skipped.length > 0) {
      console.log('Skipped:')
      for (const s of skipped) console.log(`  ${s}`)
    }
  })
}

main()
  .catch((err) => {
    console.error('Fix failed:', err)
    process.exitCode = 1
  })
  .finally(() => client.end())
