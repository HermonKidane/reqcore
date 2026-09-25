import { test, expect } from '../fixtures'

/**
 * Concurrency regression suite.
 *
 * 1. Concurrent candidate creates with the SAME email → exactly one 201,
 *    the rest 409, and NO 5xx (23505 unique violation mapped to 409).
 * 2. Parallel primary-email patches on one candidate → FOR UPDATE
 *    serialization: all succeed, cache ends as exactly one of the submitted
 *    values and stays stable.
 * 3. Double-submit public apply → second submission is a clean 409
 *    ("You have already applied"), never a 500.
 *
 * Runs against the sandbox. Requires the sandbox public-apply rate limit to
 * accommodate the applies in this spec (sandbox compose sets 50/IP/15min).
 */

const runId = Date.now()

async function createOpenJob(api: import('@playwright/test').APIRequestContext, title: string): Promise<{ id: string, slug: string }> {
  const res = await api.post('/api/jobs', { data: { title } })
  expect(res.status(), 'job create').toBe(201)
  const job = await res.json()
  const patch = await api.patch(`/api/jobs/${job.id}`, { data: { status: 'open' } })
  expect(patch.status(), 'job publish').toBe(200)
  return job
}

test.describe('Concurrency', () => {
  test('concurrent creates with same email → one 201, rest 409, no 5xx', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const shared = `race-${runId}@example.com`

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        api.post('/api/candidates', {
          data: { firstName: 'Race', lastName: `User${i}`, email: shared },
        }),
      ),
    )

    const statuses = results.map(r => r.status())
    const created = statuses.filter(s => s === 201).length
    const conflicts = statuses.filter(s => s === 409).length
    const serverErrors = statuses.filter(s => s >= 500)

    expect(serverErrors, `no 5xx expected, got ${serverErrors}`).toHaveLength(0)
    expect(created, `exactly one winner, got statuses ${statuses}`).toBe(1)
    expect(conflicts).toBe(7)

    // And exactly one candidate exists with that email
    const list = await (await api.get('/api/candidates', { params: { search: `race-${runId}` } })).json()
    expect(list.total).toBe(1)
  })

  test('parallel primary-email patches → serialized, single cache value, stable', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request

    const createRes = await api.post('/api/candidates', {
      data: { firstName: 'Patch', lastName: 'Race', email: `patch-race-${runId}@example.com` },
    })
    expect(createRes.status()).toBe(201)
    const { id } = await createRes.json()

    const newEmails = Array.from({ length: 6 }, (_, i) => `patch-race-${runId}-${i}@example.com`)

    const results = await Promise.all(
      newEmails.map(email =>
        api.patch(`/api/candidates/${id}`, { data: { email } }),
      ),
    )

    const statuses = results.map(r => r.status())
    expect(
      statuses.filter(s => s >= 500),
      `no 5xx expected, got ${statuses}`,
    ).toHaveLength(0)
    expect(statuses.every(s => s === 200), `all serialized patches succeed, got ${statuses}`).toBe(true)

    // Final state: cache equals exactly one of the submitted emails …
    const final1 = await (await api.get(`/api/candidates/${id}`)).json()
    expect(newEmails).toContain(final1.email)

    // … and is stable across repeated reads (cache parity)
    for (let i = 0; i < 3; i++) {
      const again = await (await api.get(`/api/candidates/${id}`)).json()
      expect(again.email).toBe(final1.email)
    }
  })

  test('double-submit public apply → clean 409', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const job = await createOpenJob(api, `Apply Race ${runId}`)

    const payload = {
      firstName: 'Apply',
      lastName: 'Race',
      email: `apply-race-${runId}@example.com`,
      responses: [],
    }

    // Fire BOTH submissions in the same tick — this is what actually races
    // the unique index inside the server (sequential applies only exercise
    // the pre-check path). Expect: one 2xx winner, one clean 409, no 500.
    const [first, second] = await Promise.all([
      api.post(`/api/public/jobs/${job.slug}/apply`, { data: payload }),
      api.post(`/api/public/jobs/${job.slug}/apply`, { data: payload }),
    ])

    const statuses = [first.status(), second.status()].sort()
    expect(statuses, `one winner + one 409, got ${statuses}`).toEqual([statuses[0], 409])
    expect(statuses[0]).toBeGreaterThanOrEqual(200)
    expect(statuses[0]).toBeLessThan(300)

    const loser = first.status() === 409 ? first : second
    const errBody = await loser.json()
    expect(errBody.statusMessage ?? errBody.message ?? '').toMatch(/already applied/i)
  })
})
