import type { APIResponse } from '@playwright/test'
import { test, expect } from '../fixtures'
import { waitForHydration } from '../helpers/hydration'

/**
 * Regression: field robustness for the candidate forms (house rule: every
 * new or changed form gets this).
 *
 * Anything too long, out of range or not on a list must come back as a
 * clean 4xx that names the field — never a 500, and nothing half-saved.
 * The Add Candidate form must say the same in plain words before it sends
 * anything.
 *
 * Fresh org per test (fixture); everything created is deleted again.
 */

const runId = Date.now()

/** Every text field with its limit and a value one character over it. */
const OVERSIZE: Array<{ field: string, max: number, value: string }> = [
  { field: 'firstName', max: 100, value: 'x'.repeat(101) },
  { field: 'lastName', max: 100, value: 'x'.repeat(101) },
  { field: 'email', max: 255, value: `${'a'.repeat(250)}@example.com` },
  { field: 'phone', max: 50, value: '1'.repeat(51) },
  { field: 'linkedinUrl', max: 500, value: `linkedin.com/in/${'a'.repeat(490)}` },
  { field: 'position', max: 200, value: 'x'.repeat(201) },
  { field: 'company', max: 200, value: 'x'.repeat(201) },
  { field: 'location', max: 200, value: 'x'.repeat(201) },
  { field: 'headline', max: 300, value: 'x'.repeat(301) },
  { field: 'summary', max: 5000, value: 'x'.repeat(5001) },
]

/** A refused request: 4xx (never 5xx) whose body names the field. */
async function expectRefused(res: APIResponse, field: string, label: string, status = 400) {
  const text = await res.text()
  expect(res.status(), `${label}: expected ${status}, got ${res.status()} ${text.slice(0, 200)}`).toBe(status)
  expect(text, `${label}: the reply should name "${field}"`).toContain(field)
}

