import { test, expect } from '../fixtures'
import { waitForHydration } from '../helpers/hydration'

/**
 * Slice 1b — "person on every task": quick-add person picker, company filter,
 * team visibility of tasks on a person, ?tab=tasks deep link, application
 * side panel and company page task lists.
 */

const runId = Date.now()
type Api = import('@playwright/test').APIRequestContext

test.describe('Slice 1b — person on every task', () => {
  test('1. API: companyId filter (active client contacts), scope=all on a person needs no admin, link ids validated', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const company = await (await api.post('/api/client-companies', { data: { name: `Acme Tasks ${runId}` } })).json()
    const contact = await (await api.post('/api/candidates', { data: { firstName: 'Contact', lastName: `Acme${runId}`, email: `contact-acme-${runId}@example.com` } })).json()
    expect((await api.post(`/api/candidates/${contact.id}/roles`, { data: { role: 'client_contact', clientCompanyId: company.id } })).status()).toBe(201)
    const other = await (await api.post('/api/candidates', { data: { firstName: 'Other', lastName: `Person${runId}`, email: `other-${runId}@example.com` } })).json()

    const t1 = await (await api.post('/api/tasks', { data: { title: `Call about renewal ${runId}`, candidateId: contact.id } })).json()
    await api.post('/api/tasks', { data: { title: `Unrelated ${runId}`, candidateId: other.id } })
    expect(t1.candidate?.id).toBe(contact.id)

    const byCompany = (await (await api.get('/api/tasks', { params: { scope: 'all', companyId: company.id } })).json()).tasks
    expect(byCompany.map((t: any) => t.id)).toEqual([t1.id])
    // scope=all with a link filter is allowed for everyone (the fixture user is owner, so also check the plain-all path still works)
    expect((await api.get('/api/tasks', { params: { scope: 'all', candidateId: contact.id } })).status()).toBe(200)
    expect((await api.get('/api/tasks', { params: { companyId: 'nope', scope: 'all' } })).status()).toBe(200)
    expect((await (await api.get('/api/tasks', { params: { companyId: 'nope', scope: 'all' } })).json()).tasks).toEqual([])
  })

  test('2. UI: pick a person on the Tasks page, see it on the row and on the person; ?tab=tasks opens the tab; company page lists it', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    const api = page.request
    const company = await (await api.post('/api/client-companies', { data: { name: `Picker Co ${runId}` } })).json()
    const contact = await (await api.post('/api/candidates', { data: { firstName: 'Pickable', lastName: `Person${runId}`, email: `pickable-${runId}@example.com`, position: 'Director' } })).json()
    await api.post(`/api/candidates/${contact.id}/roles`, { data: { role: 'client_contact', clientCompanyId: company.id } })

    await page.goto('/dashboard/tasks')
    await waitForHydration(page)
    await page.getByRole('heading', { name: 'Tasks' }).waitFor()
    await page.getByTestId('task-add-title').fill(`Send terms ${runId}`)
    await page.getByTestId('person-picker-input').fill('Pickable')
    await page.getByTestId('person-picker-results').getByText(`Pickable Person${runId}`).click()
    await expect(page.getByTestId('person-picker-selected')).toContainText('Pickable')
    await page.getByTestId('task-add-submit').click()
    await page.getByTestId('task-tab-none').click()
    const row = page.getByTestId('task-row').filter({ hasText: `Send terms ${runId}` })
    await expect(row).toBeVisible()
    await expect(row).toContainText(`Pickable Person${runId}`)

    // deep link straight to the person's Tasks tab
    await page.goto(`/dashboard/candidates/${contact.id}?tab=tasks`)
    await waitForHydration(page)
    await expect(page.getByTestId('task-row').filter({ hasText: `Send terms ${runId}` })).toBeVisible()
    // pinned to a person: no picker in quick-add
    await expect(page.getByTestId('person-picker-input')).toHaveCount(0)

    // company page shows tasks about its contacts, with a picker narrowed to them
    await page.goto(`/dashboard/companies/${company.id}`)
    await waitForHydration(page)
    await expect(page.getByTestId('company-tasks')).toContainText(`Send terms ${runId}`)
    await page.getByTestId('company-tasks').getByTestId('person-picker-input').focus()
    await expect(page.getByTestId('person-picker-results')).toContainText('Pickable')
  })
})
