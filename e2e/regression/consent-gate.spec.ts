import { test, expect } from '../fixtures'
import { waitForHydration } from '../helpers/hydration'

/**
 * Session W slice 1 — feature B "Consent + contact rules" (plumbing P4).
 * Step 7 (candidate_presentation) cannot be completed unless an active
 * consent covers the job's client; consent CRUD + field limits; the
 * Consent & contact tab on the candidate page.
 */

const runId = Date.now()
type Api = import('@playwright/test').APIRequestContext

async function makeApplication(api: Api, label: string) {
  const job = await (await api.post('/api/jobs', { data: { title: `Consent ${label} ${runId}` } })).json()
  await api.patch(`/api/jobs/${job.id}`, { data: { status: 'open' } })
  const applyRes = await api.post(`/api/public/jobs/${job.slug}/apply`, {
    data: { firstName: 'Con', lastName: label, email: `con-${label.toLowerCase()}-${runId}@example.com`, responses: [] },
  })
  expect(applyRes.status()).toBeLessThan(300)
  const apps = await (await api.get('/api/applications', { params: { jobId: job.id } })).json()
  const applicationId = apps.data[0].id as string
  const app = await (await api.get(`/api/applications/${applicationId}`)).json()
  const wf = await (await api.get(`/api/applications/${applicationId}/workflow`)).json()
  const step7 = wf.instances.find((i: any) => i.stepTemplate.stepNumber === 7)
  expect(step7.stepTemplate.key).toBe('candidate_presentation')
  return { jobId: job.id as string, applicationId, candidateId: app.candidate.id as string, step7Id: step7.id as string }
}

/** Client company + a contact person at it, linked to the job as primary. */
async function attachClient(api: Api, jobId: string, label: string): Promise<string> {
  const company = await (await api.post('/api/client-companies', { data: { name: `Client ${label} ${runId}` } })).json()
  const contact = await (await api.post('/api/candidates', { data: { firstName: 'Contact', lastName: label, email: `contact-${label.toLowerCase()}-${runId}@example.com` } })).json()
  const role = await api.post(`/api/candidates/${contact.id}/roles`, { data: { role: 'client_contact', clientCompanyId: company.id } })
  expect(role.status(), 'client_contact role').toBe(201)
  const link = await api.post(`/api/jobs/${jobId}/contacts`, { data: { candidateId: contact.id, isPrimary: true } })
  expect(link.status(), 'job contact link').toBe(201)
  return company.id as string
}

const complete7 = (api: Api, step7Id: string) =>
  api.patch(`/api/step-instances/${step7Id}`, { data: { action: 'complete', completionData: { presentedAt: new Date().toISOString() } } })

