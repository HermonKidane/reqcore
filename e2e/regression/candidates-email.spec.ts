import { test, expect } from '../fixtures'

/**
 * Regression: candidate CRUD through the unified email write path
 * (server/utils/candidateEmail.ts — the ONLY writer of candidate.email).
 *
 * Covers: create (201 + cache sync), exact + case-variant duplicate → 409,
 * primary-email patch swap, taking another candidate's email → 409,
 * whitespace email → 400, cross-org/inexistent id → 404, delete → 204.
 *
 * Runs against the sandbox; each test gets a FRESH org from the fixture,
 * so org-wide email uniqueness is exercised within one tenant.
 */

const runId = Date.now()

test.describe('Candidate CRUD + unified email path', () => {
  test('create / dup-409 (exact + case-variant) / patch-primary / ownership 409 / delete', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const email = `crud-${runId}@example.com`

    // ── Create ──────────────────────────────────────────────────────────────
    const createRes = await api.post('/api/candidates', {
      data: { firstName: 'Crud', lastName: 'Test', email },
    })
    expect(createRes.status(), 'create should be 201').toBe(201)
    const created = await createRes.json()
    expect(created.id).toBeTruthy()
    expect(created.email, 'cache synced at create').toBe(email)

    // ── Exact duplicate → 409 ────────────────────────────────────────────────
    const dupExact = await api.post('/api/candidates', {
      data: { firstName: 'Dup', lastName: 'Exact', email },
    })
    expect(dupExact.status()).toBe(409)

    // ── Case-variant duplicate → 409 (normalized uniqueness) ────────────────
    const dupVariant = await api.post('/api/candidates', {
      data: { firstName: 'Dup', lastName: 'Variant', email: email.toUpperCase() },
    })
    expect(dupVariant.status()).toBe(409)

    // A 409 alone doesn't prove the row wasn't written — count must stay 1
    const afterDups = await (await api.get('/api/candidates', { params: { search: `crud-${runId}` } })).json()
    expect(afterDups.total).toBe(1)

    // ── Whitespace-only email → rejected by validation ──────────────────────
    const blank = await api.post('/api/candidates', {
      data: { firstName: 'Blank', lastName: 'Email', email: '   ' },
    })
    expect(blank.status()).toBe(400)

    // ── GET reflects the synced cache ───────────────────────────────────────
    const gotRes = await api.get(`/api/candidates/${created.id}`)
    expect(gotRes.status()).toBe(200)
    const got = await gotRes.json()
    expect(got.email).toBe(email)

    // ── Patch: primary email swap via replacePrimaryEmail ───────────────────
    const email2 = `crud2-${runId}@example.com`
    const patchRes = await api.patch(`/api/candidates/${created.id}`, {
      data: { email: email2 },
    })
    expect(patchRes.status()).toBe(200)
    const patched = await patchRes.json()
    expect(patched.email, 'cache after primary swap').toBe(email2)

    const got2 = await (await api.get(`/api/candidates/${created.id}`)).json()
    expect(got2.email).toBe(email2)

    // ── Patch: taking another candidate's email → 409 ───────────────────────
    const otherRes = await api.post('/api/candidates', {
      data: { firstName: 'Other', lastName: 'Person', email: `other-${runId}@example.com` },
    })
    expect(otherRes.status()).toBe(201)
    const other = await otherRes.json()

    const steal = await api.patch(`/api/candidates/${created.id}`, {
      data: { email: other.email },
    })
    expect(steal.status()).toBe(409)

    // ── Nonexistent id → 404 ────────────────────────────────────────────────
    const missing = await api.patch('/api/candidates/does-not-exist', {
      data: { firstName: 'Nobody' },
    })
    expect(missing.status()).toBe(404)

    // ── Non-email field patch still works ───────────────────────────────────
    const namePatch = await api.patch(`/api/candidates/${created.id}`, {
      data: { firstName: 'Renamed' },
    })
    expect(namePatch.status()).toBe(200)
    expect((await namePatch.json()).firstName).toBe('Renamed')

    // ── Delete → 204, then gone ─────────────────────────────────────────────
    const del = await api.delete(`/api/candidates/${created.id}`)
    expect(del.status()).toBe(204)
    expect((await api.get(`/api/candidates/${created.id}`)).status()).toBe(404)
  })
})
