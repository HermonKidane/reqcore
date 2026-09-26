import { test, expect } from '../fixtures'

/**
 * Regression: person-model APIs — roles CRUD, client companies, job↔contacts
 * (info/design-person-apis.md §7).
 *
 * Covers: role start (201) / duplicate-active → 409 / company-iff rule → 422,
 * end (double-end → 409), restart = NEW row + history preserved, company
 * normalized-dup → 409, delete-with-role-history → 409 (23503 mapping),
 * job↔contact 422 without active client_contact role, ≤1 primary per job,
 * link survives role end (roleActive=false), candidates list role/company
 * filters, person-detail enrichment (roles+emails), cross-org → 404.
 *
 * Runs against the sandbox; each test gets a FRESH org from the fixture.
 */

const runId = Date.now()
const missingId = crypto.randomUUID()
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('Person roles lifecycle', () => {
  test('start / dup-active 409 / company-iff 422 / end / double-end 409 / restart preserves history', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request

    const personRes = await api.post('/api/candidates', {
      data: { firstName: 'Role', lastName: 'Person', email: `roles-${runId}@example.com` },
    })
    expect(personRes.status()).toBe(201)
    const person = await personRes.json()

    // ── Start a prospect role ───────────────────────────────────────────────
    const startRes = await api.post(`/api/candidates/${person.id}/roles`, {
      data: { role: 'prospect' },
    })
    expect(startRes.status(), 'role start should be 201').toBe(201)
    const role = await startRes.json()
    expect(role.role).toBe('prospect')
    expect(role.endedAt).toBeNull()

    // ── Duplicate ACTIVE role → 409 ─────────────────────────────────────────
    const dup = await api.post(`/api/candidates/${person.id}/roles`, {
      data: { role: 'prospect' },
    })
    expect(dup.status()).toBe(409)

    // ── Company-iff rule → 422 both directions ──────────────────────────────
    const missingCompany = await api.post(`/api/candidates/${person.id}/roles`, {
      data: { role: 'client_contact' },
    })
    expect(missingCompany.status()).toBe(422)

    const forbiddenCompany = await api.post(`/api/candidates/${person.id}/roles`, {
      data: { role: 'connection', clientCompanyId: 'whatever' },
    })
    expect(forbiddenCompany.status()).toBe(422)

    // ── Unknown person → 404 ────────────────────────────────────────────────
    const unknown = await api.post(`/api/candidates/${missingId}/roles`, {
      data: { role: 'connection' },
    })
    expect(unknown.status()).toBe(404)

    // ── End the role ────────────────────────────────────────────────────────
    const endRes = await api.patch(`/api/person-roles/${role.id}`, { data: { action: 'end' } })
    expect(endRes.status()).toBe(200)
    const ended = await endRes.json()
    expect(ended.endedAt, 'ended_at set').toBeTruthy()

    // ── Double-end → 409 ────────────────────────────────────────────────────
    const doubleEnd = await api.patch(`/api/person-roles/${role.id}`, { data: { action: 'end' } })
    expect(doubleEnd.status()).toBe(409)

    // ── Restart = NEW row; history preserved ────────────────────────────────
    const restartRes = await api.post(`/api/candidates/${person.id}/roles`, {
      data: { role: 'prospect' },
    })
    expect(restartRes.status()).toBe(201)
    const restart = await restartRes.json()
    expect(restart.id, 'restart is a NEW row').not.toBe(role.id)
    expect(restart.endedAt).toBeNull()

    const listRes = await api.get(`/api/candidates/${person.id}/roles`)
    expect(listRes.status()).toBe(200)
    const roles = await listRes.json()
    expect(roles.length, 'old ended row + new active row').toBe(2)
    const active = roles.filter((r: { active: boolean }) => r.active)
    const history = roles.filter((r: { active: boolean }) => !r.active)
    expect(active.length).toBe(1)
    expect(history.length).toBe(1)
    expect(history[0].id).toBe(role.id)
    // Active-first ordering
    expect(roles[0].id).toBe(restart.id)

    // ── No DELETE/UPDATE of history exposed ─────────────────────────────────
    const del = await api.delete(`/api/person-roles/${role.id}`)
    expect(del.status()).toBe(404)
  })
})