test.describe('Slice 1 — consent gate', () => {
  test('1. step 7 is blocked without a client, without consent, with the wrong named client; passes with cover', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { jobId, candidateId, step7Id } = await makeApplication(api, 'Gate')

    // no primary client contact on the job yet
    let res = await complete7(api, step7Id)
    expect(res.status(), 'no client → 422').toBe(422)
    expect((await res.json()).data?.code).toBe('client_unknown')

    const companyId = await attachClient(api, jobId, 'Gate')
    res = await complete7(api, step7Id)
    expect(res.status(), 'no consent → 422').toBe(422)
    expect((await res.json()).data?.code).toBe('consent_required')
    expect((await res.json()).data?.clientCompany?.id).toBe(companyId)

    // named consent for a different company does not cover it
    const other = await (await api.post('/api/client-companies', { data: { name: `Other ${runId}` } })).json()
    const named = await api.post(`/api/candidates/${candidateId}/consents`, {
      data: { scope: 'named_clients', clientCompanyIds: [other.id], givenAt: new Date().toISOString(), channel: 'call', evidenceQuote: 'only them please' },
    })
    expect(named.status()).toBe(201)
    res = await complete7(api, step7Id)
    expect(res.status(), 'wrong named client → 422').toBe(422)

    // revoked consent does not count either
    const all = await (await api.post(`/api/candidates/${candidateId}/consents`, {
      data: { scope: 'all_clients', givenAt: new Date().toISOString(), channel: 'email', evidenceQuote: 'happy to be put forward anywhere' },
    })).json()
    expect((await api.patch(`/api/candidates/${candidateId}/consents/${all.id}`, { data: { revokedReason: 'changed mind' } })).status()).toBe(200)
    expect((await api.patch(`/api/candidates/${candidateId}/consents/${all.id}`, { data: {} })).status(), 'revoke twice → 409').toBe(409)
    res = await complete7(api, step7Id)
    expect(res.status(), 'revoked → 422').toBe(422)

    // named consent for the right company → passes
    const right = await api.post(`/api/candidates/${candidateId}/consents`, {
      data: { scope: 'named_clients', clientCompanyIds: [companyId], givenAt: new Date().toISOString(), channel: 'whatsapp', evidenceQuote: 'yes, send me to them' },
    })
    expect(right.status()).toBe(201)
    res = await complete7(api, step7Id)
    expect(res.status(), 'covered → 200').toBe(200)
    expect((await res.json()).status).toBe('completed')

    // the candidate detail carries the consents, active first
    const detail = await (await api.get(`/api/candidates/${candidateId}`)).json()
    expect(detail.consents.length).toBe(3)
    expect(detail.consents.filter((c: any) => !c.revokedAt).length).toBe(2)
  })

  test('2. consent validation + limits; cross-org company rejected; other steps unaffected', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { candidateId, applicationId } = await makeApplication(api, 'Limits')
    const url = `/api/candidates/${candidateId}/consents`
    const base = { givenAt: new Date().toISOString(), channel: 'call', evidenceQuote: 'ok' }

    expect((await api.post(url, { data: { ...base, scope: 'named_clients', clientCompanyIds: [] } })).status(), 'named without clients → 422').toBe(422)
    expect((await api.post(url, { data: { ...base, scope: 'role_types', roleTypes: [] } })).status(), 'role_types without types → 422').toBe(422)
    expect((await api.post(url, { data: { ...base, scope: 'role_types', roleTypes: Array.from({ length: 11 }, (_, i) => `t${i}`) } })).status(), '11 role types → 422').toBe(422)
    expect((await api.post(url, { data: { ...base, scope: 'all_clients', evidenceQuote: '' } })).status(), 'empty quote → 422').toBe(422)
    expect((await api.post(url, { data: { ...base, scope: 'all_clients', evidenceQuote: 'q'.repeat(1001) } })).status(), 'quote 1001 → 422').toBe(422)
    expect((await api.post(url, { data: { ...base, scope: 'all_clients', givenAt: new Date(Date.now() + 86_400_000).toISOString() } })).status(), 'future → 422').toBe(422)
    expect((await api.post(url, { data: { ...base, scope: 'all_clients', bogus: 1 } })).status(), 'unknown key → 422').toBe(422)
    expect((await api.post(url, { data: { ...base, scope: 'named_clients', clientCompanyIds: ['nope'] } })).status(), 'unknown company → 422').toBe(422)
    expect((await api.post('/api/candidates/nope/consents', { data: { ...base, scope: 'all_clients' } })).status()).toBe(404)

    // emoji / RTL / long-but-valid quote are fine
    const ok = await api.post(url, { data: { ...base, scope: 'role_types', roleTypes: ['team lead', 'senior consultant'], evidenceQuote: `✅ "yes" — מסכים — ${'x'.repeat(900)}` } })
    expect(ok.status()).toBe(201)
    expect((await (await api.get(url)).json()).consents.length).toBe(1)

    // a step that is not step 7 completes without any consent check
    const wf = await (await api.get(`/api/applications/${applicationId}/workflow`)).json()
    const step9 = wf.instances.find((i: any) => i.stepTemplate.stepNumber === 9)
    const res = await api.patch(`/api/step-instances/${step9.id}`, { data: { action: 'complete', completionData: { prepCompleted: 'yes' } } })
    expect(res.status()).toBe(200)
  })

  test('3. UI: Consent & contact tab records consent, flags do-not-contact (badge in header), marks the notice sent', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    const api = page.request
    const { candidateId } = await makeApplication(api, 'Ui')

    await page.goto(`/dashboard/candidates/${candidateId}`)
    await waitForHydration(page)
    await page.getByTestId('tab-consent').click()
    await expect(page.getByTestId('consent-panel')).toBeVisible()

    // record consent
    await page.getByTestId('consent-open').click()
    await page.getByTestId('consent-scope').selectOption('all_clients')
    await page.getByTestId('consent-channel').selectOption('email')
    await page.getByTestId('consent-quote').fill('Yes, put me forward anywhere in the north.')
    await page.getByTestId('consent-save').click()
    await expect(page.getByTestId('consent-row')).toHaveCount(1)
    await expect(page.getByTestId('consent-row').first()).toContainText('Any client')

    // privacy notice: due date shows (collected at creation), mark sent
    await expect(page.getByTestId('notice-due')).not.toHaveText('—')
    await page.getByTestId('notice-sent').click()
    await expect(page.getByTestId('notice-sent')).toHaveCount(0)

    // do not contact
    await page.getByTestId('dnc-open').click()
    await page.getByTestId('dnc-source').selectOption('whatsapp')
    await page.getByTestId('dnc-note').fill('Please don\'t message me again')
    await page.getByTestId('dnc-save').click()
    await expect(page.getByTestId('dnc-status')).toContainText('Flagged')
    await expect(page.getByTestId('do-not-contact-badge').first()).toBeVisible()
    const detail = await (await api.get(`/api/candidates/${candidateId}`)).json()
    expect(detail.doNotContact).toBe(true)
    expect(detail.doNotContactSource).toBe('whatsapp')
    expect(detail.privacyNoticeSentAt).toBeTruthy()

    // list shows the compact badge
    await page.goto('/dashboard/candidates?search=Ui')
    await waitForHydration(page)
    await expect(page.getByTestId('do-not-contact-badge').first()).toBeVisible()
  })
})
