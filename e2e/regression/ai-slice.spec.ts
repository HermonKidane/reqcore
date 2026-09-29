import { createHash } from 'node:crypto'
import { test, expect } from '../fixtures'
import { findToneViolations, countSpokenWords } from '../helpers/tone'
import { DEFAULT_AI_PROMPTS, R2R_AI_PROMPTS } from '../../shared/recruitment/ai-prompts'

/**
 * AI vertical slice regression (design-ai-slice.md §7) — mock provider,
 * deterministic (no AI_API_KEY configured → mock mode is the default).
 *
 * Covers: generate + snapshots + PII redaction gate, 422 on unresolvable
 * prompt, review state machine (one-shot conditional UPDATE), 409 on
 * terminal instance, claim-tx concurrency (one 200 / one 409), cross-org
 * 404s, list ordering (newest first).
 *
 * Setup (job → publish → public apply) is done via API, same as
 * workflow-api.spec.ts; each test's fresh org lazily seeds the canonical
 * 30 steps AND the platform-default AI prompts on first AI call.
 */

const runId = Date.now()
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const PLANTED_EMAIL = `planted.pii.${runId}@example.com`

interface StepInstance {
  id: string
  status: string
  stepTemplate: { stepNumber: number, key: string, name: string }
}

async function makeApplication(api: import('@playwright/test').APIRequestContext, label: string): Promise<string> {
  const jobRes = await api.post('/api/jobs', { data: { title: `AI ${label} ${runId}` } })
  expect(jobRes.status()).toBe(201)
  const job = await jobRes.json()
  await api.patch(`/api/jobs/${job.id}`, { data: { status: 'open' } })

  const applyRes = await api.post(`/api/public/jobs/${job.slug}/apply`, {
    data: {
      firstName: 'Ai',
      lastName: label,
      email: `ai-${label.toLowerCase()}-${runId}@example.com`,
      responses: [],
    },
  })
  expect(applyRes.status(), 'public apply').toBeGreaterThanOrEqual(200)
  expect(applyRes.status()).toBeLessThan(300)

  const apps = await (await api.get('/api/applications', { params: { jobId: job.id } })).json()
  expect(apps.total).toBeGreaterThanOrEqual(1)
  return apps.data[0].id as string
}

async function getWorkflowSteps(api: import('@playwright/test').APIRequestContext, applicationId: string): Promise<StepInstance[]> {
  const wf = await (await api.get(`/api/applications/${applicationId}/workflow`)).json()
  return wf.instances
}

