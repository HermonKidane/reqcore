import { test, expect } from '../fixtures'

/**
 * 30-step workflow regression (API level).
 *
 * - GET /api/applications/:id/workflow lazily creates a workflow with 30
 *   step instances across 5 phases (idempotent)
 * - PATCH step-instances: start → in_progress; complete with missing
 *   requiredFields → 422; complete with fields → completed
 * - terminal step rejects further mutations → 409
 * - step events recorded (immutable history)
 *
 * Setup (job → publish → public apply) is done via API; each test's fresh
 * org gets its own lazily-seeded canonical steps.
 */

const runId = Date.now()

async function makeApplication(api: import('@playwright/test').APIRequestContext, label: string): Promise<string> {
  const jobRes = await api.post('/api/jobs', { data: { title: `WF ${label} ${runId}` } })
  expect(jobRes.status()).toBe(201)
  const job = await jobRes.json()
  await api.patch(`/api/jobs/${job.id}`, { data: { status: 'open' } })

  const applyRes = await api.post(`/api/public/jobs/${job.slug}/apply`, {
    data: {
      firstName: 'Wf',
      lastName: label,
      email: `wf-${label.toLowerCase()}-${runId}@example.com`,
      responses: [],
    },
  })
  expect(applyRes.status(), 'public apply').toBeGreaterThanOrEqual(200)
  expect(applyRes.status()).toBeLessThan(300)

  const apps = await (await api.get('/api/applications', { params: { jobId: job.id } })).json()
  expect(apps.total).toBeGreaterThanOrEqual(1)
  return apps.data[0].id as string
}

test.describe('30-step workflow API', () => {
  test('lazy-create 30 steps / 5 phases; transitions; 422 on missing fields; 409 on terminal', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const applicationId = await makeApplication(api, 'Api')

    // ── GET workflow lazily creates 30 instances in 5 phases ────────────────
    const wf1 = await (await api.get(`/api/applications/${applicationId}/workflow`)).json()
    expect(wf1.workflow.status).toBe('active')
    expect(wf1.instances).toHaveLength(30)

    const phaseNames = new Set(wf1.instances.map((i: { stepTemplate: { phase: string } }) => i.stepTemplate.phase))
    expect(phaseNames.size, 'five phases').toBe(5)
    expect(wf1.instances.every((i: { status: string }) => i.status === 'pending')).toBe(true)

    // ── Idempotent: second GET does not duplicate ───────────────────────────
    const wf2 = await (await api.get(`/api/applications/${applicationId}/workflow`)).json()
    expect(wf2.instances).toHaveLength(30)

    // ── Start step 1 ─────────────────────────────────────────────────────────
    const step1 = wf1.instances.find((i: { stepTemplate: { stepNumber: number } }) => i.stepTemplate.stepNumber === 1)
    const startRes = await api.patch(`/api/step-instances/${step1.id}`, { data: { action: 'start' } })
    expect(startRes.status()).toBe(200)
    expect((await startRes.json()).status).toBe('in_progress')

    // ── Complete with missing requiredFields → 422 ──────────────────────────
    const required = step1.stepTemplate.requiredFields as string[]
    // Canonical step 1 ("Complete Job Order") carries requiredFields; fail
    // loudly if seed data ever changes, rather than silently skipping the 422.
    expect(required.length, 'step 1 must have requiredFields for the 422 check').toBeGreaterThan(0)
    const incomplete = await api.patch(`/api/step-instances/${step1.id}`, {
      data: { action: 'complete', completionData: {} },
    })
    expect(incomplete.status(), `missing ${required.join(',')} → 422`).toBe(422)

    const completeRes = await api.patch(`/api/step-instances/${step1.id}`, {
      data: {
        action: 'complete',
        completionData: Object.fromEntries(required.map((f: string) => [f, `test-${f}`])),
      },
    })
    expect(completeRes.status()).toBe(200)
    expect((await completeRes.json()).status).toBe('completed')

    // ── Terminal step rejects further mutation → 409 ────────────────────────
    const again = await api.patch(`/api/step-instances/${step1.id}`, { data: { action: 'start' } })
    expect(again.status(), 'completed step is terminal').toBe(409)

    // ── Block/unblock cycle on step 2 ───────────────────────────────────────
    const step2 = wf1.instances.find((i: { stepTemplate: { stepNumber: number } }) => i.stepTemplate.stepNumber === 2)
    const blockRes = await api.patch(`/api/step-instances/${step2.id}`, {
      data: { action: 'block', reason: 'Waiting on client feedback' },
    })
    expect(blockRes.status()).toBe(200)
    expect((await blockRes.json()).status).toBe('blocked')

    const unblockRes = await api.patch(`/api/step-instances/${step2.id}`, { data: { action: 'unblock' } })
    expect(unblockRes.status()).toBe(200)
    expect((await unblockRes.json()).status).toBe('pending')

    // ── Immutable event history recorded ────────────────────────────────────
    const eventsBody = await (await api.get(`/api/step-instances/${step1.id}/events`)).json()
    const eventActions = eventsBody.events.map((e: { eventType: string }) => e.eventType)
    expect(eventActions).toContain('started')
    expect(eventActions).toContain('completed')

    // ── Workflow GET still coherent (not reset by reads — terminal GET fix) ─
    const wf3 = await (await api.get(`/api/applications/${applicationId}/workflow`)).json()
    const step1After = wf3.instances.find((i: { id: string }) => i.id === step1.id)
    expect(step1After.status).toBe('completed')
  })
})