test.describe('Client companies', () => {
  test('create / normalized-dup 409 / patch / delete-with-history 409 / delete clean 204', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request

    // ── Create ──────────────────────────────────────────────────────────────
    const createRes = await api.post('/api/client-companies', {
      data: { name: 'Acme Pharma' },
    })
    expect(createRes.status()).toBe(201)
    const company = await createRes.json()
    expect(company.name).toBe('Acme Pharma')

    // ── Normalized duplicate (case + whitespace variant) → 409 ──────────────
    const dup = await api.post('/api/client-companies', {
      data: { name: '  ACME PHARMA ' },
    })
    expect(dup.status()).toBe(409)

    // ── Blank name → 422 ────────────────────────────────────────────────────
    const blank = await api.post('/api/client-companies', { data: { name: '   ' } })
    expect(blank.status()).toBe(422)

    // ── Search list ─────────────────────────────────────────────────────────
    const listRes = await api.get('/api/client-companies', { params: { search: 'acme' } })
    expect(listRes.status()).toBe(200)
    const list = await listRes.json()
    expect(list.total).toBe(1)
    expect(list.data[0].activeContactCount).toBe(0)

    // ── Patch rename ────────────────────────────────────────────────────────
    const patchRes = await api.patch(`/api/client-companies/${company.id}`, {
      data: { name: 'Acme Pharma Ltd', website: 'https://acme.example' },
    })
    expect(patchRes.status()).toBe(200)
    const patched = await patchRes.json()
    expect(patched.name).toBe('Acme Pharma Ltd')

    // ── Delete blocked by role history (23503 → 409) ────────────────────────
    const personRes = await api.post('/api/candidates', {
      data: { firstName: 'Client', lastName: 'Contact', email: `cc-${runId}@example.com` },
    })
    expect(personRes.status()).toBe(201)
    const person = await personRes.json()

    const roleRes = await api.post(`/api/candidates/${person.id}/roles`, {
      data: { role: 'client_contact', clientCompanyId: company.id },
    })
    expect(roleRes.status()).toBe(201)

    const blockedDelete = await api.delete(`/api/client-companies/${company.id}`)
    expect(blockedDelete.status()).toBe(409)

    // ── Cross-org / unknown → 404 ───────────────────────────────────────────
    const missing = await api.get(`/api/client-companies/${missingId}`)
    expect(missing.status()).toBe(404)

    // ── Company detail exposes the contact ──────────────────────────────────
    const detail = await (await api.get(`/api/client-companies/${company.id}`)).json()
    expect(detail.contacts.length).toBe(1)
    expect(detail.contacts[0].candidateId).toBe(person.id)
    expect(detail.contacts[0].active).toBe(true)
    expect(detail.contacts[0].endedAt).toBeNull()

    // ── Delete a CLEAN company → 204 ────────────────────────────────────────
    const cleanRes = await api.post('/api/client-companies', { data: { name: 'Empty Co' } })
    const clean = await cleanRes.json()
    const del = await api.delete(`/api/client-companies/${clean.id}`)
    expect(del.status()).toBe(204)
  })
})

