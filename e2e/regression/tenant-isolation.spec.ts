import { test, expect } from '../fixtures'

/**
 * Tenant isolation regression.
 *
 * One account, TWO organizations. Verifies:
 * - candidate created in org A is invisible from org B (404 on direct id,
 *   absent from list)
 * - cross-org PATCH is a 404, not a write
 * - org-wide email uniqueness is PER ORG: the same normalized email can
 *   exist once in A and once in B
 * - after switching back to org A, org B's candidates are invisible
 *
 * Org switching uses the better-auth endpoints directly (the same calls the
 * OrgSwitcher UI component makes), with an explicit Origin header — the
 * sandbox better-auth setup 403s set-active without it.
 */

const runId = Date.now()
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

interface OrgInfo { id: string, slug: string }

async function listOrgs(api: import('@playwright/test').APIRequestContext): Promise<OrgInfo[]> {
  const res = await api.get('/api/auth/organization/list', { headers: { Origin: BASE } })
  expect(res.status(), 'org list').toBe(200)
  const body = await res.json()
  return body.map((o: { organization: OrgInfo }) => o.organization ?? o)
}

async function setActiveOrg(api: import('@playwright/test').APIRequestContext, organizationId: string) {
  const res = await api.post('/api/auth/organization/set-active', {
    data: { organizationId },
    headers: { Origin: BASE },
  })
  expect(res.status(), `set-active ${organizationId}`).toBe(200)
}

test.describe('Tenant isolation (two orgs, one account)', () => {
  test('cross-org reads/writes rejected; email uniqueness is per-org', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request

    // ── Fixture org A already exists (fixture created it). Create org B ─────
    const slugB = `iso-b-${runId}`
    const createRes = await api.post('/api/auth/organization/create', {
      data: { name: `Isolation B ${runId}`, slug: slugB },
      headers: { Origin: BASE },
    })
    expect(createRes.status(), 'org B create').toBe(200)

    const orgs = await listOrgs(api)
    const orgA = orgs.find(o => o.slug !== slugB)!
    const orgB = orgs.find(o => o.slug === slugB)!
    expect(orgA, 'org A present').toBeTruthy()
    expect(orgB, 'org B present').toBeTruthy()

    // ── Create a candidate in org A ─────────────────────────────────────────
    await setActiveOrg(api, orgA.id)
    const emailShared = `iso-${runId}@example.com`
    const resA = await api.post('/api/candidates', {
      data: { firstName: 'Iso', lastName: 'Alpha', email: emailShared },
    })
    expect(resA.status()).toBe(201)
    const candA = await resA.json()

    // ── Switch to org B: candidate A invisible ──────────────────────────────
    await setActiveOrg(api, orgB.id)

    expect((await api.get(`/api/candidates/${candA.id}`)).status(), 'cross-org GET → 404').toBe(404)

    const crossPatch = await api.patch(`/api/candidates/${candA.id}`, {
      data: { firstName: 'Hacked' },
    })
    expect(crossPatch.status(), 'cross-org PATCH → 404').toBe(404)

    const crossDelete = await api.delete(`/api/candidates/${candA.id}`)
    expect(crossDelete.status(), 'cross-org DELETE → 404').toBe(404)

    const listB1 = await (await api.get('/api/candidates')).json()
    expect(
      listB1.data.find((c: { id: string }) => c.id === candA.id),
      'org B list must not contain org A candidate',
    ).toBeFalsy()

    // ── Same normalized email IS allowed in org B (per-org uniqueness) ──────
    const resB = await api.post('/api/candidates', {
      data: { firstName: 'Iso', lastName: 'Beta', email: emailShared.toUpperCase() },
    })
    expect(resB.status(), 'same email allowed in second org').toBe(201)
    const candB = await resB.json()
    expect(candB.id).not.toBe(candA.id)

    // ── But the duplicate rule still applies WITHIN org B ───────────────────
    const dupB = await api.post('/api/candidates', {
      data: { firstName: 'Dup', lastName: 'Beta', email: emailShared },
    })
    expect(dupB.status()).toBe(409)

    // ── Switch back to org A: org B's candidate invisible, A intact ─────────
    await setActiveOrg(api, orgA.id)
    const gotA = await (await api.get(`/api/candidates/${candA.id}`)).json()
    expect(gotA.email).toBe(emailShared)
    expect((await api.get(`/api/candidates/${candB.id}`)).status(), 'B candidate from A → 404').toBe(404)

    const listA = await (await api.get('/api/candidates')).json()
    expect(listA.data.find((c: { id: string }) => c.id === candB.id)).toBeFalsy()
  })
})
