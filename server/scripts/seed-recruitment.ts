/**
 * Seeds the canonical 30-Step Recruitment Process template for every
 * organization that doesn't already have a default process template.
 *
 * Idempotent — safe to run repeatedly (e.g. after restoring a backup
 * or adding a new org).
 *
 * Usage: npm run db:seed-recruitment
 * Requires DATABASE_URL in .env (loaded via dotenv or shell env).
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, and } from 'drizzle-orm'
import * as schema from '../database/schema'
import {
  CANONICAL_PROCESS_NAME,
  CANONICAL_PROCESS_VERSION,
  CANONICAL_STEPS,
} from '../../shared/recruitment/canonical-steps'

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

const client = postgres(DATABASE_URL, { max: 1 })
const db = drizzle(client, { schema })

async function main() {
  const orgs = await db.query.organization.findMany({ columns: { id: true, name: true } })

  if (orgs.length === 0) {
    console.log('No organizations found — nothing to seed.')
    return
  }

  for (const org of orgs) {
    const existing = await db.query.recruitmentProcessTemplate.findFirst({
      where: and(
        eq(schema.recruitmentProcessTemplate.organizationId, org.id),
        eq(schema.recruitmentProcessTemplate.isDefault, true),
      ),
    })

    if (existing) {
      console.log(`⏭  ${org.name}: default template already exists (v${existing.version}) — skipping`)
      continue
    }

    await db.transaction(async (tx) => {
      const [tpl] = await tx.insert(schema.recruitmentProcessTemplate).values({
        organizationId: org.id,
        name: CANONICAL_PROCESS_NAME,
        version: CANONICAL_PROCESS_VERSION,
        isDefault: true,
      }).returning({ id: schema.recruitmentProcessTemplate.id })

      if (!tpl) throw new Error(`Failed to create template for org ${org.name}`)

      await tx.insert(schema.recruitmentStepTemplate).values(
        CANONICAL_STEPS.map(s => ({
          templateId: tpl.id,
          stepNumber: s.stepNumber,
          phase: s.phase,
          key: s.key,
          name: s.name,
          description: s.description,
          requiredFields: s.requiredFields,
          completionRules: s.completionRules,
          displayOrder: s.stepNumber,
        })),
      )
    })

    console.log(`✅ ${org.name}: seeded "${CANONICAL_PROCESS_NAME}" v${CANONICAL_PROCESS_VERSION} (${CANONICAL_STEPS.length} steps)`)
  }
}

main()
  .then(async () => {
    await client.end()
    console.log('Done.')
  })
  .catch(async (err) => {
    console.error('Seed failed:', err)
    await client.end()
    process.exit(1)
  })
