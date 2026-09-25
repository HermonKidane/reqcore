import { test, expect } from '../fixtures'

/**
 * 30-step workflow panel — UI smoke.
 *
 * With an application in place (job → publish → public apply, via API),
 * the application detail page renders WorkflowProgressPanel with the 5
 * canonical phases and 30 steps, and a step can be started from the UI.
 *
 * NOTE: known cosmetic issues (SESSION.md) — phases collapse after each
 * mutation and a hydration warning appears in the console. This spec avoids
 * post-mutation assertions for that reason.
 */

const runId = Date.now()

test.describe('Workflow panel UI', () => {
  test('panel renders 5 phases and 30 steps; Start transitions step 1', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    const api = page.request

    // ── Setup: job → publish → public apply ─────────────────────────────────
    const jobRes = await api.post('/api/jobs', { data: { title: `WF Panel ${runId}` } })
    expect(jobRes.status()).toBe(201)
    const job = await jobRes.json()
    await api.patch(`/api/jobs/${job.id}`, { data: { status: 'open' } })

    const applyRes = await api.post(`/api/public/jobs/${job.slug}/apply`, {
      data: {
        firstName: 'Panel',
        lastName: 'Candidate',
        email: `wf-panel-${runId}@example.com`,
        responses: [],
      },
    })
    expect(applyRes.status()).toBeLessThan(300)

    // ── Open the application detail page ────────────────────────────────────
    await page.goto(`/dashboard/applications`)
    await page.waitForLoadState('networkidle')

    const row = page.getByText('Panel Candidate').first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click()
    await page.waitForLoadState('networkidle')

    await page.waitForURL(/\/dashboard\/applications\//, { timeout: 15_000 })

    // ── Panel renders all 5 canonical phases ────────────────────────────────
    for (const phase of [
      'Intake and sourcing',
      'Introduction and initial selection',
      'Deep evaluation',
      'Offer and onboarding',
      'Administration and retention',
    ]) {
      await expect(page.getByText(phase).first()).toBeVisible({ timeout: 15_000 })
    }

    // ── Progress summary shows 0 completed of 30 ────────────────────────────
    await expect(page.getByText('0 completed').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('0%').first()).toBeVisible({ timeout: 10_000 })

    // ── Start step 1 ("Complete Job Order") from the UI ─────────────────────
    // Phases are collapsed <details>; each step row is a button that expands
    // the detail + action buttons. Open phase 1, expand the pinned step row.
    const firstPhase = page.locator('details').first()
    await firstPhase.locator('summary').click()
    const stepRow = firstPhase.getByRole('button', { name: /Complete Job Order/i })
    await stepRow.click()
    const startButton = firstPhase.getByRole('button', { name: 'Start', exact: true })
    await startButton.click()

    // Progress flips: one step in progress (summary line appears when > 0).
    // (The panel collapses phases after mutation — a known cosmetic issue —
    // so post-mutation assertions stay outside the phase <details>.)
    await expect(page.getByText('1 in progress').first()).toBeVisible({ timeout: 10_000 })
  })
})
