import { test, expect } from '../fixtures'

/**
 * Org switching — UI smoke.
 *
 * Creates a second organization via the better-auth API (same calls the
 * OrgSwitcher component makes), then uses the sidebar OrgSwitcher dropdown
 * to switch the active org and verifies the top bar reflects it.
 *
 * Requires an explicit Origin header on better-auth mutations (sandbox
 * better-auth 403s set-active without it).
 */

const runId = Date.now()
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('Org switching UI', () => {
  test('OrgSwitcher switches active org and the UI follows', async ({ authenticatedPage, testAccount }) => {
    const page = authenticatedPage
    const api = page.request

    const slugB = `switch-b-${runId}`
    const nameB = `Switch B ${runId}`

    // Capture org A's id BEFORE creating B (organization.create auto-switches
    // the active org to the new one in better-auth).
    const orgsBefore = await (await api.get('/api/auth/organization/list', { headers: { Origin: BASE } })).json()
    const orgA = orgsBefore.map((o: { organization: { id: string, slug: string } }) => o.organization ?? o)
      .find((o: { slug: string }) => o.slug !== slugB)
    expect(orgA, 'org A present').toBeTruthy()

    // ── Create org B (better-auth makes B active automatically) ─────────────
    const createRes = await api.post('/api/auth/organization/create', {
      data: { name: nameB, slug: slugB },
      headers: { Origin: BASE },
    })
    expect(createRes.status()).toBe(200)

    // Return the session to org A so the UI starts in a known state
    await api.post('/api/auth/organization/set-active', {
      data: { organizationId: orgA.id },
      headers: { Origin: BASE },
    })

    // ── Dashboard shows org A ───────────────────────────────────────────────
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(testAccount.orgName).first()).toBeVisible({ timeout: 15_000 })

    // ── Open the switcher and pick org B ────────────────────────────────────
    // The OrgSwitcher trigger is the button whose accessible name contains
    // the active org name (name + " ▼"). Target it directly — a generic
    // div filter mis-clicks sidebar nav buttons and fails as a fake product bug.
    await page.getByRole('button', { name: new RegExp(testAccount.orgName) }).first().click()
    await page.getByRole('button', { name: nameB }).click()

    // The switcher button now shows org B
    await expect(page.getByRole('button', { name: new RegExp(nameB) })).toBeVisible({ timeout: 15_000 })

    // ── Verify the SERVER agrees: marker candidate landed in org B ──────────
    const orgs = await (await api.get('/api/auth/organization/list', { headers: { Origin: BASE } })).json()
    const orgB = orgs.map((o: { organization: { id: string, slug: string } }) => o.organization ?? o)
      .find((o: { slug: string }) => o.slug === slugB)
    expect(orgB, 'org B exists').toBeTruthy()

    // After the UI switch, the active org server-side should already be B —
    // creating a candidate lands in B (proving the session switched).
    const markerEmail = `switch-marker-${runId}@example.com`
    const created = await api.post('/api/candidates', {
      data: { firstName: 'Switch', lastName: 'Marker', email: markerEmail },
    })
    expect(created.status()).toBe(201)
    const candidate = await created.json()

    // Switch back to A via API; marker candidate must be invisible
    const back = await api.post('/api/auth/organization/set-active', {
      data: { organizationId: orgA.id },
      headers: { Origin: BASE },
    })
    expect(back.status()).toBe(200)
    expect((await api.get(`/api/candidates/${candidate.id}`)).status(), 'marker invisible from org A').toBe(404)
  })
})
