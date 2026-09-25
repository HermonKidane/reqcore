import { test, expect } from '../fixtures'

/**
 * Regression: CSV import happy path (Phase 1 API).
 *
 * upload → status/mapping preview → PUT mapping → commit (duplicatePolicy
 * 'skip') → candidates created → re-import of the same file skips duplicates.
 *
 * The import API is not exposed in the UI (API-only feature), so this is an
 * API-level spec using the authenticated page's request context.
 */

const runId = Date.now()

const CSV = `First Name,Last Name,Email
Import,One,import-one-${runId}@example.com
Import,Two,import-two-${runId}@example.com
Import,Three,import-three-${runId}@example.com
`

test.describe('CSV import happy path', () => {
  test('upload → map → commit creates candidates; re-import skips dups', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request

    // ── Upload ──────────────────────────────────────────────────────────────
    const uploadRes = await api.post('/api/candidates/import', {
      multipart: {
        file: {
          name: 'import-test.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(CSV),
        },
      },
    })
    expect(uploadRes.status(), 'upload should succeed').toBe(200)
    const { job: { id: importId } } = await uploadRes.json()
    expect(importId).toBeTruthy()

    // ── Status after upload ─────────────────────────────────────────────────
    const status1 = await (await api.get(`/api/candidates/import/${importId}`)).json()
    expect(status1.job.status).toBe('uploaded')
    expect(status1.job.columns).toEqual(['First Name', 'Last Name', 'Email'])
    expect(status1.summary.total).toBe(3)
    expect(status1.summary.ready).toBe(3)

    // ── Non-CSV filename rejected ───────────────────────────────────────────
    const badUpload = await api.post('/api/candidates/import', {
      multipart: {
        file: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
      },
    })
    expect(badUpload.status()).toBe(400)

    // ── Save mapping ────────────────────────────────────────────────────────
    const mappingRes = await api.put(`/api/candidates/import/${importId}/mapping`, {
      data: {
        mapping: {
          'First Name': 'firstName',
          'Last Name': 'lastName',
          'Email': 'email',
        },
      },
    })
    expect(mappingRes.status()).toBe(200)

    const status2 = await (await api.get(`/api/candidates/import/${importId}`)).json()
    expect(status2.job.status).toBe('mapped')

    // ── Commit with duplicatePolicy skip ────────────────────────────────────
    const commitRes = await api.post(`/api/candidates/import/${importId}/commit`, {
      data: { duplicatePolicy: 'skip' },
    })
    expect(commitRes.status()).toBe(200)
    const commit = await commitRes.json()
    expect(commit.result.created).toBe(3)
    expect(commit.result.skipped).toBe(0)

    const status3 = await (await api.get(`/api/candidates/import/${importId}`)).json()
    expect(status3.job.status).toBe('committed')

    // ── Verify the candidates landed (search by email fragment) ─────────────
    const listRes = await api.get('/api/candidates', {
      params: { search: `import-one-${runId}` },
    })
    expect(listRes.status()).toBe(200)
    const list = await listRes.json()
    const hit = list.data.find((c: { email: string | null }) =>
      c.email === `import-one-${runId}@example.com`,
    )
    expect(hit, 'imported candidate visible in list').toBeTruthy()

    // ── Re-import the same file → all duplicates skipped ────────────────────
    const upload2 = await api.post('/api/candidates/import', {
      multipart: {
        file: { name: 'import-test.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) },
      },
    })
    expect(upload2.status()).toBe(200)
    const { job: { id: importId2 } } = await upload2.json()

    const mapping2Res = await api.put(`/api/candidates/import/${importId2}/mapping`, {
      data: {
        mapping: {
          'First Name': 'firstName',
          'Last Name': 'lastName',
          'Email': 'email',
        },
      },
    })
    expect(mapping2Res.status()).toBe(200)

    const commit2 = await (await api.post(`/api/candidates/import/${importId2}/commit`, {
      data: { duplicatePolicy: 'skip' },
    })).json()
    expect(commit2.result.created).toBe(0)
    expect(commit2.result.skipped).toBe(3)

    // ── Double-commit of the same import → 409 (atomic status transition) ───
    const reCommit = await api.post(`/api/candidates/import/${importId}/commit`, {
      data: { duplicatePolicy: 'skip' },
    })
    expect(reCommit.status()).toBe(409)
  })
})
