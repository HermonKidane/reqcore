/**
 * Seed ORG-SCOPED AI prompt rows (e.g. R2R's own v1 + v2 prompts).
 *
 * The platform-default seeder only writes organizationId = NULL rows; this
 * script is the one-off path for org-scoped versions (design review
 * finding 2: seeding org rows is NOT data-only — org ids differ between
 * environments, so rows are keyed by org SLUG, resolved here).
 *
 * Conventions (design review findings 7/15):
 * - DRY RUN by default: prints the resolved org and the rows it WOULD
 *   insert. Pass --apply to write.
 * - STAGED versions: pass --versions 1|2|all (default all). Deploy order:
 *   code first (platform v2 seeds lazily, changes nothing for an org with
 *   org rows), then this script with --versions 1, verify, then --versions 2.
 * - ONE transaction for all rows — a failure leaves no half-seeded org.
 * - READ-BACK compare: a same-key row with DIFFERENT content is a loud
 *   failure (onConflictDoNothing alone is silent); identical rows are
 *   skipped as already seeded.
 *
 * Usage:
 *   npx tsx server/scripts/seed-org-ai-prompts.ts --slug <org-slug> [--versions 1|2|all] [--apply]
 *
 * Requires DATABASE_URL in .env (loaded via dotenv or shell env).
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, and } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import * as schema from '../database/schema'
import { R2R_AI_PROMPTS } from '../../shared/recruitment/ai-prompts'

const processWithLoadEnv = process as NodeJS.Process & {
  loadEnvFile?: (path?: string) => void
}

if (!process.env.DATABASE_URL && typeof processWithLoadEnv.loadEnvFile === 'function') {
  try {
    processWithLoadEnv.loadEnvFile('.env')
  }
  catch {
    // .env is optional in hosted environments
  }
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required. Set it in .env or export it.')
  process.exit(1)
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null
}

const slugArg = arg('--slug')
const versions = arg('--versions') ?? 'all'
const apply = process.argv.includes('--apply')

if (!slugArg) {
  console.error('Usage: npx tsx server/scripts/seed-org-ai-prompts.ts --slug <org-slug> [--versions 1|2|all] [--apply]')
  process.exit(1)
}
const slug: string = slugArg

const selected = R2R_AI_PROMPTS.filter(p => versions === 'all' || p.version === Number(versions))
if (selected.length === 0) {
  console.error(`No prompt rows match --versions ${versions}`)
  process.exit(1)
}

const sql = postgres(DATABASE_URL, { max: 1 })
const db = drizzle(sql, { schema })

function hash(v: unknown): string {
  return createHash('sha256').update(JSON.stringify(v)).digest('hex')
}

/**
 * JSONB does not preserve object key order, so a byte-hash of the stored
 * schema compares unequal to the source even when content is identical.
 * Canonicalise: sort every object key recursively before hashing.
 */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, val]) => [k, canonicalize(val)]),
    )
  }
  return v
}

function schemaHash(v: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(v))).digest('hex')
}

async function main() {
  const org = await db.query.organization.findFirst({ where: eq(schema.organization.slug, slug) })
  if (!org) {
    console.error(`Org with slug "${slug}" not found — refusing to seed into the void.`)
    process.exit(1)
  }
  console.log(`Org: ${org.name} (${org.id}) — ${selected.length} row(s), versions filter: ${versions}`)

  const planned = selected.map(p => ({
    organizationId: org.id,
    stepKey: p.stepKey,
    name: p.name,
    version: p.version,
    systemPrompt: p.systemPrompt,
    userPromptTemplate: p.userPromptTemplate,
    inputSchema: p.inputSchema,
    outputSchema: p.outputSchema,
    safetyNotes: p.safetyNotes,
    active: true,
  }))

  if (!apply) {
    for (const row of planned) {
      console.log(`  would insert: ${row.stepKey} v${row.version} "${row.name}"`)
    }
    console.log('DRY RUN — re-run with --apply to write.')
    return
  }

  await db.transaction(async (tx) => {
    for (const row of planned) {
      const [existing] = await tx.select()
        .from(schema.aiPromptTemplate)
        .where(and(
          eq(schema.aiPromptTemplate.organizationId, row.organizationId),
          eq(schema.aiPromptTemplate.stepKey, row.stepKey),
          eq(schema.aiPromptTemplate.version, row.version),
        ))
        .limit(1)

      if (existing) {
        // Read-back compare (review finding 15): same key, different
        // content is a loud failure; identical content is a no-op.
        const same = existing.name === row.name
          && existing.systemPrompt === row.systemPrompt
          && existing.userPromptTemplate === row.userPromptTemplate
          && schemaHash(existing.inputSchema) === schemaHash(row.inputSchema)
          && schemaHash(existing.outputSchema) === schemaHash(row.outputSchema)
          && existing.safetyNotes === row.safetyNotes
        if (!same) {
          throw new Error(
            `REFUSING: ${row.stepKey} v${row.version} already exists for org ${slug} with DIFFERENT content. `
            + 'Prompt rows are insert-only — resolve the drift manually.',
          )
        }
        console.log(`  unchanged (already seeded): ${row.stepKey} v${row.version}`)
        continue
      }

      await tx.insert(schema.aiPromptTemplate).values(row)
      console.log(`  inserted: ${row.stepKey} v${row.version} "${row.name}"`)
    }
  })
  console.log('Done.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => sql.end())