test.describe('AI vertical slice (mock provider)', () => {
  test('1. generate: snapshots persisted; PII redaction gate; activity_log (eventual consistency); promptSnapshot schemas', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const applicationId = await makeApplication(api, 'Gen')
    const candidateEmail = `ai-gen-${runId}@example.com`

    const steps = await getWorkflowSteps(api, applicationId)
    const step5 = steps.find(i => i.stepTemplate.stepNumber === 5)!
    expect(step5.stepTemplate.key).toBe('candidate_contact')

    // ── Plant PII (an email) in step 5 completionData via PATCH ──────────
    const patchRes = await api.patch(`/api/step-instances/${step5.id}`, {
      data: { action: 'update', completionData: { contactOutcome: `reached out, direct line ${PLANTED_EMAIL} works best` } },
    })
    expect(patchRes.status(), 'plant completionData').toBe(200)

    // ── Generate → 200 succeeded ─────────────────────────────────────────
    const genRes = await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {}, timeout: 90_000 })
    expect(genRes.status(), 'generate').toBe(200)
    const run = await genRes.json()
    expect(run.status).toBe('succeeded')
    expect(['mock', 'openai-compat']).toContain(run.provider)
    expect(run.model).toBeTruthy()
    expect(run.output?.text).toBeTruthy()

    // New step-5 output shape (prompt-templates §0.2): the MOCK canned output
    // uses pitchScript/packageBullets/objectionRehearsal. With a real
    // provider the content is model-generated — assert the strict shape
    // only in mock mode (CI determinism); provider-independent assertions
    // below run in both modes.
    if (run.provider === 'mock') {
      expect(run.output.parsed).toHaveProperty('pitchScript')
      expect(run.output.parsed).toHaveProperty('packageBullets')
      expect(run.output.parsed).toHaveProperty('objectionRehearsal')
    }

    // ── PII gate (§7 test 1) ─────────────────────────────────────────────
    const snapshot = JSON.stringify(run.inputSnapshot)
    expect(snapshot, 'candidate email excluded from context').not.toContain(candidateEmail)
    expect(snapshot, 'candidate phone excluded').not.toContain('07716')
    // The email planted in completionData MUST be redacted in the snapshot
    expect(snapshot, 'planted email redacted').not.toContain(PLANTED_EMAIL)
    expect(snapshot, 'redaction marker present').toContain('[redacted-contact]')

    // Prompt rendered with context (placeholder resolution, single-pass)
    expect(run.promptSnapshot.renderedUserPrompt).toContain('(candidate_contact)')
    expect(run.promptSnapshot.renderedUserPrompt).toContain('step 5')
    expect(run.promptSnapshot.renderedUserPrompt).not.toContain('{{stepNumber}}')
    // Null clientCompany renders EMPTY (renderer contract), never the raw
    // placeholder text.
    expect(run.promptSnapshot.renderedUserPrompt).not.toContain('{{clientCompany.name}}')

    // promptSnapshot carries inputSchema + outputSchema + safetyNotes
    expect(run.promptSnapshot.inputSchema?.properties?.jobOrderContext).toBeTruthy()
    expect(run.promptSnapshot.outputSchema?.required).toContain('pitchScript')
    expect(run.promptSnapshot.safetyNotes).toContain('ADVISORY')

    // ── v2 platform prompt: neutral (no R2R terms) — deterministic in ────
    // both provider modes (promptSnapshot is seeded data, not model output)
    expect(run.promptSnapshot.systemPrompt).not.toMatch(/Recruit2Recruit|\bR2R\b|rec-to-rec/i)
    expect(run.promptTemplate.version).toBe(2)

    // ── Tone net (reviews 2026-09-29): hard gate in mock mode (the mock ──
    // is the only deterministic output); real-provider runs annotate so a
    // non-deterministic model can't flake the suite (fable finding 12).
    const violations = findToneViolations(run.output.parsed, run.inputSnapshot)
    if (run.provider === 'mock') {
      expect(violations, `tone violations: ${JSON.stringify(violations)}`).toEqual([])
      // Spoken-word recount: the cap (≤95) is enforced by counting rules,
      // not by trusting the model's own figure (review finding 9/14).
      const recount = countSpokenWords(run.output.parsed.pitchScript.script)
      expect(recount).toBeLessThanOrEqual(95)
      expect(Math.abs(recount - run.output.parsed.pitchScript.spokenWordCount)).toBeLessThanOrEqual(5)
    }
    else if (violations.length > 0) {
      test.info().annotations.push({ type: 'tone-net', description: JSON.stringify(violations) })
    }

    // ── activity_log: fire-and-forget → eventual-consistency polling ─────
    await expect.poll(async () => {
      const log = await (await api.get('/api/activity-log', {
        params: { resourceType: 'ai_run', resourceId: run.id },
      })).json()
      return log.data?.some((e: { action: string, metadata?: { stepKey?: string, status?: string } }) =>
        e.action === 'created' && e.metadata?.stepKey === 'candidate_contact' && e.metadata?.status === 'succeeded',
      ) ?? false
    }, { timeout: 5000, intervals: [250, 500] }).toBe(true)
  })

  test('2. generate on a step with no resolvable prompt (step 6) → 422', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const applicationId = await makeApplication(api, 'NoPrompt')

    const steps = await getWorkflowSteps(api, applicationId)
    const step6 = steps.find(i => i.stepTemplate.stepNumber === 6)!
    expect(step6.stepTemplate.key).toBe('candidate_profile')

    const genRes = await api.post(`/api/step-instances/${step6.id}/ai-runs`, { data: {}, timeout: 90_000 })
    expect(genRes.status(), 'no prompt configured → 422').toBe(422)
  })

  test('3. review: approve → approved; double-review → 409; fresh run reject with note; non-succeeded re-review → 409', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const applicationId = await makeApplication(api, 'Review')

    const steps = await getWorkflowSteps(api, applicationId)
    const step5 = steps.find(i => i.stepTemplate.stepNumber === 5)!

    const gen1 = await (await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {}, timeout: 90_000 })).json()
    expect(gen1.status).toBe('succeeded')

    const approve = await api.post(`/api/ai-runs/${gen1.id}/review`, { data: { decision: 'approve' } })
    expect(approve.status(), 'approve').toBe(200)
    const approved = await approve.json()
    expect(approved.status).toBe('approved')
    expect(approved.reviewedById).toBeTruthy()
    expect(approved.reviewedAt).toBeTruthy()

    // One-shot: the conditional UPDATE guard hits any non-'succeeded' state
    // (approved here; 'failed' runs take the identical code path).
    const again = await api.post(`/api/ai-runs/${gen1.id}/review`, { data: { decision: 'approve' } })
    expect(again.status(), 'double review → 409').toBe(409)

    // Fresh run → reject with note
    const gen2 = await (await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {}, timeout: 90_000 })).json()
    const reject = await api.post(`/api/ai-runs/${gen2.id}/review`, { data: { decision: 'reject', note: 'Not applicable to this candidate' } })
    expect(reject.status(), 'reject').toBe(200)
    const rejected = await reject.json()
    expect(rejected.status).toBe('rejected')
    expect(rejected.reviewNote).toBe('Not applicable to this candidate')

    const rejectedAgain = await api.post(`/api/ai-runs/${gen2.id}/review`, { data: { decision: 'approve' } })
    expect(rejectedAgain.status(), 'review of rejected run → 409').toBe(409)
  })

  test('4. generate on a completed instance → 409', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const applicationId = await makeApplication(api, 'Terminal')

    const steps = await getWorkflowSteps(api, applicationId)
    const step5 = steps.find(i => i.stepTemplate.stepNumber === 5)!

    const complete = await api.patch(`/api/step-instances/${step5.id}`, {
      data: { action: 'complete', completionData: { contactOutcome: 'done' } },
    })
    expect(complete.status()).toBe(200)

    const genRes = await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {}, timeout: 90_000 })
    expect(genRes.status(), 'terminal step → 409').toBe(409)
  })

  test('5. concurrency: two parallel generates → exactly one 200, one 409', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const applicationId = await makeApplication(api, 'Race')

    const steps = await getWorkflowSteps(api, applicationId)
    const step5 = steps.find(i => i.stepTemplate.stepNumber === 5)!

    const [r1, r2] = await Promise.all([
      api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {}, timeout: 90_000 }),
      api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {}, timeout: 90_000 }),
    ])
    const statuses = [r1.status(), r2.status()].sort()
    expect(statuses, 'claim serialization: one 200, one 409').toEqual([200, 409])
  })

  test('6. cross-org: GET list + POST generate + POST review with foreign IDs → 404', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const applicationId = await makeApplication(api, 'Iso')
    const steps = await getWorkflowSteps(api, applicationId)
    const step5 = steps.find(i => i.stepTemplate.stepNumber === 5)!
    const run = await (await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {}, timeout: 90_000 })).json()

    // ── Fixture org A exists; create org B and switch to it ──────────────
    const slugB = `ai-iso-b-${runId}`
    const createRes = await api.post('/api/auth/organization/create', {
      data: { name: `AI Isolation B ${runId}`, slug: slugB },
      headers: { Origin: BASE },
    })
    expect(createRes.status(), 'org B create').toBe(200)

    const orgs = await (await api.get('/api/auth/organization/list', { headers: { Origin: BASE } })).json()
    const orgB = orgs.map((o: any) => o.organization ?? o).find((o: { slug: string }) => o.slug === slugB)!
    const setActive = await api.post('/api/auth/organization/set-active', {
      data: { organizationId: orgB.id },
      headers: { Origin: BASE },
    })
    expect(setActive.status(), 'set-active org B').toBe(200)

    try {
      const listRes = await api.get(`/api/step-instances/${step5.id}/ai-runs`)
      expect(listRes.status(), 'foreign instance list → 404').toBe(404)

      const genRes = await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {}, timeout: 90_000 })
      expect(genRes.status(), 'foreign instance generate → 404').toBe(404)

      const reviewRes = await api.post(`/api/ai-runs/${run.id}/review`, { data: { decision: 'approve' } })
      expect(reviewRes.status(), 'foreign run review → 404').toBe(404)
    }
    finally {
      // Switch back so the fixture's after-hooks stay in org A
      const orgsNow = await (await api.get('/api/auth/organization/list', { headers: { Origin: BASE } })).json()
      const orgA = orgsNow.map((o: any) => o.organization ?? o).find((o: { slug: string }) => o.slug !== slugB)!
      await api.post('/api/auth/organization/set-active', {
        data: { organizationId: orgA.id },
        headers: { Origin: BASE },
      })
    }
  })

  test('7. GET list ordering: newest first', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const applicationId = await makeApplication(api, 'Order')

    const steps = await getWorkflowSteps(api, applicationId)
    const step5 = steps.find(i => i.stepTemplate.stepNumber === 5)!

    const run1 = await (await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {}, timeout: 90_000 })).json()
    const run2 = await (await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {}, timeout: 90_000 })).json()
    expect(run1.id).not.toBe(run2.id)

    const list = await (await api.get(`/api/step-instances/${step5.id}/ai-runs`)).json()
    expect(list.runs.length).toBeGreaterThanOrEqual(2)
    expect(list.runs[0].id).toBe(run2.id)
    expect(list.runs[1].id).toBe(run1.id)
    expect(list.runs[0].promptTemplate.name).toContain('First-approach call prep')
    expect(list.runs[0].promptTemplate.version).toBe(2)
  })

  test('8. generate on steps 11 and 20: mock shape + tone net (no vacuous pass)', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const applicationId = await makeApplication(api, 'Steps1120')

    const steps = await getWorkflowSteps(api, applicationId)
    const step11 = steps.find(i => i.stepTemplate.stepNumber === 11)!
    expect(step11.stepTemplate.key).toBe('candidate_debrief')
    const step20 = steps.find(i => i.stepTemplate.stepNumber === 20)!
    expect(step20.stepTemplate.key).toBe('closing_negotiating')

    const gen11 = await api.post(`/api/step-instances/${step11.id}/ai-runs`, { data: {}, timeout: 90_000 })
    expect(gen11.status(), 'step 11 generate').toBe(200)
    const run11 = await gen11.json()
    expect(run11.status).toBe('succeeded')
    expect(run11.promptTemplate.version).toBe(2)
    expect(run11.promptSnapshot.systemPrompt).not.toMatch(/Recruit2Recruit|\bR2R\b|rec-to-rec/i)

    const gen20 = await api.post(`/api/step-instances/${step20.id}/ai-runs`, { data: {}, timeout: 90_000 })
    expect(gen20.status(), 'step 20 generate').toBe(200)
    const run20 = await gen20.json()
    expect(run20.status).toBe('succeeded')
    expect(run20.promptTemplate.version).toBe(2)
    expect(run20.promptSnapshot.systemPrompt).not.toMatch(/Recruit2Recruit|\bR2R\b|rec-to-rec/i)

    if (run11.provider === 'mock') {
      // Shape (mock determinism) — also guards the tone net against
      // scanning empty objects and passing vacuously (fable finding 9).
      expect(run11.output.parsed).toHaveProperty('summary')
      expect(run11.output.parsed).toHaveProperty('interestLevel')
      expect(run11.output.parsed.concerns.length).toBeGreaterThan(0)
      expect(run11.output.parsed).toHaveProperty('nextActions')
      expect(run20.output.parsed).toHaveProperty('candidatePosition')
      expect(run20.output.parsed).toHaveProperty('counterScenarioPlan')
      expect(run20.output.parsed.counterScenarioPlan.doNotShare.length).toBeGreaterThan(0)
      expect(run20.output.parsed.riskFlags.length).toBeGreaterThan(0)

      const v11 = findToneViolations(run11.output.parsed, run11.inputSnapshot)
      expect(v11, `step-11 tone violations: ${JSON.stringify(v11)}`).toEqual([])
      const v20 = findToneViolations(run20.output.parsed, run20.inputSnapshot)
      expect(v20, `step-20 tone violations: ${JSON.stringify(v20)}`).toEqual([])
    }
    else {
      for (const [label, run] of [['step-11', run11], ['step-20', run20]] as const) {
        const v = findToneViolations(run.output.parsed, run.inputSnapshot)
        if (v.length > 0) test.info().annotations.push({ type: `tone-net-${label}`, description: JSON.stringify(v) })
      }
    }
  })

  test('9. prompt data integrity: v1 byte-frozen (hash-pinned), v2 neutral, R2R v2 derivation complete', async () => {
    const pinned: Record<string, string> = {
      'candidate_contact.systemPrompt': 'fac46afb22100371',
      'candidate_contact.userPromptTemplate': 'bf66b888259306ee',
      'candidate_contact.safetyNotes': '5dac63566dbb59e5',
      'candidate_debrief.systemPrompt': '97a5aee090d7038a',
      'candidate_debrief.userPromptTemplate': 'd540b74f0a79abff',
      'candidate_debrief.safetyNotes': '339259384cf0efa4',
      'closing_negotiating.systemPrompt': 'cc3cb344a3f999ad',
      'closing_negotiating.userPromptTemplate': 'e6ba1c0a3db34eb5',
      'closing_negotiating.safetyNotes': '4f33b2c57b596141',
    }
    for (const p of DEFAULT_AI_PROMPTS.filter(p => p.version === 1)) {
      for (const f of ['systemPrompt', 'userPromptTemplate', 'safetyNotes'] as const) {
        const h = createHash('sha256').update(p[f]).digest('hex').slice(0, 16)
        expect(h, `${p.stepKey}.${f} changed — v1 is byte-frozen; add a v3 instead`).toBe(pinned[`${p.stepKey}.${f}`])
      }
    }

    // Platform v2: neutral — no R2R-specific vocabulary anywhere
    const R2R = /Recruit2Recruit|\bR2R\b|rec-to-rec/i
    for (const p of DEFAULT_AI_PROMPTS.filter(p => p.version === 2)) {
      expect(R2R.test(p.systemPrompt), `${p.stepKey} v2 systemPrompt`).toBe(false)
      expect(R2R.test(p.userPromptTemplate), `${p.stepKey} v2 userPromptTemplate`).toBe(false)
      expect(R2R.test(p.safetyNotes), `${p.stepKey} v2 safetyNotes`).toBe(false)
    }

    // R2R v2 = v1 + TCC edits + softened close (owner decision 2026-09-29)
    const r2r5 = R2R_AI_PROMPTS.find(p => p.stepKey === 'candidate_contact' && p.version === 2)!
    expect(r2r5.systemPrompt).toContain('WHY THESE RULES EXIST')
    expect(r2r5.systemPrompt).toContain('saying no should be easy')
    expect(r2r5.systemPrompt).toContain('\'Neither\' is an acceptable answer')
    expect(r2r5.systemPrompt).not.toContain('which may I pencil in')
    expect(r2r5.systemPrompt).not.toContain('enticing')
    expect(r2r5.systemPrompt).toContain('Write only field content')

    const r2r20 = R2R_AI_PROMPTS.find(p => p.stepKey === 'closing_negotiating' && p.version === 2)!
    expect(r2r20.systemPrompt).toContain('manage both sides')
    expect(r2r20.systemPrompt).not.toContain('Negotiate for the candidate within')

    // Resolver contract: any org row beats any platform row, any version —
    // which is exactly why R2R needed its own v2 rows (review finding 13).
    expect(R2R_AI_PROMPTS.filter(p => p.version === 1)).toHaveLength(3)
    expect(R2R_AI_PROMPTS.filter(p => p.version === 2)).toHaveLength(3)
  })
})
