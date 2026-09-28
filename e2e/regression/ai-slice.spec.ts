import { test, expect } from '../fixtures'

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
    const genRes = await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {} })
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

    const genRes = await api.post(`/api/step-instances/${step6.id}/ai-runs`, { data: {} })
    expect(genRes.status(), 'no prompt configured → 422').toBe(422)
  })

  test('3. review: approve → approved; double-review → 409; fresh run reject with note; non-succeeded re-review → 409', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const applicationId = await makeApplication(api, 'Review')

    const steps = await getWorkflowSteps(api, applicationId)
    const step5 = steps.find(i => i.stepTemplate.stepNumber === 5)!

    const gen1 = await (await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {} })).json()
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
    const gen2 = await (await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {} })).json()
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

    const genRes = await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {} })
    expect(genRes.status(), 'terminal step → 409').toBe(409)
  })

  test('5. concurrency: two parallel generates → exactly one 200, one 409', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const applicationId = await makeApplication(api, 'Race')

    const steps = await getWorkflowSteps(api, applicationId)
    const step5 = steps.find(i => i.stepTemplate.stepNumber === 5)!

    const [r1, r2] = await Promise.all([
      api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {} }),
      api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {} }),
    ])
    const statuses = [r1.status(), r2.status()].sort()
    expect(statuses, 'claim serialization: one 200, one 409').toEqual([200, 409])
  })

  test('6. cross-org: GET list + POST generate + POST review with foreign IDs → 404', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const applicationId = await makeApplication(api, 'Iso')
    const steps = await getWorkflowSteps(api, applicationId)
    const step5 = steps.find(i => i.stepTemplate.stepNumber === 5)!
    const run = await (await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {} })).json()

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

      const genRes = await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {} })
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

    const run1 = await (await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {} })).json()
    const run2 = await (await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: {} })).json()
    expect(run1.id).not.toBe(run2.id)

    const list = await (await api.get(`/api/step-instances/${step5.id}/ai-runs`)).json()
    expect(list.runs.length).toBeGreaterThanOrEqual(2)
    expect(list.runs[0].id).toBe(run2.id)
    expect(list.runs[1].id).toBe(run1.id)
    expect(list.runs[0].promptTemplate.name).toContain('1st pitch prep')
    expect(list.runs[0].promptTemplate.version).toBe(1)
  })
})
