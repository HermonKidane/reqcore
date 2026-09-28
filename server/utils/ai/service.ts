import { eq, and, isNull, desc, gt, lte } from 'drizzle-orm'
import {
  aiPromptTemplate,
  aiRun,
  recruitmentStepInstance,
  recruitmentStepTemplate,
  job,
  application,
  candidate,
  jobClientContact,
  personRole,
  clientCompany,
} from '../../database/schema'
import { DEFAULT_AI_PROMPTS } from '~~/shared/recruitment/ai-prompts'
import { sanitizeOpaqueString } from './sanitizer'
import { selectProvider, type AiRuntimeConfig } from './provider'

/**
 * AI vertical-slice service (design-ai-slice.md §3–§5, locked).
 *
 * - Lazy idempotent platform-default prompt seeding (insert-only, targetless
 *   ON CONFLICT DO NOTHING — an existing row is never updated).
 * - Three-level prompt resolution: explicit template link (tenant-checked,
 *   active-only) → org-scoped latest active → platform default latest active.
 * - Server-built input context (§4): org-scoped end-to-end, PII-minimised
 *   (candidate emails/phones never included; application notes excluded;
 *   free-form completionData enters ONLY as an opaque sanitised string).
 * - Claim transaction (§5): FOR UPDATE on the step instance serialises
 *   concurrent generates; a committed running run → 409; stale running runs
 *   (>90s) are reclaimed so a new generate always converges.
 * - Review is ONE conditional UPDATE (status='succeeded' guard) — races are
 *   impossible by construction, no read-then-write.
 */

type AiRunRow = typeof aiRun.$inferSelect

export interface AiRunWithTemplate extends AiRunRow {
  promptTemplate: { name: string, version: number } | null
}

/** Provider call timeout (design §2) — 60s + the claim's 90s reclaim grace. */
const PROVIDER_TIMEOUT_MS = 60_000
/** Runs left 'running' longer than this are reclaimed as abandoned (§5). */
const STALE_RUN_MS = 90_000

// ─────────────────────────────────────────────
// Platform-default prompt seeding (lazy, idempotent)
// ─────────────────────────────────────────────

/**
 * Backfill any missing platform-default prompt rows (organizationId NULL).
 * Targetless ON CONFLICT DO NOTHING (no partial-index inference); rows that
 * already exist — even with unexpected content — are data and never updated.
 */
export async function ensureDefaultAiPrompts(): Promise<void> {
  await db.insert(aiPromptTemplate)
    .values(DEFAULT_AI_PROMPTS.map(p => ({
      organizationId: null,
      stepKey: p.stepKey,
      name: p.name,
      version: p.version,
      systemPrompt: p.systemPrompt,
      userPromptTemplate: p.userPromptTemplate,
      inputSchema: p.inputSchema,
      outputSchema: p.outputSchema,
      safetyNotes: p.safetyNotes,
      active: true,
    })))
    .onConflictDoNothing()
}

// ─────────────────────────────────────────────
// Prompt resolution (§3)
// ─────────────────────────────────────────────

type StepTemplateRow = typeof recruitmentStepTemplate.$inferSelect

/**
 * Resolution order (each level tenant-checked + active-only):
 *   1. recruitmentStepTemplate.promptTemplateId, ONLY when the linked row
 *      belongs to this org or is a platform default AND is active. The FK
 *      has no tenant constraint — the check is app-side; a cross-org link
 *      is ignored and resolution falls through, never trusted.
 *   2. Org-scoped latest active version (organizationId, stepKey).
 *   3. Platform default latest active version (NULL org, stepKey).
 * Unresolvable → null (route maps to 422).
 */
export async function resolvePrompt(
  orgId: string,
  stepTemplate: Pick<StepTemplateRow, 'key' | 'promptTemplateId'>,
): Promise<typeof aiPromptTemplate.$inferSelect | null> {
  await ensureDefaultAiPrompts()

  if (stepTemplate.promptTemplateId) {
    const linked = await db.query.aiPromptTemplate.findFirst({
      where: eq(aiPromptTemplate.id, stepTemplate.promptTemplateId),
    })
    const linkedUsable = linked
      && linked.active
      && (linked.organizationId === null || linked.organizationId === orgId)
    if (linkedUsable) return linked
    // Explicitly linked but INACTIVE or cross-org: not usable — fall through.
  }

  const [orgScoped, platform] = await Promise.all([
    db.query.aiPromptTemplate.findFirst({
      where: and(
        eq(aiPromptTemplate.organizationId, orgId),
        eq(aiPromptTemplate.stepKey, stepTemplate.key),
        eq(aiPromptTemplate.active, true),
      ),
      orderBy: desc(aiPromptTemplate.version),
    }),
    db.query.aiPromptTemplate.findFirst({
      where: and(
        isNull(aiPromptTemplate.organizationId),
        eq(aiPromptTemplate.stepKey, stepTemplate.key),
        eq(aiPromptTemplate.active, true),
      ),
      orderBy: desc(aiPromptTemplate.version),
    }),
  ])

  return orgScoped ?? platform ?? null
}