test.describe('Job ↔ client contacts', () => {
  test('422 without active role / link / dup-link 409 / ≤1 primary / survives role end', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request

    // ── Fixtures: job + company + two people (one with the role) ────────────
    const jobRes = await api.post('/api/jobs', { data: { title: `Contacts ${runId}` } })
    expect(jobRes.status()).toBe(201)
    const job = await jobRes.json()

    const companyRes = await api.post('/api/client-companies', { data: { name: `JobCo ${runId}` } })
    expect(companyRes.status(), 'setup company').toBe(201)
    const company = await companyRes.json()

    const mkPerson = async (tag: string) => {
      const res = await api.post('/api/candidates', {
        data: { firstName: tag, lastName: 'Contact', email: `${tag}-${runId}@example.com` },
      })
      expect(res.status()).toBe(201)
      return res.json()
    }
    const withRole = await mkPerson('Withrole')
    const noRole = await mkPerson('Norole')

    const roleRes = await api.post(`/api/candidates/${withRole.id}/roles`, {
      data: { role: 'client_contact', clientCompanyId: company.id },
    })
    expect(roleRes.status()).toBe(201)

    // ── Link without an active client_contact role → 422 ────────────────────
    const noRoleLink = await api.post(`/api/jobs/${job.id}/contacts`, {
      data: { candidateId: noRole.id },
    })
    expect(noRoleLink.status()).toBe(422)

    // ── Link the role-holder (as primary) → 201 ─────────────────────────────
    const linkRes = await api.post(`/api/jobs/${job.id}/contacts`, {
      data: { candidateId: withRole.id, label: 'Hiring manager', isPrimary: true },
    })
    expect(linkRes.status()).toBe(201)
    const link = await linkRes.json()
    expect(link.isPrimary).toBe(true)

    // ── Duplicate link → 409 ────────────────────────────────────────────────
    const dupLink = await api.post(`/api/jobs/${job.id}/contacts`, {
      data: { candidateId: withRole.id },
    })
    expect(dupLink.status()).toBe(409)

    // ── Second contact: primary swap via PATCH ──────────────────────────────
    const secondRes = await api.post(`/api/jobs/${job.id}/contacts`, {
      data: { candidateId: noRole.id },
    })
    // noRole still has no client_contact role → 422
    expect(secondRes.status()).toBe(422)

    const role2Res = await api.post(`/api/candidates/${noRole.id}/roles`, {
      data: { role: 'client_contact', clientCompanyId: company.id },
    })
    expect(role2Res.status()).toBe(201)

    const link2Res = await api.post(`/api/jobs/${job.id}/contacts`, {
      data: { candidateId: noRole.id, label: 'HR' },
    })
    expect(link2Res.status()).toBe(201)
    const link2 = await link2Res.json()
    expect(link2.isPrimary).toBe(false)

    // Make link2 primary → link1 demoted (≤1 primary invariant)
    const promoteRes = await api.patch(`/api/jobs/${job.id}/contacts/${link2.id}`, {
      data: { isPrimary: true },
    })
    expect(promoteRes.status()).toBe(200)

    const contactsAfter = await (await api.get(`/api/jobs/${job.id}/contacts`)).json()
    const primaries = contactsAfter.data.filter((c: { isPrimary: boolean }) => c.isPrimary)
    expect(primaries.length, 'exactly one primary').toBe(1)
    expect(primaries[0].candidateId).toBe(noRole.id)
    // Primary-first ordering
    expect(contactsAfter.data[0].isPrimary).toBe(true)

    // ── Link survives role end → roleActive=false (greyed) ──────────────────
    const role2 = await role2Res.json()
    await api.patch(`/api/person-roles/${role2.id}`, { data: { action: 'end' } })

    const contactsGreyed = await (await api.get(`/api/jobs/${job.id}/contacts`)).json()
    const greyed = contactsGreyed.data.find((c: { candidateId: string }) => c.candidateId === noRole.id)
    expect(greyed, 'link row still present').toBeTruthy()
    expect(greyed.roleActive, 'greyed after role end').toBe(false)

    // ── Remove link → 204 ───────────────────────────────────────────────────
    const delRes = await api.delete(`/api/jobs/${job.id}/contacts/${link2.id}`)
    expect(delRes.status()).toBe(204)
    const contactsFinal = await (await api.get(`/api/jobs/${job.id}/contacts`)).json()
    expect(contactsFinal.data.length).toBe(1)

    // ── Jobs list exposes clientContactCount ────────────────────────────────
    const jobsList = await (await api.get('/api/jobs')).json()
    const jobRow = jobsList.data.find((j: { id: string }) => j.id === job.id)
    expect(jobRow.clientContactCount).toBe(1)
  })
})

test.describe('Person detail enrichment + list filters', () => {
  test('GET person includes roles+emails; candidates list filters by role and company', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request

    const companyRes = await api.post('/api/client-companies', { data: { name: `FilterCo ${runId}` } })
    expect(companyRes.status(), 'setup company').toBe(201)
    const company = await companyRes.json()

    const personRes = await api.post('/api/candidates', {
      data: { firstName: 'Filter', lastName: 'Me', email: `filter-${runId}@example.com` },
    })
    expect(personRes.status(), 'setup person').toBe(201)
    const person = await personRes.json()

    await api.post(`/api/candidates/${person.id}/roles`, {
      data: { role: 'connection' },
    })
    await api.post(`/api/candidates/${person.id}/roles`, {
      data: { role: 'client_contact', clientCompanyId: company.id },
    })

    // ── Person detail: stacked-chip data present ────────────────────────────
    const detailRes = await api.get(`/api/candidates/${person.id}`)
    expect(detailRes.status()).toBe(200)
    const detail = await detailRes.json()
    expect(detail.emails.length).toBe(1)
    expect(detail.emails[0].isPrimary).toBe(true)
    expect(detail.roles.length).toBe(2)
    const ccRole = detail.roles.find((r: { role: string }) => r.role === 'client_contact')
    expect(ccRole.clientCompany.name).toBe(`FilterCo ${runId}`)
    // Active-first ordering
    expect(detail.roles.every((r: { endedAt: string | null }, i: number, arr: { endedAt: string | null }[]) =>
      i === 0 || arr[i - 1].endedAt === null || r.endedAt !== null,
    )).toBe(true)

    // ── List filters ────────────────────────────────────────────────────────
    const byRole = await (await api.get('/api/candidates', { params: { role: 'connection' } })).json()
    expect(byRole.data.some((c: { id: string }) => c.id === person.id)).toBe(true)

    const byCcRole = await (await api.get('/api/candidates', { params: { role: 'client_contact' } })).json()
    expect(byCcRole.data.some((c: { id: string }) => c.id === person.id)).toBe(true)

    const byCompany = await (await api.get('/api/candidates', { params: { companyId: company.id } })).json()
    expect(byCompany.data.some((c: { id: string }) => c.id === person.id)).toBe(true)

    // A random other company filter excludes them
    const otherCompany = await (await api.post('/api/client-companies', { data: { name: `OtherCo ${runId}` } })).json()
    const byOther = await (await api.get('/api/candidates', { params: { companyId: otherCompany.id } })).json()
    expect(byOther.data.some((c: { id: string }) => c.id === person.id)).toBe(false)

    // 'candidate' is not a filterable role (400 validation)
    const badRole = await api.get('/api/candidates', { params: { role: 'candidate' } })
    expect(badRole.status()).toBe(400)
  })
})

