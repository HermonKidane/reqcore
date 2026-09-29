/**
 * Seed ORG-SCOPED AI prompt rows (e.g. R2R's own v1 + v2 prompts).
 *
 * The platform-default seeder only writes organizationId = NULL rows; this
 * script is the one-off path for org-scoped versions (design review
 * finding 2: seeding org rows is NOT data-only — org ids differ between
 * environments, so rows are keyed by org SLUG, resolved here).
 *
 * Conventions (design review findings 7/12/15):
 * - The prompt DATA is selected EXPLICITLY with --prompts (currently only
 *   'r2r'). The slug is resolved at runtime; a mistyped slug fails loudly
 *   (org not found) instead of silently seeding the wrong tenant's text.
 * - DRY RUN by default: prints the resolved org, a read-back status per
 *   row (insert / unchanged / DRIFT — an existing same-key row with
 *   different content), and whether an existing row is active. Pass
 *   --apply to write.
 * - STAGED versions: --versions 1|2|all, default 1. Deployment order:
 *   (1) run this script --versions 1 --apply for R2R BEFORE deploying the
 *   platform-v2 code — org v1 rows pin R2R to v1 whatever the platform
 *   ships; (2) deploy code; (3) verify R2R still resolves v1; (4) run
 *   --versions 2 --apply.
 * - ONE transaction for all rows — a failure leaves no half-seeded org.
 * - ROLLBACK: rows are insert-only, so the switch is the `active` flag:
 *     UPDATE ai_prompt_template SET active = false
 *      WHERE organization_id = '<org>' AND version = 2;   -- org v2 off
 *     UPDATE ai_prompt_template SET active = false
 *      WHERE organization_id IS NULL AND version = 2;     -- platform v2 off
 *
 * Usage:
 *   npx tsx server/scripts/seed-org-ai-prompts.ts --prompts r2r --slug <org-slug> [--versions 1|2|all] [--apply]
 *
 * Requires DATABASE_URL in .env (loaded via dotenv or shell env).
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, and } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import * as schema from '../database/schema'
import { R2R_AI_PROMPTS, type DefaultAiPrompt } from '../../shared/recruitment/ai-prompts'

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

/**
 * Explicit prompt-data selector → rows. Only orgs with their own
 * org-scoped prompt library get an entry here.
 */
const ORG_PROMPT_SETS: Record<string, DefaultAiPrompt[]> = {
  r2r: R2R_AI_PROMPTS,
}

const promptsArg = arg('--prompts')
const slugArg = arg('--slug')
const versions = arg('--versions') ?? '1'
const apply = process.argv.includes('--apply')

if (!promptsArg || !ORG_PROMPT_SETS[promptsArg]) {
  console.error(`Usage: npx tsx server/scripts/seed-org-ai-prompts.ts --prompts <${Object.keys(ORG_PROMPT_SETS).join('|')}> --slug <org-slug> [--versions 1|2|all] [--apply]`)
  process.exit(1)
}
if (!slugArg) {
  console.error('--slug <org-slug> is required.')
  process.exit(1)
}
const slug: string = slugArg

const selected = ORG_PROMPT_SETS[promptsArg].filter(p => versions === 'all' || p.version === Number(versions))
if (selected.length === 0) {
  console.error(`No prompt rows match --versions ${versions}`)
  process.exit(1)
}

const sql = postgres(DATABASE_URL, { max: 1 })
const db = drizzle(sql, { schema })

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

type PlannedRow = typeof schema.aiPromptTemplate.$inferInsert

/** Read-back status of a planned row against what is actually stored. */
function classify(existing: typeof schema.aiPromptTemplate.$inferSelect | undefined, row: PlannedRow): 'insert' | 'unchanged' | 'drift' {
  if (!existing) return 'insert'
  const same = existing.name === row.name
    && existing.systemPrompt === row.systemPrompt
    && existing.userPromptTemplate === row.userPromptTemplate
    && schemaHash(existing.inputSchema) === schemaHash(row.inputSchema)
    && schemaHash(existing.outputSchema) === schemaHash(row.outputSchema)
    && existing.safetyNotes === row.safetyNotes
    && existing.active === row.active
  return same ? 'unchanged' : 'drift'
}

async function main() {
  const org = await db.query.organization.findFirst({ where: eq(schema.organization.slug, slug) })
  if (!org) {
    console.error(`Org with slug "${slug}" not found — refusing to seed into the void.`)
    process.exit(1)
  }
  console.log(`Org: ${org.name} (${org.id}) — prompt set: ${promptsArg}, ${selected.length} row(s), versions filter: ${versions}`)

  const planned: PlannedRow[] = selected.map(p => ({
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
      const [existing] = await db.select()
        .from(schema.aiPromptTemplate)
        .where(and(
          eq(schema.aiPromptTemplate.organizationId, row.organizationId!),
          eq(schema.aiPromptTemplate.stepKey, row.stepKey!),
          eq(schema.aiPromptTemplate.version, row.version!),
        ))
        .limit(1)
      const status = classify(existing, row)
      const activeNote = existing && !existing.active ? ' [WARNING: existing row is INACTIVE — the resolver will skip it]' : ''
      console.log(`  ${status === 'insert' ? 'would insert' : status}${activeNote}: ${row.stepKey} v${row.version} "${row.name}"`)
    }
    console.log('DRY RUN — re-run with --apply to write.')
    return
  }

  await db.transaction(async (tx) => {
    for (const row of planned) {
      const [existing] = await tx.select()
        .from(schema.aiPromptTemplate)
        .where(and(
          eq(schema.aiPromptTemplate.organizationId, row.organizationId!),
          eq(schema.aiPromptTemplate.stepKey, row.stepKey!),
          eq(schema.aiPromptTemplate.version, row.version!),
        ))
        .limit(1)

      const status = classify(existing, row)
      if (status === 'drift') {
        // Insert-only rows: same key + different content is a loud failure.
        throw new Error(
          `REFUSING: ${row.stepKey} v${row.version} already exists for org ${slug} with DIFFERENT content. `
          + 'Prompt rows are insert-only — resolve the drift manually.',
        )
      }
      if (status === 'unchanged') {
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
