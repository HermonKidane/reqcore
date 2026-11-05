import { test, expect } from '../fixtures'
import { MOCK_OUTPUTS } from '../../server/utils/ai/provider'
import { aiOutputToStepFields, aiOutputToTasks } from '../../shared/recruitment/ai-output-to-step'
import { DEFAULT_AI_PROMPTS } from '../../shared/recruitment/ai-prompts'

/**
 * Session W slice 1 — feature A "Transcript in" (plumbing P1).
 *
 * API-level: call transcripts (validation, org scoping, delete), AI runs with
 * `purpose` + `transcriptId`, the step 5 do-not-contact stop rule, PII
 * redaction of the transcript in the run's input snapshot, and the in-process
 * "use in step" mapping on the canned mock shapes.
 *
 * Works against the mock provider AND a real one: output content is never
 * asserted, only run status / purpose / snapshot fields.
 */

const runId = Date.now()
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

interface StepInstance {
  id: string
  status: string
  stepTemplate: { stepNumber: number, key: string, name: string, completionRules: Record<string, unknown> | null }
}

type Api = import('@playwright/test').APIRequestContext

async function makeApplication(api: Api, label: string): Promise<{ applicationId: string, candidateId: string, jobId: string }> {
  const jobRes = await api.post('/api/jobs', { data: { title: `Transcript ${label} ${runId}` } })
  expect(jobRes.status()).toBe(201)
  const job = await jobRes.json()
  await api.patch(`/api/jobs/${job.id}`, { data: { status: 'open' } })
  // Internal routes, not the public apply: the sandbox allows 50 public applications per IP per 15 min and the full gate exceeds that.
  const candRes = await api.post('/api/candidates', { data: { firstName: 'Tx', lastName: label, email: `tx-${label.toLowerCase()}-${runId}@example.com` } })
  expect(candRes.status()).toBe(201)
  const candidateId = (await candRes.json()).id as string
  const appRes = await api.post('/api/applications', { data: { candidateId, jobId: job.id } })
  expect(appRes.status(), 'create application').toBe(201)
  const applicationId = (await appRes.json()).id as string
  return { applicationId, candidateId, jobId: job.id as string }
}

async function steps(api: Api, applicationId: string): Promise<StepInstance[]> {
  const wf = await (await api.get(`/api/applications/${applicationId}/workflow`)).json()
  return wf.instances
}

const TRANSCRIPT = `Recruiter: Hi, is that Sam? Thanks for picking up. I work for a search firm in Leeds, recruiting in finance.
Sam: Yes, that's me. Bit of a busy one but go on.
Recruiter: I'm calling to arrange a short call, at a time that suits you, to outline a role. Would tomorrow at 1pm or 6pm work?
Sam: Thursday after six works better. I'm on a month's notice anyway so no rush.
Recruiter: Thursday at six it is. Best number to reach you on?
Sam: Use my mobile, 07700 900123, or email sam.example@example.com.
Recruiter: Noted. Speak Thursday.`

