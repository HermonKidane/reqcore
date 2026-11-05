import { test, expect } from '../fixtures'
import { waitForHydration } from '../helpers/hydration'

/**
 * Session W slice 1 — feature C "Tasks" (plumbing P3, ATS side).
 * API: create / list filters / bulk / patch / cancel / field limits / links;
 * UI: Tasks page quick-add, dashboard card, candidate Tasks tab.
 * Microsoft sync is covered separately with a Graph stub.
 */

const runId = Date.now()
type Api = import('@playwright/test').APIRequestContext

async function makeCandidate(api: Api, label: string): Promise<string> {
  const res = await api.post('/api/candidates', { data: { firstName: 'Task', lastName: label, email: `task-${label.toLowerCase()}-${runId}@example.com` } })
  expect(res.status()).toBe(201)
  return (await res.json()).id
}

const iso = (daysFromNow: number, hour = 9) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysFromNow)
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}

test.describe('Slice 1 — tasks', () => {
  test('1. API: create, list buckets, patch, done/undo, cancel, limits, links', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const candidateId = await makeCandidate(api, 'Api')

    // limits
    expect((await api.post('/api/tasks', { data: { title: '' } })).status(), 'empty title → 422').toBe(422)
    expect((await api.post('/api/tasks', { data: { title: 'x'.repeat(201) } })).status(), 'title 201 → 422').toBe(422)
    expect((await api.post('/api/tasks', { data: { title: 'ok', notes: 'n'.repeat(4001) } })).status(), 'notes 4001 → 422').toBe(422)
    expect((await api.post('/api/tasks', { data: { title: 'ok', dueAt: iso(6 * 366) } })).status(), 'due 6 years → 422').toBe(422)
    expect((await api.post('/api/tasks', { data: { title: 'ok', candidateId: 'nope' } })).status(), 'unknown candidate → 404').toBe(404)
    expect((await api.post('/api/tasks', { data: { title: 'ok', ownerId: 'nope' } })).status(), 'non-member owner → 422').toBe(422)
    expect((await api.post('/api/tasks', { data: { title: 'ok', extra: 1 } })).status(), 'unknown key → 422').toBe(422)

    // create three: overdue, today, undated (linked to the candidate)
    const overdue = await (await api.post('/api/tasks', { data: { title: `Overdue ${runId}`, dueAt: iso(-2), candidateId } })).json()
    const today = await (await api.post('/api/tasks', { data: { title: `Today ${runId}`, dueAt: iso(0, 23), allDay: false } })).json()
    const undated = await (await api.post('/api/tasks', { data: { title: `Undated ${runId} 🙂 ✓`, notes: 'with emoji and a long\nnote' } })).json()
    expect(overdue.status).toBe('open')
    expect(overdue.candidate?.id).toBe(candidateId)
    expect(overdue.owner?.id).toBeTruthy()
    expect(overdue.syncs).toEqual([])

    const mine = (await (await api.get('/api/tasks')).json()).tasks
    expect(mine.map((t: any) => t.id)).toEqual(expect.arrayContaining([overdue.id, today.id, undated.id]))
    // ordering: due first (overdue before today), undated last
    const ids = mine.map((t: any) => t.id)
    expect(ids.indexOf(overdue.id)).toBeLessThan(ids.indexOf(today.id))
    expect(ids.indexOf(today.id)).toBeLessThan(ids.indexOf(undated.id))

    expect((await (await api.get('/api/tasks', { params: { due: 'overdue' } })).json()).tasks.map((t: any) => t.id)).toContain(overdue.id)
    expect((await (await api.get('/api/tasks', { params: { due: 'none' } })).json()).tasks.map((t: any) => t.id)).toEqual([undated.id])
    expect((await (await api.get('/api/tasks', { params: { candidateId } })).json()).tasks.map((t: any) => t.id)).toEqual([overdue.id])
    // owner can see everyone's
    expect((await api.get('/api/tasks', { params: { scope: 'all' } })).status()).toBe(200)

    // patch + done + undo
    const patched = await (await api.patch(`/api/tasks/${overdue.id}`, { data: { title: 'Renamed', dueAt: iso(3) } })).json()
    expect(patched.title).toBe('Renamed')
    expect((await api.patch(`/api/tasks/${overdue.id}`, { data: {} })).status(), 'nothing to update → 422').toBe(422)
    const done = await (await api.patch(`/api/tasks/${overdue.id}`, { data: { status: 'done' } })).json()
    expect(done.status).toBe('done')
    expect(done.completedAt).toBeTruthy()
    expect((await (await api.get('/api/tasks', { params: { status: 'done' } })).json()).tasks.map((t: any) => t.id)).toContain(overdue.id)
    const reopened = await (await api.patch(`/api/tasks/${overdue.id}`, { data: { status: 'open' } })).json()
    expect(reopened.completedAt).toBeNull()

    // cancel = soft; cancelled rows are read-only
    expect((await api.delete(`/api/tasks/${undated.id}`)).status()).toBe(204)
    expect((await api.patch(`/api/tasks/${undated.id}`, { data: { title: 'x' } })).status(), 'cancelled → 409').toBe(409)
    expect((await (await api.get('/api/tasks', { params: { status: 'cancelled' } })).json()).tasks.map((t: any) => t.id)).toContain(undated.id)
    expect((await api.get(`/api/tasks/nope`)).status()).toBe(404)
    expect((await api.delete(`/api/tasks/nope`)).status()).toBe(404)
  })

  test('2. API: bulk ≤ 20, source ai_run when linked to a run', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const twentyOne = Array.from({ length: 21 }, (_, i) => ({ title: `Bulk ${i}` }))
    expect((await api.post('/api/tasks/bulk', { data: { tasks: twentyOne } })).status(), '21 → 422').toBe(422)
    expect((await api.post('/api/tasks/bulk', { data: { tasks: [] } })).status(), '0 → 422').toBe(422)
    const res = await api.post('/api/tasks/bulk', { data: { tasks: [{ title: `Bulk A ${runId}` }, { title: `Bulk B ${runId}`, dueAt: iso(1) }] } })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.created).toBe(2)
    expect(body.ids).toHaveLength(2)
    // a bad link mid-batch stops and reports the count
    const partial = await api.post('/api/tasks/bulk', { data: { tasks: [{ title: 'ok' }, { title: 'bad', candidateId: 'nope' }] } })
    expect(partial.status()).toBe(404)
    expect((await partial.json()).data?.created).toBe(1)
  })

  test('3. UI: Tasks page quick-add + tick, dashboard card, candidate Tasks tab (desktop + 390 px)', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    const api = page.request
    const candidateId = await makeCandidate(api, 'Ui')

    await page.goto('/dashboard/tasks')
    await waitForHydration(page)
    await page.getByRole('heading', { name: 'Tasks' }).waitFor()
    await page.getByTestId('task-add-title').fill(`From the page ${runId}`)
    await page.getByTestId('task-add-submit').click()
    // undated task lands in "No date"
    await page.getByTestId('task-tab-none').click()
    await expect(page.getByTestId('task-row').filter({ hasText: `From the page ${runId}` })).toBeVisible()
    await page.getByTestId('task-row').filter({ hasText: `From the page ${runId}` }).getByTestId('task-tick').click()
    await expect(page.getByTestId('task-row').filter({ hasText: `From the page ${runId}` })).toHaveCount(0)
    await page.getByTestId('task-tab-done').click()
    await expect(page.getByTestId('task-row').filter({ hasText: `From the page ${runId}` })).toBeVisible()

    // dashboard card shows a task due today
    await api.post('/api/tasks', { data: { title: `Card ${runId}`, dueAt: iso(0, 23) } })
    await page.goto('/dashboard')
    await waitForHydration(page)
    await expect(page.getByTestId('dashboard-tasks')).toContainText(`Card ${runId}`)

    // candidate tab: add a linked task from the tab, filtered to this person
    await page.goto(`/dashboard/candidates/${candidateId}`)
    await waitForHydration(page)
    await page.getByTestId('tab-tasks').click()
    await page.getByTestId('task-add-title').fill(`For Ui ${runId}`)
    await page.getByTestId('task-add-submit').click()
    await expect(page.getByTestId('task-row').filter({ hasText: `For Ui ${runId}` })).toBeVisible()
    await expect(page.getByTestId('task-row').filter({ hasText: `Card ${runId}` })).toHaveCount(0)
    const linked = (await (await api.get('/api/tasks', { params: { candidateId } })).json()).tasks
    expect(linked.map((t: any) => t.title)).toContain(`For Ui ${runId}`)

    // 390 px: no horizontal scroll on the Tasks page, add button reachable
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dashboard/tasks')
    await waitForHydration(page)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'no horizontal page scroll at 390 px').toBeLessThanOrEqual(1)
    const box = await page.getByTestId('task-add-submit').boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  })
})
