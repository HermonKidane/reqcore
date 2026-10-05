import { test, expect } from '../fixtures'

/**
 * Regression: browser-extension capture (C1, design-sourcing-capture.md §4).
 *
 * API-level spec using the authenticated page's request context, following
 * the tenant-isolation pattern for the two-org setup. Covers:
 * - key auth: no/garbage/revoked key → 401
 * - Idempotency-Key required → 400; invalid body → 422
 * - create → 201; same Idempotency-Key replays stored result
 * - duplicate detection by email (skip) and LinkedIn URL normalization
 * - duplicatePolicy 'update' merges without blanking omitted fields
 * - cross-org isolation (key revoke 404, no cross-org duplicate match)
 * - key management never leaks keyHash or the plaintext key
 *
 * All data uses a unique runId per test (same convention as the other
 * regression specs — no explicit cleanup; records are tenant-isolated).
 */

const runId = Date.now()
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

interface OrgInfo { id: string, slug: string }

interface CreatedKey {
  id: string
  name: string
  keyPrefix: string
  createdAt: string
  key: string // plaintext — returned once at creation
}

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

async function createKey(api: import('@playwright/test').APIRequestContext, name: string): Promise<CreatedKey> {
  const res = await api.post('/api/extension-keys', { data: { name } })
  expect(res.status(), `create extension key ${name}`).toBe(201)
  return await res.json()
}

function capture(
  api: import('@playwright/test').APIRequestContext,
  key: string | undefined,
  idempotencyKey: string,
  body: Record<string, unknown>,
) {
  const headers: Record<string, string> = { 'Idempotency-Key': idempotencyKey }
  if (key !== undefined) headers.Authorization = `Bearer ${key}`
  return api.post('/api/extension/capture', { data: body, headers })
}

const VALID_BODY = {
  firstName: 'Ext',
  lastName: 'Capture',
  email: `ext-${runId}@example.com`,
  source: 'linkedin',
}