// ─────────────────────────────────────────────
// Template rendering (§3) — SINGLE-PASS by construction:
// String.replace scans the original template; substituted values are never
// re-scanned, so a context value containing "{{…}}" cannot trigger a second
// expansion. Unknown placeholders stay verbatim; null/undefined render ''.
// ─────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER_RE, (match, rawPath: string) => {
    const parts = rawPath.trim().split('.').filter(Boolean)
    if (parts.length === 0) return match
    let cur: unknown = context
    for (const part of parts) {
      // null/undefined anywhere in the chain: the placeholder IS known but
      // has no value → renders EMPTY (renderer contract, design §3).
      if (cur === null || cur === undefined) return ''
      // A scalar before the path ends: nothing to look up → unknown stays
      // verbatim (visible, not silently dropped).
      if (typeof cur !== 'object') return match
      cur = (cur as Record<string, unknown>)[part]
      if (cur === undefined) return match
    }
    return cur === null || cur === undefined ? '' : String(cur)
  })
}

// ─────────────────────────────────────────────
// Input context (§4) — the AI's only window
// ─────────────────────────────────────────────

export interface AiInputContext {
  stepKey: string
  stepNumber: number
  stepName: string
  job: { title: string | null, location: string | null }
  clientCompany: { name: string } | null
  candidate: { name: string | null }
  application: { status: string | null }
  stepCompletionDataText: string | null
  jobOrderContext: { step1: string | null, step2: string | null }
  generatedAt: string
}

type InstanceWithTemplate = typeof recruitmentStepInstance.$inferSelect & {
  stepTemplate: Pick<StepTemplateRow, 'stepNumber' | 'key' | 'name' | 'promptTemplateId'>
  workflow: { jobId: string, applicationId: string | null }
}

/**
 * Build the server-side context. Join paths are org-scoped end-to-end.
 * Precedence is deterministic: the PRIMARY job client contact only, resolved
 * through that person's active client_contact role to the company name
 * (the design's "job_client_company" link is realised by the shipped
 * job_client_contact + person_role chain — design §4 intent preserved:
 * primary link only, null when any hop is missing).
 */
