import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { waitForHydration } from '../helpers/hydration'

/**
 * Regression: Add Candidate 2.0.
 *
 * API — qualifiers + skills + work history on create and read-back, patch
 * null-clears, phone normalisation, the duplicates endpoint (email /
 * LinkedIn / phone / name, excludeId, max 5), 409s that carry the existing
 * person's id, and the CV parse route (contacts come from the local
 * extraction; the AI may be real or the mock, so only the shape is checked).
 *
 * UI — at desktop and at 390 px: the sections, the "* Required" legend,
 * name-only save, "Save & add another", the duplicate warning, skill chips,
 * the collapsed qualifiers card, and no sideways scroll.
 *
 * Runs against the sandbox; the fixture gives each test a FRESH org and
 * everything created here is deleted again. (Org isolation of these routes
 * is covered by tenant-isolation.spec.ts patterns, not repeated here.)
 */

const runId = Date.now()

/** A minimal one-page PDF with real, extractable text (one line per entry). */
function makePdf(lines: string[]): Buffer {
  const esc = (t: string) => t.replace(/[\\()]/g, m => `\\${m}`)
  const stream = `BT /F1 11 Tf 50 780 Td 14 TL\n${lines.map(l => `(${esc(l)}) Tj T*`).join('\n')}\nET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/** A minimal Word .docx (one paragraph per line), compressed like Word does. `paddingMb` adds an entry of zeros. */
async function makeDocx(lines: string[], paddingMb = 0): Promise<Buffer> {
  const { default: JSZip } = await import('jszip')
  const xmlEsc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map(l => `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(l)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`)
  if (paddingMb) zip.file('word/media/padding.bin', Buffer.alloc(paddingMb * 1024 * 1024))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

async function cleanup(api: APIRequestContext, ids: string[]) {
  for (const id of ids) {
    await api.delete(`/api/candidates/${id}`)
  }
}

async function createPerson(api: APIRequestContext, ids: string[], data: Record<string, unknown>) {
  const res = await api.post('/api/candidates', { data })
  expect(res.status(), `create ${JSON.stringify(data).slice(0, 120)}`).toBe(201)
  const body = await res.json()
  ids.push(body.id)
  return body
}

async function openForm(page: Page) {
  await page.goto('/dashboard/candidates/new')
  await waitForHydration(page)
  await page.getByLabel('First Name').waitFor({ state: 'visible', timeout: 15_000 })
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'page must not scroll sideways').toBeLessThanOrEqual(0)
}

function idFromUrl(url: string): string | null {
  return /\/dashboard\/candidates\/([0-9a-f-]{36})/.exec(url)?.[1] ?? null
}

test.describe('Add Candidate 2.0 — API', () => {
  test('create with qualifiers, skills and history; read back; patch semantics; phone normalisation', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const ids: string[] = []
    try {
      const created = await createPerson(api, ids, {
        firstName: '  Quinn ',
        lastName: `Qualifier${runId}`,
        email: `quinn-${runId}@example.com`,
        phone: '07700 900123',
        linkedinUrl: `linkedin.com/in/quinn-${runId}`,
        position: 'Senior Recruiter',
        company: 'Acme Ltd',
        location: 'Leeds, UK',
        headline: 'Tech recruiter',
        summary: 'Ten years in technical hiring.',
        sourceChannel: 'referral',
        salaryCurrent: 60000,
        salaryExpected: 65000,
        dayRate: 450,
        noticePeriod: '1_month',
        rightToWork: 'yes',
        workPreference: 'hybrid',
        skills: ['Sourcing', ' sourcing ', 'Negotiation'],
        experiences: [
          { title: 'Senior Recruiter', company: 'Acme Ltd', startText: 'Jan 2020', endText: 'Present', isCurrent: true },
          { title: 'Recruiter', company: 'Globex', startText: '2016', endText: '2019' },
        ],
        education: [{ school: 'University of Leeds', degree: 'BA', fieldOfStudy: 'History' }],
      })

      // POST response: trimmed name, normalised phone, the eight qualifiers
      expect(created.firstName).toBe('Quinn')
      expect(created.phone).toBe('+44 7700 900123')
      expect(created.sourceChannel).toBe('referral')
      expect(created.salaryCurrency, 'GBP is applied when a money field is set').toBe('GBP')
      expect(created.salaryCurrent).toBe(60000)
      expect(created.salaryExpected).toBe(65000)
      expect(created.dayRate).toBe(450)
      expect(created.noticePeriod).toBe('1_month')
      expect(created.rightToWork).toBe('yes')
      expect(created.workPreference).toBe('hybrid')

      // GET: same values + skills / experiences / education rows
      const got = await (await api.get(`/api/candidates/${created.id}`)).json()
      expect(got.salaryExpected).toBe(65000)
      expect(got.workPreference).toBe('hybrid')
      expect(got.skills.map((s: any) => s.name), 'skills de-duplicated, A–Z').toEqual(['Negotiation', 'Sourcing'])
      expect(got.skills.every((s: any) => s.source === 'manual')).toBe(true)
      expect(got.experiences.map((e: any) => [e.title, e.sortOrder, e.source])).toEqual([
        ['Senior Recruiter', 0, 'cv'],
        ['Recruiter', 1, 'cv'],
      ])
      expect(got.experiences[0].isCurrent).toBe(true)
      expect(got.education.map((e: any) => [e.school, e.sortOrder, e.source])).toEqual([['University of Leeds', 0, 'cv']])

      // No money → no currency
      const plain = await createPerson(api, ids, { firstName: 'Plain', lastName: `Person${runId}`, noticePeriod: 'immediate' })
      expect(plain.salaryCurrency).toBeNull()
      expect(plain.salaryExpected).toBeNull()
      expect(plain.noticePeriod).toBe('immediate')

      // PATCH: null clears, blank / absent = no change
      const cleared = await api.patch(`/api/candidates/${created.id}`, {
        data: { salaryExpected: null, noticePeriod: null, sourceChannel: null, rightToWork: '' },
      })
      expect(cleared.status()).toBe(200)
      const clearedBody = await cleared.json()
      expect(clearedBody.salaryExpected).toBeNull()
      expect(clearedBody.noticePeriod).toBeNull()
      expect(clearedBody.sourceChannel).toBeNull()
      expect(clearedBody.rightToWork, 'blank = no change').toBe('yes')
      expect(clearedBody.salaryCurrent, 'absent = no change').toBe(60000)
      expect(clearedBody.workPreference, 'absent = no change').toBe('hybrid')

      // PATCH: phone is normalised the same way; a money field brings GBP with it
      const patched = await api.patch(`/api/candidates/${plain.id}`, {
        data: { phone: '(020) 7946 0958', dayRate: 500, workPreference: 'remote' },
      })
      expect(patched.status()).toBe(200)
      const patchedBody = await patched.json()
      expect(patchedBody.phone).toBe('+44 20 7946 0958')
      expect(patchedBody.dayRate).toBe(500)
      expect(patchedBody.salaryCurrency).toBe('GBP')
      expect(patchedBody.workPreference).toBe('remote')

      // An explicit currency is kept
      const eur = await api.patch(`/api/candidates/${plain.id}`, { data: { salaryCurrency: 'eur', salaryExpected: 70000 } })
      expect((await eur.json()).salaryCurrency).toBe('EUR')

      // Phones the normaliser does not understand are stored as typed (trimmed)
      const other = await createPerson(api, ids, { firstName: 'Other', lastName: `Phone${runId}`, phone: ' +1 (415) 555-0123 ' })
      expect(other.phone).toBe('+1 415 555 0123')
    }
    finally {
      await cleanup(api, ids)
    }
  })

  test('duplicates endpoint: email, LinkedIn, phone, name, excludeId, max 5', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const ids: string[] = []
    const dup = async (params: Record<string, string>) => {
      const res = await api.get('/api/candidates/duplicates', { params })
      expect(res.status(), `duplicates ${JSON.stringify(params)}`).toBe(200)
      return (await res.json()).matches as Array<Record<string, any>>
    }
    try {
      const email = `dup-${runId}@example.com`
      const jane = await createPerson(api, ids, {
        firstName: 'Jane',
        lastName: `Dup${runId}`,
        email,
        phone: '07700 900456',
        linkedinUrl: `https://www.linkedin.com/in/jane-dup-${runId}`,
        company: 'Acme Ltd',
        position: 'Senior Recruiter',
      })

      // Nothing asked → nothing found
      expect(await dup({})).toEqual([])

      // Email (other capitals) → exact
      const byEmail = await dup({ email: email.toUpperCase() })
      expect(byEmail).toHaveLength(1)
      expect(byEmail[0]).toMatchObject({ id: jane.id, firstName: 'Jane', company: 'Acme Ltd', position: 'Senior Recruiter', reason: 'email', strength: 'exact' })
      // Contact details never come back
      expect(Object.keys(byEmail[0]!).sort()).toEqual(['company', 'firstName', 'id', 'lastName', 'location', 'position', 'reason', 'strength'])

      // LinkedIn in another spelling → exact
      const byLinkedin = await dup({ linkedinUrl: `linkedin.com/in/JANE-dup-${runId}/?trk=x` })
      expect(byLinkedin).toHaveLength(1)
      expect(byLinkedin[0]).toMatchObject({ id: jane.id, reason: 'linkedin', strength: 'exact' })

      // Phone: digits only, last 9 → likely; under 9 digits → not checked
      const byPhone = await dup({ phone: '+44 (0)7700 900-456' })
      expect(byPhone).toHaveLength(1)
      expect(byPhone[0]).toMatchObject({ id: jane.id, reason: 'phone', strength: 'likely' })
      expect(await dup({ phone: '900456' })).toEqual([])

      // Name, any capitals → possible; with the company → likely
      const byName = await dup({ firstName: ' jane ', lastName: `DUP${runId}` })
      expect(byName).toHaveLength(1)
      expect(byName[0]).toMatchObject({ id: jane.id, reason: 'name', strength: 'possible' })
      const byNameCompany = await dup({ firstName: 'Jane', lastName: `Dup${runId}`, company: 'ACME LTD' })
      expect(byNameCompany[0]).toMatchObject({ id: jane.id, reason: 'name', strength: 'likely' })
      // First name alone is not a match
      expect(await dup({ firstName: 'Jane' })).toEqual([])

      // One entry per person — the strongest reason wins
      const all = await dup({ email, phone: '07700 900456', firstName: 'Jane', lastName: `Dup${runId}` })
      expect(all).toHaveLength(1)
      expect(all[0]).toMatchObject({ reason: 'email', strength: 'exact' })

      // excludeId removes the person themselves
      expect(await dup({ email, excludeId: jane.id })).toEqual([])

      // Max 5, strongest first
      for (let i = 0; i < 6; i++) {
        await createPerson(api, ids, { firstName: 'Sam', lastName: `Many${runId}`, company: i === 5 ? 'Globex' : `Co ${i}` })
      }
      const many = await dup({ firstName: 'Sam', lastName: `Many${runId}`, company: 'Globex' })
      expect(many).toHaveLength(5)
      expect(many[0], 'company match is listed first').toMatchObject({ strength: 'likely', company: 'Globex' })
      expect(many.slice(1).every(m => m.strength === 'possible')).toBe(true)
    }
    finally {
      await cleanup(api, ids)
    }
  })

  test('409 on create carries the existing person and keeps the message', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const ids: string[] = []
    try {
      const email = `conflict-${runId}@example.com`
      const first = await createPerson(api, ids, {
        firstName: 'First',
        lastName: `Conflict${runId}`,
        email,
        linkedinUrl: `linkedin.com/in/conflict-${runId}`,
      })

      const emailDup = await api.post('/api/candidates', { data: { firstName: 'Second', lastName: 'Person', email: email.toUpperCase() } })
      expect(emailDup.status()).toBe(409)
      const emailBody = await emailDup.json()
      expect(emailBody.statusMessage).toBe('A candidate with this email already exists')
      expect(emailBody.data).toEqual({ existingId: first.id, field: 'email' })

      const linkedinDup = await api.post('/api/candidates', {
        data: { firstName: 'Third', lastName: 'Person', linkedinUrl: `https://www.linkedin.com/in/conflict-${runId}/` },
      })
      expect(linkedinDup.status()).toBe(409)
      const linkedinBody = await linkedinDup.json()
      expect(linkedinBody.statusMessage).toBe('A candidate with this LinkedIn URL already exists')
      expect(linkedinBody.data).toEqual({ existingId: first.id, field: 'linkedinUrl' })
    }
    finally {
      await cleanup(api, ids)
    }
  })

  test('parse: contacts come from the local extraction; AI may be real or mock', async ({ authenticatedPage }) => {
    test.setTimeout(180_000)
    const api = authenticatedPage.request
    const email = `parse-${runId}@example.com`
    const text = [
      'Jane Parser',
      'Senior Recruiter at Acme Ltd, Leeds',
      `Email: ${email}   Mobile: 07700 900789`,
      `linkedin.com/in/jane-parser-${runId}`,
      '',
      'Experience',
      'Acme Ltd, Senior Recruiter, 2019 - 2023',
      'Globex, Recruiter, 2015 - 2019',
      '',
      'Skills: Sourcing, Negotiation, Stakeholder management',
    ].join('\n')

    const before = await (await api.get('/api/candidates')).json()

    // Pasted text
    const res = await api.post('/api/candidates/parse', { data: { text }, timeout: 60_000 })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('text')
    expect(body.fields.email, 'email is the one in the text').toBe(email)
    expect(body.fields.phone, 'phone is normalised').toBe('+44 7700 900789')
    expect(body.fields.linkedinUrl).toBe(`linkedin.com/in/jane-parser-${runId}`)
    expect(Object.keys(body.fields).sort()).toEqual(['company', 'email', 'firstName', 'headline', 'lastName', 'linkedinUrl', 'location', 'phone', 'position', 'summary'])
    expect(Array.isArray(body.skills)).toBe(true)
    expect(Array.isArray(body.experiences)).toBe(true)
    expect(Array.isArray(body.education)).toBe(true)
    if (!body.aiUnavailable) {
      expect(typeof body.fields.firstName).toBe('string')
    }

    // A plain text file (multipart)
    const fileRes = await api.post('/api/candidates/parse', {
      multipart: { file: { name: 'jane-parser.txt', mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') } },
      timeout: 60_000,
    })
    expect(fileRes.status()).toBe(200)
    const fileBody = await fileRes.json()
    expect(fileBody.source).toBe('file')
    expect(fileBody.filename).toBe('jane-parser.txt')
    expect(fileBody.fields.email).toBe(email)

    // A real PDF and a real Word file: text is extracted on the server
    // (unpdf / mammoth) and the contacts are still read locally
    const cvLines = text.split('\n').filter(Boolean)
    for (const cv of [
      { name: 'jane-parser.pdf', mimeType: 'application/pdf', buffer: makePdf(cvLines) },
      { name: 'jane-parser.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await makeDocx(cvLines) },
    ]) {
      const cvRes = await api.post('/api/candidates/parse', { multipart: { file: cv }, timeout: 60_000 })
      expect(cvRes.status(), `${cv.name} is read`).toBe(200)
      const cvBody = await cvRes.json()
      expect(cvBody.source).toBe('file')
      expect(cvBody.filename).toBe(cv.name)
      expect(cvBody.fields.email, `${cv.name}: email read from the file`).toBe(email)
      expect(cvBody.fields.phone, `${cv.name}: phone read and normalised`).toBe('+44 7700 900789')
    }

    // Old binary Word (.doc) → 415 with the plain-words message
    const ole2 = Buffer.concat([Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]), Buffer.alloc(600)])
    const docRes = await api.post('/api/candidates/parse', {
      multipart: { file: { name: 'old.doc', mimeType: 'application/msword', buffer: ole2 } },
    })
    expect(docRes.status()).toBe(415)
    expect((await docRes.json()).statusMessage).toBe('Old .doc files can\'t be read. Save it as PDF or .docx and try again.')

    // A small .docx that unpacks to 60 MB (zip bomb shape) is refused before it is unpacked in full
    const bomb = await makeDocx(cvLines, 60)
    expect(bomb.length, 'the bomb is small on the wire').toBeLessThan(1024 * 1024)
    const bombRes = await api.post('/api/candidates/parse', {
      multipart: { file: { name: 'big.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: bomb } },
      timeout: 60_000,
    })
    expect(bombRes.status()).toBe(422)

    // An image is not a CV we can read
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(200)])
    const pngRes = await api.post('/api/candidates/parse', {
      multipart: { file: { name: 'scan.png', mimeType: 'image/png', buffer: png } },
    })
    expect(pngRes.status()).toBe(415)

    // A file with almost no text → 422
    const tinyRes = await api.post('/api/candidates/parse', {
      multipart: { file: { name: 'tiny.txt', mimeType: 'text/plain', buffer: Buffer.from('Jane Parser', 'utf8') } },
    })
    expect(tinyRes.status()).toBe(422)
    expect((await tinyRes.json()).statusMessage).toContain('couldn\'t read any text')

    // The route never writes
    const after = await (await api.get('/api/candidates')).json()
    expect(after.total).toBe(before.total)
  })
})

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile 390', width: 390, height: 844 },
]) {
  test.describe(`Add Candidate 2.0 — UI (${viewport.name})`, () => {
    test('sections, legend, collapsed qualifiers, skill chips, no sideways scroll, name-only save', async ({ authenticatedPage: page }) => {
      const api = page.request
      const ids: string[] = []
      try {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await openForm(page)

        // Sections + legend
        for (const heading of ['Start from a CV', 'Identity & contact', 'Current role & location', 'Qualifiers', 'Skills', 'Pitch']) {
          await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible()
        }
        await expect(page.getByText('* Required')).toBeVisible()
        await expect(page.locator('form[data-tour="candidate-form"]')).toBeVisible()
        // A fresh org has no open jobs → no "Add to a job" card
        await expect(page.getByRole('heading', { level: 2, name: 'Add to a job' })).toHaveCount(0)
        await expect(page.getByText('Email and phone are read on our server and are not sent to the AI.')).toBeVisible()
        await expectNoSidewaysScroll(page)

        // Qualifiers: collapsed, then opened
        await expect(page.getByLabel('Expected salary')).toBeHidden()
        await page.getByRole('button', { name: 'Add salary, notice period and more' }).click()
        await expect(page.getByLabel('Expected salary')).toBeVisible()
        await expect(page.getByLabel('Currency')).toHaveValue('GBP')
        await page.getByLabel('Expected salary').fill('65000')
        await expect(page.locator('[data-money-hint="salaryExpected"]')).toHaveText('£65,000')
        await page.getByLabel('Notice period').selectOption('1_month')
        await page.getByLabel('Right to work').selectOption({ label: 'Has the right to work in the UK' })
        await page.getByRole('button', { name: 'Hybrid', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Hybrid', exact: true })).toHaveAttribute('aria-pressed', 'true')

        // Skills: Enter and comma add, no repeats, x removes, Backspace removes the last
        const skillInput = page.getByLabel('Add a skill')
        const chips = page.getByTestId('skill-chips').locator('li')
        await skillInput.fill('Sourcing')
        await skillInput.press('Enter')
        await skillInput.pressSequentially('Negotiation,')
        await expect(chips).toHaveCount(2)
        await expect(skillInput).toHaveValue('')
        await skillInput.fill('sourcing')
        await skillInput.press('Enter')
        await expect(chips, 'same skill in other capitals is not added twice').toHaveCount(2)
        await page.getByRole('button', { name: 'Remove skill Sourcing' }).click()
        await expect(chips).toHaveCount(1)
        await skillInput.fill('Interviewing')
        await skillInput.press('Enter')
        await expect(chips).toHaveCount(2)
        await skillInput.press('Backspace')
        await expect(chips).toHaveCount(1)
        await expect(chips.first()).toContainText('Negotiation')

        // Phone is tidied when you leave the box
        await page.getByLabel('Phone').fill('07700 900321')
        await page.getByLabel('Phone').blur()
        await expect(page.getByLabel('Phone')).toHaveValue('+44 7700 900321')
        await page.getByLabel('Phone').fill('')

        // Summary counter
        await page.getByLabel('Summary').fill('Hello')
        await expect(page.locator('#summary-count')).toHaveText('5 / 5,000')
        await page.getByLabel('Summary').fill('')
        await expectNoSidewaysScroll(page)

        // Save with nothing typed → both names flagged, first one focused
        await page.getByRole('button', { name: 'Save & open profile' }).click()
        await expect(page.locator('#firstName-error')).toHaveText(/First name is required/)
        await expect(page.locator('#lastName-error')).toHaveText(/Last name is required/)
        await expect(page.getByLabel('First Name')).toBeFocused()

        // Names (+ what was set above) → lands on the profile
        const first = `Ui${runId}`
        const last = viewport.width < 600 ? 'Mobile' : 'Desktop'
        await page.getByLabel('First Name').fill(first)
        await page.getByLabel('Last Name').fill(last)
        await page.getByRole('button', { name: 'Save & open profile' }).click()
        await expect(page).toHaveURL(/\/dashboard\/candidates\/[0-9a-f-]{36}$/)
        const id = idFromUrl(page.url())
        if (id) ids.push(id)
        await expect(page.getByRole('heading', { level: 1, name: `${first} ${last}` })).toBeVisible()

        // The profile shows the qualifiers that have a value
        const block = page.getByTestId('candidate-qualifiers')
        await expect(block).toContainText('£65,000')
        await expect(block).toContainText('1 month')
        await expect(block).toContainText('Has the right to work in the UK')
        await expect(block).toContainText('Hybrid')

        // …and they were stored
        const got = await (await api.get(`/api/candidates/${id}`)).json()
        expect(got.salaryExpected).toBe(65000)
        expect(got.salaryCurrency).toBe('GBP')
        expect(got.skills.map((s: any) => s.name)).toEqual(['Negotiation'])
      }
      finally {
        await cleanup(api, ids)
      }
    })

    test('"Save & add another" resets the form, keeps the source and shows the saved line', async ({ authenticatedPage: page }) => {
      const api = page.request
      const ids: string[] = []
      try {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await openForm(page)

        await page.getByRole('button', { name: 'Add salary, notice period and more' }).click()
        await page.getByLabel('How we found them').selectOption('referral')
        await page.getByLabel('First Name').fill('Another')
        await page.getByLabel('Last Name').fill(`Person${runId}`)
        await page.getByLabel('Position').fill('Recruiter')
        await page.getByRole('button', { name: 'Save & add another' }).click()

        const notice = page.getByTestId('saved-notice')
        await expect(notice).toContainText(`Another Person${runId} saved`)
        const link = notice.getByRole('link', { name: 'Open profile' })
        await expect(link).toHaveAttribute('href', /\/dashboard\/candidates\/[0-9a-f-]{36}$/)
        const id = idFromUrl((await link.getAttribute('href')) ?? '')
        if (id) ids.push(id)

        // Still on the form, emptied, first name focused, source kept
        await expect(page).toHaveURL(/\/dashboard\/candidates\/new$/)
        await expect(page.getByLabel('First Name')).toHaveValue('')
        await expect(page.getByLabel('Last Name')).toHaveValue('')
        await expect(page.getByLabel('Position')).toHaveValue('')
        await expect(page.getByLabel('First Name')).toBeFocused()
        await expect(page.getByLabel('How we found them')).toHaveValue('referral')
        await expectNoSidewaysScroll(page)

        const saved = await (await api.get(`/api/candidates/${id}`)).json()
        expect(saved.sourceChannel).toBe('referral')
        expect(saved.position).toBe('Recruiter')
      }
      finally {
        await cleanup(api, ids)
      }
    })

    test('duplicate warning: existing email (with Open link and 409 link) and a likely match that needs the tick', async ({ authenticatedPage: page, context }) => {
      const api = page.request
      const ids: string[] = []
      try {
        const email = `ui-dup-${runId}-${viewport.width}@example.com`
        const existing = await createPerson(api, ids, {
          firstName: 'Jane',
          lastName: `Existing${runId}`,
          email,
          phone: '07700 900654',
          position: 'Senior Recruiter',
          company: 'Acme Ltd',
        })

        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await openForm(page)

        // ── Same email → red panel, Open link in a new tab ──
        await page.getByLabel('Email', { exact: true }).fill(email)
        await page.getByLabel('Email', { exact: true }).blur()
        const warning = page.getByTestId('duplicate-warning')
        await expect(warning).toContainText('This person already exists')
        await expect(warning).toContainText(`Jane Existing${runId} — Senior Recruiter at Acme Ltd (same email)`)
        const open = warning.getByRole('link', { name: /Open/ })
        await expect(open).toHaveAttribute('target', '_blank')
        await expect(open).toHaveAttribute('href', new RegExp(`/dashboard/candidates/${existing.id}$`))
        await expectNoSidewaysScroll(page)

        const [popup] = await Promise.all([context.waitForEvent('page'), open.click()])
        await expect(popup).toHaveURL(new RegExp(`/dashboard/candidates/${existing.id}$`))
        await popup.close()
        // The form is still here, untouched
        await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email)

        // Saving anyway → the server refuses; message + link under the email box
        await page.getByLabel('First Name').fill('Someone')
        await page.getByLabel('Last Name').fill('Else')
        await page.getByRole('button', { name: 'Save & open profile' }).click()
        const emailError = page.locator('#email-error')
        await expect(emailError).toContainText('A candidate with this email already exists')
        await expect(emailError.getByRole('link', { name: 'Open the existing person' })).toHaveAttribute('href', new RegExp(`/dashboard/candidates/${existing.id}$`))
        await expect(page).toHaveURL(/\/dashboard\/candidates\/new$/)

        // ── Same phone, different email → amber panel + tick before saving ──
        await page.getByLabel('Email', { exact: true }).fill('')
        await page.getByLabel('Phone').fill('07700 900654')
        await page.getByLabel('Phone').blur()
        await expect(warning).toContainText(`Possible duplicate: Jane Existing${runId} — Senior Recruiter at Acme Ltd (same phone number)`)
        await expect(warning).not.toContainText('This person already exists')
        const tick = page.getByLabel('This is a different person')
        await expect(tick).not.toBeChecked()

        await page.getByRole('button', { name: 'Save & open profile' }).click()
        await expect(page.locator('#differentPerson-error')).toBeVisible()
        await expect(page).toHaveURL(/\/dashboard\/candidates\/new$/)

        await tick.check()
        await page.getByRole('button', { name: 'Save & open profile' }).click()
        await expect(page).toHaveURL(/\/dashboard\/candidates\/[0-9a-f-]{36}$/)
        const id = idFromUrl(page.url())
        if (id) ids.push(id)
        await expect(page.getByRole('heading', { level: 1, name: 'Someone Else' })).toBeVisible()
      }
      finally {
        await cleanup(api, ids)
      }
    })
  })
}

test.describe('Add Candidate 2.0 — UI extras', () => {
  test('"Start from a CV": pasted text fills empty fields only and marks them', async ({ authenticatedPage: page }) => {
    test.setTimeout(180_000)
    const api = page.request
    const ids: string[] = []
    try {
      await openForm(page)
      const email = `cv-ui-${runId}@example.com`

      // Typed first — the CV must not overwrite it
      await page.getByLabel('Position').fill('Typed by hand')

      await page.getByRole('button', { name: 'Paste text instead' }).click()
      const fill = page.getByRole('button', { name: 'Fill the form' })
      await expect(fill).toBeDisabled()
      await page.getByLabel('CV text').fill([
        'Jane Pasted',
        'Senior Recruiter at Acme Ltd, Leeds',
        `Email: ${email}   Mobile: 07700 900987`,
        'Experience: Acme Ltd, Senior Recruiter, 2019 - 2023',
      ].join('\n'))
      await expect(fill).toBeEnabled()
      await fill.click()

      // Contact details always arrive (they are read on the server, not by the AI)
      await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email, { timeout: 60_000 })
      await expect(page.getByLabel('Phone')).toHaveValue('+44 7700 900987')
      await expect(page.locator('#email-cv')).toHaveText('From CV — check')
      await expect(page.getByLabel('Position'), 'typed value is kept').toHaveValue('Typed by hand')
      await expect(page.locator('#position-cv')).toHaveCount(0)

      // Editing a filled field removes its hint
      await page.getByLabel('Phone').fill('07700 900988')
      await expect(page.locator('#phone-cv')).toHaveCount(0)
      await expect(page.locator('#email-cv')).toBeVisible()

      // Names may or may not have been read (real AI or mock) — fill them and save
      await page.getByLabel('First Name').fill('Jane')
      await page.getByLabel('Last Name').fill(`Pasted${runId}`)
      await page.getByRole('button', { name: 'Save & open profile' }).click()
      await expect(page).toHaveURL(/\/dashboard\/candidates\/[0-9a-f-]{36}$/)
      const id = idFromUrl(page.url())
      if (id) ids.push(id)
      const saved = await (await api.get(`/api/candidates/${id}`)).json()
      expect(saved.email).toBe(email)
      expect(saved.phone).toBe('+44 7700 900988')
      expect(saved.position).toBe('Typed by hand')
    }
    finally {
      await cleanup(api, ids)
    }
  })

  test('profile edit form: qualifiers can be set and cleared', async ({ authenticatedPage: page }) => {
    const api = page.request
    const ids: string[] = []
    try {
      const person = await createPerson(api, ids, { firstName: 'Edit', lastName: `Qualifiers${runId}`, noticePeriod: '3_months' })
      await page.goto(`/dashboard/candidates/${person.id}`)
      await waitForHydration(page)
      await expect(page.getByTestId('candidate-qualifiers')).toContainText('3 months')

      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await expect(page.locator('#edit-noticePeriod')).toHaveValue('3_months')
      await page.locator('#edit-noticePeriod').selectOption('')
      await page.locator('#edit-salaryExpected').fill('72000')
      await page.locator('#edit-salaryCurrency').selectOption('EUR')
      await page.locator('#edit-rightToWork').selectOption('sponsorship_needed')
      await page.getByRole('button', { name: 'Save Changes' }).click()

      const block = page.getByTestId('candidate-qualifiers')
      await expect(block).toContainText('€72,000')
      await expect(block).toContainText('Needs visa sponsorship')
      await expect(block).not.toContainText('3 months')

      const got = await (await api.get(`/api/candidates/${person.id}`)).json()
      expect(got.noticePeriod).toBeNull()
      expect(got.salaryExpected).toBe(72000)
      expect(got.salaryCurrency).toBe('EUR')
    }
    finally {
      await cleanup(api, ids)
    }
  })
})

test.describe('Top bar', () => {
  test('never makes the page scroll sideways, even with a long organisation name', async ({ authenticatedPage: page }) => {
    // The fixture org is "E2E Org <timestamp>-<n>" — long enough to have pushed the bar past the page at 1280.
    for (const width of [768, 900, 1024, 1100, 1280, 1366, 1440, 1536, 1920]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/dashboard/candidates')
      await waitForHydration(page)
      await expect(page.getByRole('heading', { level: 1, name: 'Candidates' })).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `sideways scroll at ${width} px`).toBeLessThanOrEqual(0)
    }
  })
})