// 1×1 transparent PNG — enough to exercise magic-byte validation + serving
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test.describe('Extension capture (C1)', () => {
  test('unauthenticated capture attempts → 401', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `auth-${runId}`)

    // No Authorization header
    expect((await capture(api, undefined, `noauth-${runId}`, VALID_BODY)).status()).toBe(401)

    // Garbage key
    expect((await capture(api, 'mrx_garbagegarbagegarbage', `garbage-${runId}`, VALID_BODY)).status()).toBe(401)

    // Revoked key
    const revoked = await createKey(api, `revoked-${runId}`)
    expect((await api.delete(`/api/extension-keys/${revoked.id}`)).status()).toBe(200)
    expect((await capture(api, revoked.key, `revoked-${runId}`, VALID_BODY)).status()).toBe(401)
  })

  test('missing Idempotency-Key → 400; invalid body → 422', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `headers-${runId}`)

    // Missing Idempotency-Key
    const noIdem = await api.post('/api/extension/capture', {
      data: VALID_BODY,
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(noIdem.status()).toBe(400)

    // Invalid Idempotency-Key (illegal chars)
    const badIdem = await capture(api, key, `bad key ${runId}!`, VALID_BODY)
    expect(badIdem.status()).toBe(400)

    // Invalid body (missing required firstName + bad source enum)
    const badBody = await capture(api, key, `badbody-${runId}`, { lastName: 'X', source: 'not_a_board' })
    expect(badBody.status()).toBe(422)
  })

  test('create → 201; same Idempotency-Key replays stored result', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `create-${runId}`)
    const idem = `create-${runId}`
    const body = { ...VALID_BODY, email: `create-${runId}@example.com` }

    const res1 = await capture(api, key, idem, body)
    expect(res1.status()).toBe(201)
    const r1 = await res1.json()
    expect(r1.outcome).toBe('created')
    expect(r1.replayed).toBe(false)
    expect(r1.candidateId).toBeTruthy()
    expect(Array.isArray(r1.openJobs)).toBe(true)

    const res2 = await capture(api, key, idem, body)
    expect(res2.status()).toBe(200)
    const r2 = await res2.json()
    expect(r2.replayed).toBe(true)
    expect(r2.outcome).toBe('created')
    expect(r2.candidateId).toBe(r1.candidateId)
  })

  test('duplicate email with default skip → duplicate_skipped, matchedBy email', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `dup-${runId}`)
    const email = `dup-${runId}@example.com`

    const res1 = await capture(api, key, `dup-a-${runId}`, { ...VALID_BODY, email })
    expect(res1.status()).toBe(201)

    const res2 = await capture(api, key, `dup-b-${runId}`, { ...VALID_BODY, email, position: 'Should Not Stick' })
    expect(res2.status()).toBe(200)
    const r2 = await res2.json()
    expect(r2.outcome).toBe('duplicate_skipped')
    expect(r2.matchedBy).toBe('email')
    expect(r2.candidateId).toBe((await res1.json()).candidateId)
  })

  test('LinkedIn URL match is case/trailing-slash insensitive, no email needed', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `li-${runId}`)
    const linkedinUrl = `HTTPS://WWW.Linkedin.com/in/Ext-Capture-${runId}/`

    const res1 = await capture(api, key, `li-a-${runId}`, {
      firstName: 'Linked',
      lastName: 'In',
      linkedinUrl,
      source: 'linkedin',
    })
    expect(res1.status()).toBe(201)

    const res2 = await capture(api, key, `li-b-${runId}`, {
      firstName: 'Linked',
      lastName: 'In',
      linkedinUrl: `https://linkedin.com/in/ext-capture-${runId}`,
      source: 'linkedin',
    })
    expect(res2.status()).toBe(200)
    const r2 = await res2.json()
    expect(r2.outcome).toBe('duplicate_skipped')
    expect(r2.matchedBy).toBe('linkedin')
    expect(r2.candidateId).toBe((await res1.json()).candidateId)
  })

  test('blank optional fields from a scraper are treated as missing, not rejected', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `blank-${runId}`)
    const res = await capture(api, key, `blank-${runId}`, {
      firstName: 'Blank',
      lastName: 'Fields',
      email: '',
      linkedinUrl: '',
      phone: ' ',
      company: '',
      source: 'reed',
    })
    expect(res.status()).toBe(201)
    expect((await res.json()).outcome).toBe('created')
  })

  test("duplicatePolicy update merges; omitted fields are NOT blanked", async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `update-${runId}`)
    const email = `update-${runId}@example.com`

    const res1 = await capture(api, key, `upd-a-${runId}`, {
      ...VALID_BODY,
      email,
      position: 'Senior Dev',
      company: 'Acme Ltd',
    })
    expect(res1.status()).toBe(201)
    const candidateId = (await res1.json()).candidateId

    // update: new position, no company (must NOT blank 'Acme Ltd')
    const res2 = await capture(api, key, `upd-b-${runId}`, {
      firstName: 'Ext',
      lastName: 'Capture',
      email,
      position: 'Lead Dev',
      duplicatePolicy: 'update',
      source: 'linkedin',
    })
    expect(res2.status()).toBe(200)
    const r2 = await res2.json()
    expect(r2.outcome).toBe('updated')
    expect(r2.candidateId).toBe(candidateId)

    const got = await (await api.get(`/api/candidates/${candidateId}`)).json()
    expect(got.position).toBe('Lead Dev')
    expect(got.company).toBe('Acme Ltd')

    // update matched by LinkedIn with a DIFFERENT email: existing primary email is never overwritten
    const linkedinUrl = `https://www.linkedin.com/in/upd-${runId}`
    await capture(api, key, `upd-c-${runId}`, { ...VALID_BODY, email, linkedinUrl, duplicatePolicy: 'update' })
    const res3 = await capture(api, key, `upd-d-${runId}`, {
      firstName: 'Ext',
      lastName: 'Capture',
      email: `other-${runId}@example.com`,
      linkedinUrl,
      duplicatePolicy: 'update',
      source: 'linkedin',
    })
    const r3 = await res3.json()
    expect(r3.matchedBy).toBe('linkedin')
    expect(r3.candidateId).toBe(candidateId)
    const got3 = await (await api.get(`/api/candidates/${candidateId}`)).json()
    expect(got3.email).toBe(email)
  })

  test('cross-org: revoking another org\'s key → 404; no cross-org duplicate match', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request

    // ── Fixture org A already exists. Create org B and a key in org A ───────
    const slugB = `ext-b-${runId}`
    const createRes = await api.post('/api/auth/organization/create', {
      data: { name: `Extension B ${runId}`, slug: slugB },
      headers: { Origin: BASE },
    })
    expect(createRes.status(), 'org B create').toBe(200)

    const orgs = await listOrgs(api)
    const orgA = orgs.find(o => o.slug !== slugB)!
    const orgB = orgs.find(o => o.slug === slugB)!

    await setActiveOrg(api, orgA.id)
    const keyA = await createKey(api, `orgA-${runId}`)

    // ── Revoking org A's key from org B's context → 404 (no existence leak) ─
    await setActiveOrg(api, orgB.id)
    expect((await api.delete(`/api/extension-keys/${keyA.id}`)).status()).toBe(404)

    // ── Candidate with this email exists ONLY in org B ──────────────────────
    const crossEmail = `cross-${runId}@example.com`
    const resB = await api.post('/api/candidates', {
      data: { firstName: 'Cross', lastName: 'Org', email: crossEmail },
    })
    expect(resB.status()).toBe(201)

    // ── Capturing the same email with org A's key → created in org A ────────
    const resA = await capture(api, keyA.key, `cross-${runId}`, { ...VALID_BODY, email: crossEmail })
    expect(resA.status()).toBe(201)
    const rA = await resA.json()
    expect(rA.outcome).toBe('created')
    expect(rA.candidateId).not.toBe((await resB.json()).id)

    // And the org-A candidate is invisible from org B
    expect((await api.get(`/api/candidates/${rA.candidateId}`)).status()).toBe(404)
  })

  test('key management never leaks keyHash or plaintext', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `leak-${runId}`)

    const listRes = await api.get('/api/extension-keys')
    expect(listRes.status()).toBe(200)
    const raw = JSON.stringify(await listRes.json())
    expect(raw).not.toContain('keyHash')
    expect(raw).not.toContain(key)
  })

  test('capture with experiences + location + photo: detail API serves them; photo streams', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `c2-create-${runId}`)

    const res = await capture(api, key, `c2-create-${runId}`, {
      ...VALID_BODY,
      email: `c2-create-${runId}@example.com`,
      location: 'London, UK',
      position: 'Senior Developer',
      company: 'Acme Ltd',
      linkedinUrl: `https://www.linkedin.com/in/c2-create-${runId}`,
      experiences: [
        {
          title: 'Senior Developer',
          company: 'Acme Ltd',
          location: 'London',
          startText: 'Jan 2022',
          isCurrent: true,
          description: 'Leading the payments team.',
        },
        {
          title: 'Developer',
          company: 'Beta Plc',
          startText: 'Jun 2019',
          endText: 'Dec 2021',
        },
      ],
      photo: { contentType: 'image/png', dataBase64: TINY_PNG_BASE64 },
    })
    expect(res.status(), 'capture').toBe(201)
    const r = await res.json()
    expect(r.photoStored, 'photo upload (needs MinIO)').toBe(true)

    // Detail API: 2 experiences in capture order + location; raw key never exposed
    const detail = await (await api.get(`/api/candidates/${r.candidateId}`)).json()
    expect(detail.location).toBe('London, UK')
    expect(detail.experiences).toHaveLength(2)
    expect(detail.experiences.map((e: any) => e.title)).toEqual(['Senior Developer', 'Developer'])
    expect(detail.experiences[0]).toMatchObject({ company: 'Acme Ltd', isCurrent: true, sortOrder: 0 })
    expect(detail.experiences[1]).toMatchObject({ company: 'Beta Plc', startText: 'Jun 2019', endText: 'Dec 2021', sortOrder: 1 })
    expect(detail.hasPhoto).toBe(true)
    expect(detail.photoKey).toBeUndefined()

    // Photo streams through the server with the stored content type
    const photoRes = await api.get(`/api/candidates/${r.candidateId}/photo`)
    expect(photoRes.status(), 'photo endpoint').toBe(200)
    expect(photoRes.headers()['content-type']).toBe('image/png')
  })

  test('update replaces linkedin-sourced experiences; exactly 1 remains', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `c2-upd-${runId}`)
    const email = `c2-upd-${runId}@example.com`

    const res1 = await capture(api, key, `c2-upd-a-${runId}`, {
      ...VALID_BODY,
      email,
      experiences: [
        { title: 'Old One', company: 'Old Co', startText: 'Jan 2020', endText: 'Mar 2021' },
        { title: 'Old Two', company: 'Old Co', startText: 'Apr 2021' },
      ],
    })
    expect(res1.status()).toBe(201)
    const candidateId = (await res1.json()).candidateId

    const res2 = await capture(api, key, `c2-upd-b-${runId}`, {
      firstName: 'Ext',
      lastName: 'Capture',
      email,
      duplicatePolicy: 'update',
      source: 'linkedin',
      experiences: [{ title: 'New Role', company: 'New Co', startText: 'Feb 2024', isCurrent: true }],
    })
    expect(res2.status()).toBe(200)
    expect((await res2.json()).outcome).toBe('updated')

    const detail = await (await api.get(`/api/candidates/${candidateId}`)).json()
    expect(detail.experiences).toHaveLength(1)
    expect(detail.experiences[0]).toMatchObject({ title: 'New Role', company: 'New Co', isCurrent: true, sortOrder: 0 })
  })

  test('C2.1 richer capture: headline/summary/education/skills create + update semantics', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `c21-${runId}`)
    const email = `c21-${runId}@example.com`

    // create: headline, summary, 2 education, skills with a dupe + a blank-ish entry
    const res1 = await capture(api, key, `c21-a-${runId}`, {
      ...VALID_BODY,
      email,
      headline: 'Head of Talent Acquisition',
      summary: '15 years building engineering teams across Europe.',
      education: [
        { school: 'University of Manchester', degree: 'BSc', fieldOfStudy: 'Computer Science', startText: '2004', endText: '2007' },
        { school: 'Imperial College London', degree: 'MSc', fieldOfStudy: 'Software Engineering', startText: '2008', endText: '2009' },
      ],
      skills: ['TypeScript', 'typescript ', 'Go'],
    })
    expect(res1.status()).toBe(201)
    const candidateId = (await res1.json()).candidateId

    const detail1 = await (await api.get(`/api/candidates/${candidateId}`)).json()
    expect(detail1.headline).toBe('Head of Talent Acquisition')
    expect(detail1.summary).toBe('15 years building engineering teams across Europe.')
    expect(detail1.education).toHaveLength(2)
    expect(detail1.education.map((e: any) => e.school)).toEqual(['University of Manchester', 'Imperial College London'])
    expect(detail1.education[0]).toMatchObject({ degree: 'BSc', fieldOfStudy: 'Computer Science', startText: '2004', endText: '2007', sortOrder: 0 })
    // skills deduped by normalizedName ('typescript ' == 'TypeScript'), ordered by name
    expect(detail1.skills.map((s: any) => s.name)).toEqual(['Go', 'TypeScript'])

    // update: 1 education REPLACES capture rows; skills ADD missing only;
    // headline omitted → NOT blanked; provided summary overwrites
    const res2 = await capture(api, key, `c21-b-${runId}`, {
      firstName: 'Ext',
      lastName: 'Capture',
      email,
      duplicatePolicy: 'update',
      source: 'linkedin',
      summary: 'Updated summary text.',
      education: [{ school: 'Oxford University', degree: 'MBA', startText: '2015', endText: '2017' }],
      skills: ['Rust'],
    })
    expect(res2.status()).toBe(200)
    expect((await res2.json()).outcome).toBe('updated')

    const detail2 = await (await api.get(`/api/candidates/${candidateId}`)).json()
    expect(detail2.education).toHaveLength(1)
    expect(detail2.education[0]).toMatchObject({ school: 'Oxford University', degree: 'MBA', sortOrder: 0 })
    expect(detail2.skills.map((s: any) => s.name)).toEqual(['Go', 'Rust', 'TypeScript'])
    expect(detail2.headline).toBe('Head of Talent Acquisition')
    expect(detail2.summary).toBe('Updated summary text.')
  })

  test('photo of a candidate in another org → 404', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request

    const slugB = `c2-b-${runId}`
    const createRes = await api.post('/api/auth/organization/create', {
      data: { name: `C2 B ${runId}`, slug: slugB },
      headers: { Origin: BASE },
    })
    expect(createRes.status(), 'org B create').toBe(200)

    const orgs = await listOrgs(api)
    const orgA = orgs.find(o => o.slug !== slugB)!
    const orgB = orgs.find(o => o.slug === slugB)!

    // Capture with a photo in org A
    await setActiveOrg(api, orgA.id)
    const keyA = await createKey(api, `c2-orgA-${runId}`)
    const resA = await capture(api, keyA.key, `c2-cross-${runId}`, {
      ...VALID_BODY,
      email: `c2-cross-${runId}@example.com`,
      photo: { contentType: 'image/png', dataBase64: TINY_PNG_BASE64 },
    })
    expect(resA.status()).toBe(201)
    const candidateId = (await resA.json()).candidateId

    // Photo is served in org A…
    expect((await api.get(`/api/candidates/${candidateId}/photo`)).status()).toBe(200)

    // …but 404 from org B's context (no existence leak)
    await setActiveOrg(api, orgB.id)
    expect((await api.get(`/api/candidates/${candidateId}/photo`)).status()).toBe(404)
    expect((await api.get(`/api/candidates/${candidateId}`)).status()).toBe(404)
  })

  test('candidate without a photo → photo endpoint 404', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const res = await api.post('/api/candidates', {
      data: { firstName: 'No', lastName: 'Photo', email: `no-photo-${runId}@example.com` },
    })
    expect(res.status()).toBe(201)
    const { id } = await res.json()

    const photoRes = await api.get(`/api/candidates/${id}/photo`)
    expect(photoRes.status()).toBe(404)
  })
})