export async function buildInputContext(
  orgId: string,
  instance: InstanceWithTemplate,
): Promise<AiInputContext> {
  const { workflow } = instance
  const stepTemplate = instance.stepTemplate

  // Job row via the workflow (org-scoped)
  const jobRow = await db.query.job.findFirst({
    where: and(eq(job.id, workflow.jobId), eq(job.organizationId, orgId)),
    columns: { title: true, location: true },
  })

  // Application → candidate spine (org-scoped). Status ONLY — application
  // notes are EXCLUDED (unclassified free text; PII policy, §4).
  let applicationStatus: string | null = null
  let candidateName: string | null = null
  if (workflow.applicationId) {
    const appRow = await db.query.application.findFirst({
      where: and(eq(application.id, workflow.applicationId), eq(application.organizationId, orgId)),
      columns: { status: true, candidateId: true },
    })
    if (appRow) {
      applicationStatus = appRow.status
      const person = await db.query.candidate.findFirst({
        where: and(eq(candidate.id, appRow.candidateId), eq(candidate.organizationId, orgId)),
        columns: { firstName: true, lastName: true },
      })
      if (person) candidateName = `${person.firstName} ${person.lastName}`.trim()
    }
  }

  // Client company: PRIMARY job_client_contact → active client_contact role.
  // A person may hold active client_contact roles at multiple companies, so
  // the role hop is ordered for determinism (newest first).
  let clientCompanyCtx: { name: string } | null = null
  const primaryContact = await db.query.jobClientContact.findFirst({
    where: and(
      eq(jobClientContact.jobId, workflow.jobId),
      eq(jobClientContact.organizationId, orgId),
      eq(jobClientContact.isPrimary, true),
    ),
    columns: { candidateId: true },
  })
  if (primaryContact) {
    const role = await db.query.personRole.findFirst({
      where: and(
        eq(personRole.candidateId, primaryContact.candidateId),
        eq(personRole.organizationId, orgId),
        eq(personRole.role, 'client_contact'),
        isNull(personRole.endedAt),
      ),
      orderBy: desc(personRole.startedAt),
      columns: { clientCompanyId: true },
    })
    if (role?.clientCompanyId) {
      const company = await db.query.clientCompany.findFirst({
        where: and(eq(clientCompany.id, role.clientCompanyId), eq(clientCompany.organizationId, orgId)),
        columns: { name: true },
      })
      if (company) clientCompanyCtx = { name: company.name }
    }
  }

  // Job-order context: THIS workflow's instances for step numbers 1+2,
  // as opaque sanitised strings.
  const orderInstances = await db.query.recruitmentStepInstance.findMany({
    where: eq(recruitmentStepInstance.workflowId, instance.workflowId),
    with: { stepTemplate: { columns: { stepNumber: true } } },
  })
  let step1: string | null = null
  let step2: string | null = null
  for (const i of orderInstances) {
    if (i.stepTemplate.stepNumber === 1) step1 = sanitizeOpaqueString(i.completionData)
    if (i.stepTemplate.stepNumber === 2) step2 = sanitizeOpaqueString(i.completionData)
  }

  return {
    stepKey: stepTemplate.key,
    stepNumber: stepTemplate.stepNumber,
    stepName: stepTemplate.name,
    job: { title: jobRow?.title ?? null, location: jobRow?.location ?? null },
    clientCompany: clientCompanyCtx,
    candidate: { name: candidateName },
    application: { status: applicationStatus },
    stepCompletionDataText: sanitizeOpaqueString(instance.completionData),
    jobOrderContext: { step1, step2 },
    generatedAt: new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────
// Generate (claim transaction + provider call)
// ─────────────────────────────────────────────

/**
 * Claim-tx + provider call. The caller (route) has already verified the
 * instance exists, is non-terminal, and its workflow is not cancelled; the
 * transaction re-verifies status under the lock.
 *
 * Returns the full run row (prompt/input snapshots + output/error).
 * The run row is the audit truth — activity_log is best-effort telemetry
 * alongside it (locked convention, §5).
 */
export async function generateAiRun(params: {
  orgId: string
  userId: string
  instance: InstanceWithTemplate & { status: string }
  config: AiRuntimeConfig
}): Promise<AiRunWithTemplate> {
  const { orgId, userId, instance, config } = params

  const prompt = await resolvePrompt(orgId, instance.stepTemplate)
  if (!prompt) {
    throw createError({ statusCode: 422, statusMessage: 'No AI prompt configured for this step' })
  }

  const context = await buildInputContext(orgId, instance)
  const renderedUserPrompt = renderTemplate(prompt.userPromptTemplate, context as unknown as Record<string, unknown>)

  const promptSnapshot = {
    templateId: prompt.id,
    name: prompt.name,
    version: prompt.version,
    systemPrompt: prompt.systemPrompt,
    userPromptTemplate: prompt.userPromptTemplate,
    renderedUserPrompt,
    inputSchema: prompt.inputSchema,
    outputSchema: prompt.outputSchema,
    safetyNotes: prompt.safetyNotes,
  }

  const selection = selectProvider(config)

  // ── Claim: serialise concurrent generates on the same instance (§5) ──
  const run = await db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: recruitmentStepInstance.status })
      .from(recruitmentStepInstance)
      .where(eq(recruitmentStepInstance.id, instance.id))
      .for('update')

    if (!locked) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    if (locked.status === 'completed' || locked.status === 'skipped') {
      throw createError({ statusCode: 409, statusMessage: `Step is already ${locked.status}` })
    }

    // Reclaim stale running runs (process died mid-call) so they block
    // nothing forever; a new generate always converges.
    const staleCutoff = new Date(Date.now() - STALE_RUN_MS)
    await tx.update(aiRun)
      .set({ status: 'failed', error: 'abandoned: exceeded run timeout', completedAt: new Date() })
      .where(and(
        eq(aiRun.organizationId, orgId),
        eq(aiRun.stepInstanceId, instance.id),
        eq(aiRun.status, 'running'),
        lte(aiRun.createdAt, staleCutoff),
      ))

    // NOTE: tx.select() here, NOT tx.query (relational) — the relational
    // query builder is unreliable inside a postgres-js transaction (hangs).
    const active = await tx.select({ id: aiRun.id })
      .from(aiRun)
      .where(and(
        eq(aiRun.organizationId, orgId),
        eq(aiRun.stepInstanceId, instance.id),
        eq(aiRun.status, 'running'),
        gt(aiRun.createdAt, staleCutoff),
      ))
    if (active.length > 0) {
      throw createError({ statusCode: 409, statusMessage: 'AI run already in progress' })
    }

    // Insert as RUNNING and commit BEFORE the provider call starts — the
    // committed row is what concurrent requests see (→ 409 above).
    const [created] = await tx.insert(aiRun).values({
      organizationId: orgId,
      stepInstanceId: instance.id,
      promptTemplateId: prompt.id,
      requestedById: userId,
      provider: selection.kind === 'misconfigured' ? 'openai-compat' : selection.provider.provider,
      model: selection.model,
      promptSnapshot,
      inputSnapshot: context as unknown as Record<string, unknown>,
      status: 'running',
    }).returning()
    if (!created) throw createError({ statusCode: 500, statusMessage: 'Failed to create AI run' })
    return created
  })

  // ── Provider call (outside the transaction) ──
  let finalStatus: 'succeeded' | 'failed' = 'failed'
  try {
    if (selection.kind === 'misconfigured') {
      // Fail-closed (§2): a deployment that thinks it talks to a real
      // provider must never serve mock output.
      throw new Error('AI provider misconfigured')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
    try {
      const result = await selection.provider.generate({
        systemPrompt: prompt.systemPrompt,
        userPrompt: renderedUserPrompt,
        model: selection.model,
        stepKey: instance.stepTemplate.key,
        signal: controller.signal,
      })
      // Parse-only validation (§8): best-effort JSON.parse, strict
      // outputSchema validation is Phase 4.
      let parsed: unknown
      try {
        parsed = JSON.parse(result.text)
      }
      catch {
        parsed = undefined
      }
      await db.update(aiRun).set({
        status: 'succeeded',
        output: parsed === undefined
          ? { text: result.text }
          : { text: result.text, parsed },
        completedAt: new Date(),
      }).where(eq(aiRun.id, run.id))
      finalStatus = 'succeeded'
    }
    finally {
      clearTimeout(timer)
    }
  }
  catch (err: any) {
    await db.update(aiRun).set({
      status: 'failed',
      error: String(err?.message ?? err).slice(0, 1000),
      completedAt: new Date(),
    }).where(eq(aiRun.id, run.id))
  }

  // Best-effort activity telemetry (locked convention — the ai_run row is
  // the authoritative audit record). Fire-and-forget, never awaited hard.
  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'created',
    resourceType: 'ai_run',
    resourceId: run.id,
    metadata: {
      stepKey: instance.stepTemplate.key,
      stepNumber: instance.stepTemplate.stepNumber,
      status: finalStatus,
      provider: run.provider,
    },
  }).catch(() => {})

  const full = await db.query.aiRun.findFirst({
    where: eq(aiRun.id, run.id),
    with: { promptTemplate: { columns: { name: true, version: true } } },
  })
  return full as AiRunWithTemplate
}