test.describe('Person-model tenant isolation', () => {
  test('cross-org role/company/contact access → 404', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request

    // ── Fixture org A already exists. Create org B (auto-switches active) ───
    const slugB = `pm-iso-b-${runId}`
    const createRes = await api.post('/api/auth/organization/create', {
      data: { name: `PM Isolation B ${runId}`, slug: slugB },
      headers: { Origin: BASE },
    })
    expect(createRes.status()).toBe(200)
    const orgsRes = await api.get('/api/auth/organization/list', { headers: { Origin: BASE } })
    const orgs = (await orgsRes.json()).map((o: { organization: { id: string, slug: string } }) => o.organization ?? o)
    const orgA = orgs.find((o: { slug: string }) => o.slug !== slugB)!
    const orgB = orgs.find((o: { slug: string }) => o.slug === slugB)!

    // ── Person + company + role + job link in org A ─────────────────────────
    const setActive = async (organizationId: string) => {
      const res = await api.post('/api/auth/organization/set-active', {
        data: { organizationId },
        headers: { Origin: BASE },
      })
      expect(res.status()).toBe(200)
    }

    await setActive(orgA.id)
    const company = await (await api.post('/api/client-companies', { data: { name: `IsoCo ${runId}` } })).json()
    const person = await (await api.post('/api/candidates', {
      data: { firstName: 'Iso', lastName: 'Person', email: `pm-iso-${runId}@example.com` },
    })).json()
    const role = await (await api.post(`/api/candidates/${person.id}/roles`, {
      data: { role: 'client_contact', clientCompanyId: company.id },
    })).json()
    const job = await (await api.post('/api/jobs', { data: { title: `IsoJob ${runId}` } })).json()
    const link = await (await api.post(`/api/jobs/${job.id}/contacts`, {
      data: { candidateId: person.id, isPrimary: true },
    })).json()

    // ── Switch to org B: everything from A is 404 ───────────────────────────
    await setActive(orgB.id)
    expect((await api.get(`/api/candidates/${person.id}/roles`)).status()).toBe(404)
    expect((await api.post(`/api/candidates/${person.id}/roles`, { data: { role: 'prospect' } })).status()).toBe(404)
    expect((await api.patch(`/api/person-roles/${role.id}`, { data: { action: 'end' } })).status()).toBe(404)
    expect((await api.get(`/api/client-companies/${company.id}`)).status()).toBe(404)
    expect((await api.delete(`/api/client-companies/${company.id}`)).status()).toBe(404)
    expect((await api.get(`/api/jobs/${job.id}/contacts`)).status()).toBe(404)
    expect((await api.post(`/api/jobs/${job.id}/contacts`, { data: { candidateId: person.id } })).status()).toBe(404)
    expect((await api.patch(`/api/jobs/${job.id}/contacts/${link.id}`, { data: { isPrimary: false } })).status()).toBe(404)
    expect((await api.delete(`/api/jobs/${job.id}/contacts/${link.id}`)).status()).toBe(404)
    // Company list in B is empty
    const listB = await (await api.get('/api/client-companies')).json()
    expect(listB.total).toBe(0)

    // ── Switch back to A: everything intact (cross-org was read-only) ───────
    await setActive(orgA.id)
    const rolesA = await (await api.get(`/api/candidates/${person.id}/roles`)).json()
    expect(rolesA.length).toBe(1)
    expect(rolesA[0].active).toBe(true)
    const contactsA = await (await api.get(`/api/jobs/${job.id}/contacts`)).json()
    expect(contactsA.data.length).toBe(1)
  })
})