test.describe('Extension capture — AI page parsing (C2)', () => {
  // Deterministic mock parse (no AI key): firstName/lastName from the FIRST
  // line of pageText, experiences: []. pageText must never be persisted.
  const AI_PAGE_TEXT = 'Jane Example\nHead of Talent\nLondon'

  function capturePreview(
    api: import('@playwright/test').APIRequestContext,
    key: string,
    body: Record<string, unknown>,
  ) {
    return api.post('/api/extension/capture', {
      data: body,
      headers: { Authorization: `Bearer ${key}`, 'X-Capture-Mode': 'preview' },
    })
  }

  test('preview mode: pageText → 200 preview, nothing created, no Idempotency-Key', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `c2prev-${runId}`)

    const linkedinUrl = `https://www.linkedin.com/in/jane-example-${runId}`
    const countBefore = (await (await api.get('/api/candidates')).json()).total

    const res = await capturePreview(api, key, {
      pageText: AI_PAGE_TEXT,
      linkedinUrl,
      source: 'linkedin',
    })
    expect(res.status(), 'preview').toBe(200)
    const r = await res.json()
    expect(r.parsed).toBe(true)
    expect(r.preview.firstName).toBe('Jane')
    expect(r.preview.lastName).toBe('Example')
    expect(r.duplicate).toBeNull()

    // Read-only: candidate count unchanged, nothing written
    const countAfter = (await (await api.get('/api/candidates')).json()).total
    expect(countAfter).toBe(countBefore)

    // Second preview — same page now reports the would-be duplicate…
    const res2 = await capturePreview(api, key, {
      pageText: AI_PAGE_TEXT,
      linkedinUrl,
      source: 'linkedin',
    })
    expect(res2.status()).toBe(200)
    expect((await res2.json()).duplicate).toBeNull() // still nothing created

    // …and after an actual capture, preview flags the duplicate by linkedin
    const cap = await capture(api, key, `c2prev-cap-${runId}`, {
      firstName: 'Jane',
      lastName: 'Example',
      linkedinUrl,
      source: 'linkedin',
    })
    expect(cap.status()).toBe(201)

    const res3 = await capturePreview(api, key, {
      pageText: AI_PAGE_TEXT,
      linkedinUrl: `https://linkedin.com/in/jane-example-${runId}/`,
      source: 'linkedin',
    })
    const r3 = await res3.json()
    expect(r3.duplicate).toEqual({
      candidateId: (await cap.json()).candidateId,
      matchedBy: 'linkedin',
    })
  })

  test('capture with pageText and NO names → 201 (mock AI parse fills names)', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `c2ai-${runId}`)

    const res = await capture(api, key, `c2ai-${runId}`, {
      pageText: AI_PAGE_TEXT,
      pageUrl: `https://www.linkedin.com/in/jane-example-${runId}`,
      linkedinUrl: `https://www.linkedin.com/in/jane-example-${runId}`,
      source: 'linkedin',
    })
    expect(res.status()).toBe(201)
    const r = await res.json()
    expect(r.outcome).toBe('created')
    expect(r.parsed).toBe(true)
    expect(r.preview.firstName).toBe('Jane')
    expect(r.preview.lastName).toBe('Example')
    expect(r.preview.experiences).toEqual([])

    // The AI-filled name is what got stored
    const detail = await (await api.get(`/api/candidates/${r.candidateId}`)).json()
    expect(detail.firstName).toBe('Jane')
    expect(detail.lastName).toBe('Example')
  })

  test('neither names nor pageText → 422', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `c2noname-${runId}`)

    const res = await capture(api, key, `c2noname-${runId}`, {
      linkedinUrl: `https://www.linkedin.com/in/nobody-${runId}`,
      source: 'linkedin',
    })
    expect(res.status()).toBe(422)
  })

  test('pageText over 200 000 chars → 413', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { key } = await createKey(api, `c2big-${runId}`)

    const res = await capture(api, key, `c2big-${runId}`, {
      pageText: `${AI_PAGE_TEXT}\n${'x'.repeat(200_001)}`,
      source: 'linkedin',
    })
    expect(res.status()).toBe(413)
  })
})