// ─────────────────────────────────────────────
// List runs (§5) — latest first, instance-scoped
// ─────────────────────────────────────────────

export async function listAiRuns(orgId: string, instanceId: string): Promise<AiRunWithTemplate[]> {
  return db.query.aiRun.findMany({
    where: and(eq(aiRun.stepInstanceId, instanceId), eq(aiRun.organizationId, orgId)),
    with: { promptTemplate: { columns: { name: true, version: true } } },
    orderBy: desc(aiRun.createdAt),
  }) as Promise<AiRunWithTemplate[]>
}

// ─────────────────────────────────────────────
// Review (§5) — ONE conditional UPDATE, one-shot
// ─────────────────────────────────────────────

export async function reviewAiRun(params: {
  orgId: string
  userId: string
  runId: string
  decision: 'approve' | 'reject'
  note?: string | undefined
}): Promise<AiRunWithTemplate> {
  const { orgId, userId, runId, decision, note } = params

  const run = await db.query.aiRun.findFirst({
    where: and(eq(aiRun.id, runId), eq(aiRun.organizationId, orgId)),
  })
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const to = decision === 'approve' ? 'approved' : 'rejected'

  // Conditional UPDATE — 0 rows means already reviewed or not succeeded;
  // races are covered atomically, no read-then-write.
  const updated = await db.update(aiRun)
    .set({
      status: to,
      reviewedById: userId,
      reviewedAt: new Date(),
      reviewNote: note ?? null,
    })
    .where(and(
      eq(aiRun.id, runId),
      eq(aiRun.organizationId, orgId),
      eq(aiRun.status, 'succeeded'),
    ))
    .returning({ id: aiRun.id })

  if (updated.length === 0) {
    // No status in the message — the pre-read row may be stale under a
    // concurrent review (the conditional UPDATE is the source of truth).
    throw createError({ statusCode: 409, statusMessage: 'Run is not awaiting review' })
  }

  const stepKey = (run.inputSnapshot as Record<string, unknown> | null)?.stepKey
  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'status_changed',
    resourceType: 'ai_run',
    resourceId: runId,
    metadata: {
      stepKey,
      from: 'succeeded',
      to,
      runId,
    },
  }).catch(() => {})

  const full = await db.query.aiRun.findFirst({
    where: eq(aiRun.id, runId),
    with: { promptTemplate: { columns: { name: true, version: true } } },
  })
  return full as AiRunWithTemplate
}
