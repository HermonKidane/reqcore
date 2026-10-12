import { test, expect } from '../fixtures'

/**
 * Regression: candidate fields 1.0 — manual Add/Edit catches up with the
 * extension capture.
 *
 * Covers: name-only create (email/LinkedIn optional), the six new fields
 * (linkedinUrl / position / company / location / headline / summary) on
 * create + read-back, LinkedIn-URL duplicate detection (org-scoped,
 * normalized) on create and edit, LinkedIn URL validation, null-clears on
 * patch, and the name-only UI flow.
 *
 * Runs against the sandbox; the fixture gives each test a FRESH org, and
 * one runId per run keeps the data identifiable. Everything created here
 * is deleted again.
 */

const runId = Date.now()

test.describe('Candidate fields 1.0', () => {
  test('API: optional email, six new fields, LinkedIn duplicates, patch semantics', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const createdIds: string[] = []
    const tryCleanup = async () => {
      for (const id of createdIds) {
        await api.delete(`/api/candidates/${id}`)
      }
    }

    try {
      // ── 1. Name only → 201, email null, linkedinUrl null ────────────────
      const nameOnlyRes = await api.post('/api/candidates', {
        data: { firstName: 'Name', lastName: `Only${runId}` },
      })
      expect(nameOnlyRes.status(), 'name-only create should be 201').toBe(201)
      const nameOnly = await nameOnlyRes.json()
      createdIds.push(nameOnly.id)
      expect(nameOnly.email, 'no email stored').toBeNull()
      expect(nameOnly.linkedinUrl, 'no linkedinUrl stored').toBeNull()

      // ── 2. All six fields, protocol-less LinkedIn URL → canonicalized ───
      const linkedinSlug = `cf-${runId}`
      const allFieldsRes = await api.post('/api/candidates', {
        data: {
          firstName: 'All',
          lastName: `Fields${runId}`,
          email: `fields-${runId}@example.com`,
          linkedinUrl: `linkedin.com/in/${linkedinSlug}`,
          position: 'Staff Engineer',
          company: 'Acme Corp',
          location: 'London, UK',
          headline: 'Builder of things',
          summary: 'A short professional summary.',
        },
      })
      expect(allFieldsRes.status(), 'full create should be 201').toBe(201)
      const allFields = await allFieldsRes.json()
      createdIds.push(allFields.id)
      expect(allFields.linkedinUrl).toBe(`https://linkedin.com/in/${linkedinSlug}`)
      expect(allFields.position).toBe('Staff Engineer')
      expect(allFields.company).toBe('Acme Corp')
      expect(allFields.location).toBe('London, UK')
      expect(allFields.headline).toBe('Builder of things')
      expect(allFields.summary).toBe('A short professional summary.')

      // GET returns the same
      const gotRes = await api.get(`/api/candidates/${allFields.id}`)
      expect(gotRes.status()).toBe(200)
      const got = await gotRes.json()
      expect(got.linkedinUrl).toBe(`https://linkedin.com/in/${linkedinSlug}`)
      expect(got.position).toBe('Staff Engineer')
      expect(got.company).toBe('Acme Corp')
      expect(got.location).toBe('London, UK')
      expect(got.headline).toBe('Builder of things')
      expect(got.summary).toBe('A short professional summary.')

      // ── 3. Duplicate by normalized LinkedIn URL → 409, count stays 1 ────
      const dupRes = await api.post('/api/candidates', {
        data: {
          firstName: 'Dup',
          lastName: `Fields${runId}`,
          linkedinUrl: `https://www.linkedin.com/in/CF-${runId}/?x=1`,
        },
      })
      expect(dupRes.status(), 'normalized LinkedIn duplicate should be 409').toBe(409)

      // A 409 alone doesn't prove the row wasn't written — count must stay 1
      const afterDup = await (await api.get('/api/candidates', { params: { search: `Fields${runId}` } })).json()
      expect(afterDup.total).toBe(1)

      // ── 4. Non-LinkedIn URL → 400 ───────────────────────────────────────
      const badUrlRes = await api.post('/api/candidates', {
        data: { firstName: 'Bad', lastName: `Url${runId}`, linkedinUrl: 'https://example.com/me' },
      })
      expect(badUrlRes.status(), 'non-LinkedIn URL should be 400').toBe(400)

      // ── 5. Patch: other candidate's URL → 409; own URL (respelled) → 200;
      //         null clears ────────────────────────────────────────────────
      const steal = await api.patch(`/api/candidates/${nameOnly.id}`, {
        data: { linkedinUrl: `https://www.linkedin.com/in/${linkedinSlug}` },
      })
      expect(steal.status(), 'taking another candidate\'s LinkedIn URL should be 409').toBe(409)

      const selfRes = await api.patch(`/api/candidates/${allFields.id}`, {
        data: { linkedinUrl: `HTTPS://WWW.Linkedin.com/in/${linkedinSlug}/` },
      })
      expect(selfRes.status(), 'own LinkedIn URL in another spelling should be 200').toBe(200)

      const clearRes = await api.patch(`/api/candidates/${allFields.id}`, {
        data: { linkedinUrl: null, company: null },
      })
      expect(clearRes.status()).toBe(200)
      const cleared = await clearRes.json()
      expect(cleared.linkedinUrl, 'null clears linkedinUrl').toBeNull()
      expect(cleared.company, 'null clears company').toBeNull()

      const gotAfterClear = await (await api.get(`/api/candidates/${allFields.id}`)).json()
      expect(gotAfterClear.linkedinUrl).toBeNull()
      expect(gotAfterClear.company).toBeNull()
    } finally {
      await tryCleanup()
    }
  })

  test('UI: Add Candidate with first + last name only redirects to the list', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/dashboard/candidates/new')
    await authenticatedPage.waitForLoadState('networkidle')
    // Wait for hydration — a click on the un-hydrated form does a native GET submit
    await authenticatedPage.getByLabel('First Name').waitFor({ state: 'visible', timeout: 15_000 })
    await authenticatedPage.getByLabel('First Name').fill(`Ui${runId}`)
    await authenticatedPage.getByLabel('Last Name').fill('NameOnly')
    await authenticatedPage.getByRole('button', { name: 'Add Candidate' }).click()
    // Redirect back to the list = the create succeeded
    await expect(authenticatedPage).toHaveURL(/\/dashboard\/candidates$/)
  })
})
