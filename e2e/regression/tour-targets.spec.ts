import { test, expect } from '../fixtures'
import { tours } from '../../app/tours'
import { getTour } from '../../app/tours'

/**
 * Guided tours — target existence (PRD Phase 1 item 4).
 *
 * For every shipped tour definition, load the page it targets with the
 * conditions its targets need present, and assert each anchored step's
 * [data-tour="…"] element exists in the live DOM. This catches UI changes
 * that break tours (renamed/removed/reconditionalised anchors) — the same
 * drift the launcher gracefully skips at runtime.
 *
 * Definitions are imported from app/tours (the registry the UI runs), so
 * this spec cannot pass while the config and the markup disagree.
 */

const runId = Date.now()

// Routes + setup hints per tour, keyed by tour id.
const tourPages: Record<string, string> = {
  'getting-started': '/dashboard',
  'add-client-company': '/dashboard/companies',
  'add-candidate': '/dashboard/candidates',
  'workflow-panel': '/dashboard/applications',
}

test.describe('Tour targets exist in the DOM', () => {
  for (const tour of tours) {
    test(`${tour.id}: every anchored step target is present`, async ({ authenticatedPage }) => {
      const page = authenticatedPage
      const api = page.request

      // ── Per-tour data setup so conditional targets render ────────────────
      if (tour.id === 'getting-started') {
        // jobs-needs-attention only renders with an open job + new applicant.
        const jobRes = await api.post('/api/jobs', { data: { title: `Tour GS ${runId}` } })
        expect(jobRes.status()).toBe(201)
        const job = await jobRes.json()
        await api.patch(`/api/jobs/${job.id}`, { data: { status: 'open' } })
        const applyRes = await api.post(`/api/public/jobs/${job.slug}/apply`, {
          data: {
            firstName: 'Tour',
            lastName: 'Guide',
            email: `tour-gs-${runId}@example.com`,
            responses: [],
          },
        })
        expect(applyRes.status()).toBeLessThan(300)
      }

      if (tour.id === 'add-candidate') {
        // candidates-list only renders when at least one candidate exists.
        const candidateRes = await api.post('/api/candidates', {
          data: {
            firstName: 'Tour',
            lastName: 'Candidate',
            email: `tour-cand-${runId}@example.com`,
          },
        })
        expect([200, 201]).toContain(candidateRes.status())
      }

      if (tour.id === 'add-client-company') {
        // companies-list only renders when at least one company exists.
        const companyRes = await api.post('/api/client-companies', {
          data: { name: `Tour Client Co ${runId}` },
        })
        expect([200, 201]).toContain(companyRes.status())
      }

      if (tour.id === 'workflow-panel') {
        // An application detail page with an active workflow instance.
        // (The public apply endpoint returns { success: true } only — find
        // the application through the list UI, like workflow-panel-ui.spec.)
        const jobRes = await api.post('/api/jobs', { data: { title: `Tour WF ${runId}` } })
        expect(jobRes.status()).toBe(201)
        const job = await jobRes.json()
        await api.patch(`/api/jobs/${job.id}`, { data: { status: 'open' } })
        const applyRes = await api.post(`/api/public/jobs/${job.slug}/apply`, {
          data: {
            firstName: 'TourWorkflow',
            lastName: `${runId}`,
            email: `tour-wf-${runId}@example.com`,
            responses: [],
          },
        })
        expect(applyRes.status()).toBeLessThan(300)

        await page.goto('/dashboard/applications')
        await page.waitForLoadState('networkidle')
        const row = page.getByText(`TourWorkflow ${runId}`).first()
        await expect(row).toBeVisible({ timeout: 15_000 })
        await row.click()
        await page.waitForURL(/\/dashboard\/applications\//, { timeout: 15_000 })
        await expect(page.locator('[data-tour="workflow-panel"]').first()).toBeVisible({ timeout: 15_000 })
      }
      else {
        await page.goto(tourPages[tour.id]!)
        await page.waitForLoadState('networkidle')
      }

      // ── Assert every anchored target exists ──────────────────────────────
      for (const step of tour.steps) {
        if (!step.target) continue // modal step — nothing to anchor
        const target = page.locator(`[data-tour="${step.target}"]`).first()
        await expect(
          target,
          `tour "${tour.id}" step "${step.title}": [data-tour="${step.target}"] missing`,
        ).toBeVisible({ timeout: 15_000 })
      }
    })
  }

  test('registry sanity: ids unique, steps non-empty, at least one anchored step', () => {
    const ids = tours.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const tour of tours) {
      expect(tour.steps.length, `${tour.id} has no steps`).toBeGreaterThan(0)
      expect(
        tour.steps.some(s => s.target),
        `${tour.id} has no anchored steps (all-modal tours skip the target net)`,
      ).toBe(true)
    }
    // The helper used by the launcher must resolve each tour on its page.
    for (const [id, path] of Object.entries(tourPages)) {
      expect(getTour(id), `tour ${id} in registry`).toBeDefined()
      expect(path.startsWith('/'), `${id} has a test page route`).toBe(true)
    }
  })
})