test.describe('Candidate field limits', () => {
  test('API create: oversize text, bad numbers, bad options, too many skills, blank names', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const base = { firstName: 'Limit', lastName: `Check${runId}` }
    const post = (extra: Record<string, unknown>) => api.post('/api/candidates', { data: { ...base, ...extra } })

    // Oversize paste into each text field
    for (const { field, value } of OVERSIZE) {
      await expectRefused(await post({ [field]: value }), field, `oversize ${field}`)
    }

    // Whitespace-only names
    await expectRefused(await post({ firstName: '   ' }), 'firstName', 'blank first name')
    await expectRefused(await post({ lastName: ' \t ' }), 'lastName', 'blank last name')
    await expectRefused(await api.post('/api/candidates', { data: { lastName: 'OnlyLast' } }), 'firstName', 'missing first name')

    // Money: negative, not whole, too large, not a number
    for (const field of ['salaryCurrent', 'salaryExpected', 'dayRate']) {
      await expectRefused(await post({ [field]: -1 }), field, `${field} negative`)
      await expectRefused(await post({ [field]: 1000.5 }), field, `${field} not whole`)
      await expectRefused(await post({ [field]: 'lots' }), field, `${field} not a number`)
      await expectRefused(await post({ [field]: '65000' }), field, `${field} as text`)
    }
    await expectRefused(await post({ salaryCurrent: 10_000_001 }), 'salaryCurrent', 'salary too large')
    await expectRefused(await post({ salaryExpected: 10_000_001 }), 'salaryExpected', 'salary too large')
    await expectRefused(await post({ dayRate: 100_001 }), 'dayRate', 'day rate too large')
    await expectRefused(await post({ salaryCurrency: 'POUNDS' }), 'salaryCurrency', 'bad currency')
    await expectRefused(await post({ salaryCurrency: '£' }), 'salaryCurrency', 'bad currency symbol')

    // Options not on the list
    await expectRefused(await post({ sourceChannel: 'carrier_pigeon' }), 'sourceChannel', 'bad source')
    await expectRefused(await post({ noticePeriod: '5_weeks' }), 'noticePeriod', 'bad notice period')
    await expectRefused(await post({ rightToWork: 'maybe' }), 'rightToWork', 'bad right to work')
    await expectRefused(await post({ workPreference: 'beach' }), 'workPreference', 'bad work preference')
    await expectRefused(await post({ workPreference: 7 }), 'workPreference', 'work preference not text')

    // Skills: 51 of them, one of 81 characters, a blank one, not a list
    await expectRefused(await post({ skills: Array.from({ length: 51 }, (_, i) => `Skill ${i}`) }), 'skills', '51 skills')
    await expectRefused(await post({ skills: ['x'.repeat(81)] }), 'skills', '81-character skill')
    await expectRefused(await post({ skills: ['   '] }), 'skills', 'blank skill')
    await expectRefused(await post({ skills: 'Sourcing' }), 'skills', 'skills not a list')

    // Work history / education: too many rows, missing or oversize parts
    await expectRefused(await post({ experiences: Array.from({ length: 31 }, (_, i) => ({ title: `Job ${i}` })) }), 'experiences', '31 jobs')
    await expectRefused(await post({ experiences: [{ company: 'No title Ltd' }] }), 'experiences', 'job without a title')
    await expectRefused(await post({ experiences: [{ title: 'x'.repeat(201) }] }), 'experiences', 'oversize job title')
    await expectRefused(await post({ experiences: [{ title: 'Ok', description: 'x'.repeat(4001) }] }), 'experiences', 'oversize job description')
    await expectRefused(await post({ education: Array.from({ length: 21 }, (_, i) => ({ school: `School ${i}` })) }), 'education', '21 courses')
    await expectRefused(await post({ education: [{ degree: 'BA' }] }), 'education', 'course without a school')

    // Nothing above was saved
    const list = await (await api.get('/api/candidates', { params: { search: `Check${runId}` } })).json()
    expect(list.total, 'refused requests must not create anyone').toBe(0)

    // The limits themselves are accepted (exactly at the edge)
    const edge = await post({
      position: 'x'.repeat(200),
      headline: 'x'.repeat(300),
      summary: 'x'.repeat(5000),
      salaryCurrent: 0,
      salaryExpected: 10_000_000,
      dayRate: 100_000,
      skills: Array.from({ length: 50 }, (_, i) => `Skill ${i} ${'x'.repeat(70)}`.slice(0, 80)),
    })
    expect(edge.status(), `values at the limit are fine: ${(await edge.text()).slice(0, 200)}`).toBe(201)
    const edgeBody = await edge.json()
    try {
      expect(edgeBody.salaryCurrent).toBe(0)
      expect(edgeBody.salaryExpected).toBe(10_000_000)
      expect(edgeBody.salaryCurrency).toBe('GBP')

      // ── PATCH: same rules ──
      const patch = (data: Record<string, unknown>) => api.patch(`/api/candidates/${edgeBody.id}`, { data })
      for (const { field, value } of OVERSIZE) {
        await expectRefused(await patch({ [field]: value }), field, `patch oversize ${field}`)
      }
      await expectRefused(await patch({ firstName: '   ' }), 'firstName', 'patch blank first name')
      await expectRefused(await patch({ salaryExpected: -5 }), 'salaryExpected', 'patch negative salary')
      await expectRefused(await patch({ dayRate: 12.5 }), 'dayRate', 'patch day rate not whole')
      await expectRefused(await patch({ salaryCurrent: 10_000_001 }), 'salaryCurrent', 'patch salary too large')
      await expectRefused(await patch({ noticePeriod: 'soon' }), 'noticePeriod', 'patch bad notice period')
      await expectRefused(await patch({ sourceChannel: 'x'.repeat(5000) }), 'sourceChannel', 'patch oversize source')

      // Still exactly what was saved
      const after = await (await api.get(`/api/candidates/${edgeBody.id}`)).json()
      expect(after.firstName).toBe('Limit')
      expect(after.salaryExpected).toBe(10_000_000)
      expect(after.skills).toHaveLength(50)
    }
    finally {
      await api.delete(`/api/candidates/${edgeBody.id}`)
    }
  })

  test('API duplicates + parse: oversize and undersize input', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request

    // Duplicates query: each value has a limit
    for (const [param, value] of [
      ['email', 'a'.repeat(256)],
      ['linkedinUrl', 'a'.repeat(501)],
      ['phone', '1'.repeat(51)],
      ['firstName', 'x'.repeat(101)],
      ['lastName', 'x'.repeat(101)],
      ['company', 'x'.repeat(201)],
      ['excludeId', 'x'.repeat(101)],
    ] as const) {
      await expectRefused(await api.get('/api/candidates/duplicates', { params: { [param]: value } }), param, `duplicates oversize ${param}`)
    }
    // Odd but harmless input is simply "no matches"
    const odd = await api.get('/api/candidates/duplicates', { params: { email: 'not-an-email', linkedinUrl: 'example.com/me', phone: 'abc', firstName: '%', lastName: '_' } })
    expect(odd.status()).toBe(200)
    expect((await odd.json()).matches).toEqual([])

    // Parse: 60,001 characters, 49 characters, spaces only, no text, wrong type
    const tooLong = await api.post('/api/candidates/parse', { data: { text: 'x'.repeat(60_001) } })
    expect(tooLong.status()).toBe(422)
    expect((await tooLong.json()).statusMessage).toContain('too long')

    const tooShort = await api.post('/api/candidates/parse', { data: { text: 'x'.repeat(49) } })
    expect(tooShort.status()).toBe(422)
    expect((await tooShort.json()).statusMessage).toContain('at least 50')

    const blank = await api.post('/api/candidates/parse', { data: { text: ' '.repeat(200) } })
    expect(blank.status()).toBe(422)

    expect((await api.post('/api/candidates/parse', { data: {} })).status()).toBe(422)
    expect((await api.post('/api/candidates/parse', { data: { text: 12345 } })).status()).toBe(422)

    // Multipart with no file part
    const noFile = await api.post('/api/candidates/parse', { multipart: { note: 'no file here' } })
    expect(noFile.status()).toBe(400)
  })

  test('UI: an oversize paste into each text field gets a plain message and nothing is sent', async ({ authenticatedPage: page }) => {
    await page.goto('/dashboard/candidates/new')
    await waitForHydration(page)
    await page.getByLabel('First Name').waitFor({ state: 'visible', timeout: 15_000 })

    let createCalls = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/api\/candidates$/.test(new URL(request.url()).pathname)) createCalls++
    })

    for (const { field, value } of OVERSIZE) {
      await page.locator(`#${field}`).fill(value)
    }
    await page.getByRole('button', { name: 'Save & open profile' }).click()

    for (const { field, max } of OVERSIZE) {
      const error = page.locator(`#${field}-error`)
      await expect(error, `${field} shows a message`).toBeVisible()
      // The email and LinkedIn boxes may say "not valid" first; everything else names the limit
      if (field !== 'email' && field !== 'linkedinUrl') {
        await expect(error).toContainText(`can be up to ${max.toLocaleString('en-GB')} characters`)
      }
      await expect(page.locator(`#${field}`)).toHaveAttribute('aria-describedby', new RegExp(`${field}-error`))
    }
    await expect(page.locator('#summary-count')).toHaveText('5,001 / 5,000')
    await expect(page.getByLabel('First Name')).toBeFocused()
    await expect(page).toHaveURL(/\/dashboard\/candidates\/new$/)
    expect(createCalls, 'the form must not send an invalid person').toBe(0)

    // Money boxes: negative and too large are refused in plain words
    for (const { field } of OVERSIZE) {
      await page.locator(`#${field}`).fill(field === 'firstName' ? 'Money' : field === 'lastName' ? `Check${runId}` : '')
    }
    await page.getByRole('button', { name: 'Add salary, notice period and more' }).click()
    await page.getByLabel('Expected salary').fill('-5')
    await page.getByLabel('Day rate').fill('100001')
    await page.getByRole('button', { name: 'Save & open profile' }).click()
    await expect(page.locator('#salaryExpected-error')).toContainText('whole number')
    await expect(page.locator('#dayRate-error')).toContainText('100,000 or less')
    await expect(page.getByLabel('Expected salary')).toBeFocused()
    expect(createCalls).toBe(0)

    // Skills box: an 81-character skill is refused, nothing is added
    await page.getByLabel('Add a skill').fill('x'.repeat(81))
    await page.getByLabel('Add a skill').press('Enter')
    await expect(page.locator('#skills-error')).toContainText('up to 80 characters')
    await expect(page.getByTestId('skill-chips')).toHaveCount(0)
    await expect(page).toHaveURL(/\/dashboard\/candidates\/new$/)
  })
})