test.describe('Slice 1 — transcript in', () => {
  test('1. prompts: steps 1 and 6 flag aiAssist; six prep/outcome prompt rows exist', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { applicationId } = await makeApplication(api, 'Flags')
    const all = await steps(api, applicationId)
    for (const n of [1, 5, 6, 11]) {
      const s = all.find(i => i.stepTemplate.stepNumber === n)!
      expect(s.stepTemplate.completionRules?.aiAssist, `step ${n} aiAssist`).toBe(true)
    }
    const slice1 = DEFAULT_AI_PROMPTS.filter(p => p.purpose && p.purpose !== 'assist')
    expect(slice1.map(p => `${p.stepKey}:${p.purpose}`).sort()).toEqual([
      'candidate_contact:outcome', 'candidate_contact:prep', 'candidate_debrief:outcome',
      'candidate_profile:outcome', 'candidate_profile:prep', 'complete_job_order:outcome',
    ])
  })

  test('2. call transcripts: validation, no text in create response, GET returns it, cross-org 404, delete', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { applicationId, candidateId } = await makeApplication(api, 'Tx')
    const step5 = (await steps(api, applicationId)).find(i => i.stepTemplate.stepNumber === 5)!

    // consent checkbox is required
    let res = await api.post('/api/call-transcripts', { data: { text: TRANSCRIPT, consentNoted: false, stepInstanceId: step5.id } })
    expect(res.status(), 'no consent → 422').toBe(422)
    // too short / too long
    res = await api.post('/api/call-transcripts', { data: { text: 'short', consentNoted: true } })
    expect(res.status(), 'short → 422').toBe(422)
    res = await api.post('/api/call-transcripts', { data: { text: 'x'.repeat(60_001), consentNoted: true } })
    expect(res.status(), '60 001 chars → 422').toBe(422)
    // unknown links → 404
    res = await api.post('/api/call-transcripts', { data: { text: TRANSCRIPT, consentNoted: true, candidateId: 'nope' } })
    expect(res.status(), 'unknown candidate → 404').toBe(404)
    // extra keys rejected (strict)
    res = await api.post('/api/call-transcripts', { data: { text: TRANSCRIPT, consentNoted: true, source: 'vonage' } })
    expect(res.status(), 'source vonage not accepted yet → 422').toBe(422)

    res = await api.post('/api/call-transcripts', { data: { text: TRANSCRIPT, consentNoted: true, stepInstanceId: step5.id, applicationId, candidateId } })
    expect(res.status(), 'create').toBe(201)
    const created = await res.json()
    expect(created.text, 'text not echoed').toBeUndefined()
    expect(created.charCount).toBe(TRANSCRIPT.length)
    expect(created.consentNoted).toBe(true)

    const got = await (await api.get(`/api/call-transcripts/${created.id}`)).json()
    expect(got.text).toBe(TRANSCRIPT)

    // cross-org: a second org cannot see it
    const slugB = `tx-b-${runId}`
    expect((await api.post('/api/auth/organization/create', { data: { name: `Tx B ${runId}`, slug: slugB }, headers: { Origin: BASE } })).status()).toBe(200)
    const orgs = (await (await api.get('/api/auth/organization/list', { headers: { Origin: BASE } })).json()).map((o: any) => o.organization ?? o)
    const orgA = orgs.find((o: any) => o.slug !== slugB)
    const orgB = orgs.find((o: any) => o.slug === slugB)
    await api.post('/api/auth/organization/set-active', { data: { organizationId: orgB.id }, headers: { Origin: BASE } })
    expect((await api.get(`/api/call-transcripts/${created.id}`)).status(), 'cross-org GET → 404').toBe(404)
    expect((await api.delete(`/api/call-transcripts/${created.id}`)).status(), 'cross-org DELETE → 404').toBe(404)
    await api.post('/api/auth/organization/set-active', { data: { organizationId: orgA.id }, headers: { Origin: BASE } })

    expect((await api.delete(`/api/call-transcripts/${created.id}`)).status(), 'delete').toBe(204)
    expect((await api.get(`/api/call-transcripts/${created.id}`)).status(), 'gone').toBe(404)
  })

  test('3. AI runs: purpose + transcript rules; outcome run records purpose/transcriptId; contacts redacted in the snapshot', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { applicationId, candidateId } = await makeApplication(api, 'Run')
    const all = await steps(api, applicationId)
    const step5 = all.find(i => i.stepTemplate.stepNumber === 5)!
    const step6 = all.find(i => i.stepTemplate.stepNumber === 6)!

    // outcome without a transcript → 422; transcript on a non-outcome run → 422; bad purpose → 422
    expect((await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: { purpose: 'outcome' } })).status()).toBe(422)
    expect((await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: { purpose: 'prep', transcriptId: 'x' } })).status()).toBe(422)
    expect((await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: { purpose: 'nonsense' } })).status()).toBe(422)

    // transcript pinned to step 6 cannot be used on step 5
    const pinned = await (await api.post('/api/call-transcripts', { data: { text: TRANSCRIPT, consentNoted: true, stepInstanceId: step6.id } })).json()
    expect((await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: { purpose: 'outcome', transcriptId: pinned.id } })).status(), 'wrong step → 422').toBe(422)

    // the real thing on step 5
    const tx = await (await api.post('/api/call-transcripts', { data: { text: TRANSCRIPT, consentNoted: true, stepInstanceId: step5.id, candidateId } })).json()
    const genRes = await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: { purpose: 'outcome', transcriptId: tx.id }, timeout: 120_000 })
    expect(genRes.status(), 'outcome run').toBe(200)
    const run = await genRes.json()
    expect(['succeeded', 'failed']).toContain(run.status)
    expect(run.purpose).toBe('outcome')
    expect(run.transcriptId).toBe(tx.id)
    const snapshotText = JSON.stringify(run.inputSnapshot)
    expect(snapshotText, 'phone redacted').not.toContain('07700 900123')
    expect(snapshotText, 'email redacted').not.toContain('sam.example@example.com')
    expect(snapshotText).toContain('[redacted-contact]')
    expect(run.inputSnapshot.purpose).toBe('outcome')
    expect(run.inputSnapshot.candidate.doNotContact).toBe(false)
    if (run.provider === 'mock') {
      expect(run.output.parsed.contactOutcome).toBe('interested')
      expect(run.output.parsed.mobileMentioned).toBe(true)
    }

    // prep run on step 5 (no transcript) → 200; its input has no transcript
    const prepRes = await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: { purpose: 'prep' }, timeout: 120_000 })
    expect(prepRes.status(), 'prep run').toBe(200)
    const prep = await prepRes.json()
    expect(prep.purpose).toBe('prep')
    expect(prep.inputSnapshot.transcript).toBeNull()

    // step 6 outcome carries the candidate profile block
    const run6Res = await api.post(`/api/step-instances/${step6.id}/ai-runs`, { data: { purpose: 'outcome', transcriptId: pinned.id }, timeout: 120_000 })
    expect(run6Res.status()).toBe(200)
    const run6 = await run6Res.json()
    expect(run6.inputSnapshot.candidateProfile, 'step 6 gets the CV side').not.toBeNull()

    // deleting the transcript keeps the run (audit copy) with transcriptId nulled
    expect((await api.delete(`/api/call-transcripts/${tx.id}`)).status()).toBe(204)
    const runs = (await (await api.get(`/api/step-instances/${step5.id}/ai-runs`)).json()).runs
    const after = runs.find((r: any) => r.id === run.id)
    expect(after.transcriptId).toBeNull()
    expect(JSON.stringify(after.inputSnapshot)).toContain('[redacted-contact]')
  })

  test('4. stop rule: do-not-contact blocks the step 5 prep run (409) and shows in the input', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request
    const { applicationId, candidateId } = await makeApplication(api, 'Dnc')
    const step5 = (await steps(api, applicationId)).find(i => i.stepTemplate.stepNumber === 5)!

    // source is required when flagging
    const bad = await api.patch(`/api/candidates/${candidateId}`, { data: { doNotContact: true } })
    expect([400, 422]).toContain(bad.status())
    const ok = await api.patch(`/api/candidates/${candidateId}`, { data: { doNotContact: true, doNotContactSource: 'call', doNotContactNote: 'please stop calling' } })
    expect(ok.status()).toBe(200)
    const flagged = await ok.json()
    expect(flagged.doNotContact).toBe(true)
    expect(flagged.doNotContactAt).toBeTruthy()

    const blocked = await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: { purpose: 'prep' } })
    expect(blocked.status(), 'prep on a flagged person → 409').toBe(409)
    expect((await blocked.json()).data?.code).toBe('do_not_contact')

    // the flag shows on the list and the application
    const list = await (await api.get('/api/candidates', { params: { search: 'Dnc' } })).json()
    expect(list.data.find((c: any) => c.id === candidateId)?.doNotContact).toBe(true)
    const app = await (await api.get(`/api/applications/${applicationId}`)).json()
    expect(app.candidate.doNotContact).toBe(true)

    // clearing needs a note
    const clearBad = await api.patch(`/api/candidates/${candidateId}`, { data: { doNotContact: false } })
    expect([400, 422]).toContain(clearBad.status())
    const cleared = await (await api.patch(`/api/candidates/${candidateId}`, { data: { doNotContact: false, doNotContactNote: 'asked us to call again' } })).json()
    expect(cleared.doNotContact).toBe(false)
    expect(cleared.doNotContactAt).toBeNull()
    expect((await api.post(`/api/step-instances/${step5.id}/ai-runs`, { data: { purpose: 'prep' }, timeout: 120_000 })).status()).toBe(200)
  })

  test('5. use-in-step mapping (in-process, canned shapes): required fields filled, extras present, tasks extracted', async () => {
    const s5 = aiOutputToStepFields('candidate_contact', 'outcome', MOCK_OUTPUTS['candidate_contact:outcome'])
    expect(s5.contactOutcome).toBe('interested')
    expect(s5.noticePeriod).toBe('one month')
    expect(s5.personalMobile).toContain('type it in')
    expect(s5.valuesHeard).toContain('•')

    const s1 = aiOutputToStepFields('complete_job_order', 'outcome', MOCK_OUTPUTS['complete_job_order:outcome'])
    expect(s1.jobDescription).toBeTruthy()
    expect(s1.salaryRange).toBe('thirty to thirty-eight base')
    expect(s1.jobOrderGaps).toContain('fee_terms')
    expect(s1.suggestedTag).toContain('chase_qualify')

    const s6 = aiOutputToStepFields('candidate_profile', 'outcome', MOCK_OUTPUTS['candidate_profile:outcome'])
    expect(s6.profileSummary).toBeTruthy()
    expect(s6.reconciliation).toContain('position')

    const s11 = aiOutputToStepFields('candidate_debrief', 'outcome', MOCK_OUTPUTS['candidate_debrief:outcome'])
    expect(s11.debriefNotes).toContain('Interest:')

    // prep / assist runs never map to fields
    expect(Object.keys(aiOutputToStepFields('candidate_contact', 'prep', MOCK_OUTPUTS['candidate_contact:prep']))).toHaveLength(0)
    expect(Object.keys(aiOutputToStepFields('candidate_contact', 'outcome', null))).toHaveLength(0)

    const t1 = aiOutputToTasks('complete_job_order', 'outcome', MOCK_OUTPUTS['complete_job_order:outcome'])
    expect(t1.length).toBe(2)
    expect(t1[0]!.title).toContain('fee')
    const t11 = aiOutputToTasks('candidate_debrief', 'outcome', MOCK_OUTPUTS['candidate_debrief:outcome'])
    expect(t11.length).toBeGreaterThan(0)
    expect(aiOutputToTasks('candidate_contact', 'prep', MOCK_OUTPUTS['candidate_contact:prep'])).toHaveLength(0)
  })
})
