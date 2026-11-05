import { eq, and } from 'drizzle-orm'
import { callTranscript, candidate, job, application, recruitmentStepInstance } from '../../database/schema'
import { createCallTranscriptSchema } from '../../utils/schemas/callTranscript'

/**
 * POST /api/call-transcripts — workflow:update (Session W slice 1, plumbing P1)
 *
 * Saves a pasted call transcript so an AI run (`purpose: 'outcome'`) can read
 * it. Every linked id is checked against the caller's org (404 on mismatch —
 * never reveal rows from another tenant). The text is stored as pasted; the
 * sanitiser redacts contact details when it is rendered into a prompt.
 *
 * The response echoes everything except the text (fetch it by id).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { workflow: ['update'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const body = await readBody422(event, createCallTranscriptSchema)

  const checks: Promise<unknown>[] = []
  if (body.candidateId) {
    checks.push(db.query.candidate.findFirst({
      where: and(eq(candidate.id, body.candidateId), eq(candidate.organizationId, orgId)),
      columns: { id: true },
    }).then(r => r ?? Promise.reject(createError({ statusCode: 404, statusMessage: 'Candidate not found' }))))
  }
  if (body.jobId) {
    checks.push(db.query.job.findFirst({
      where: and(eq(job.id, body.jobId), eq(job.organizationId, orgId)),
      columns: { id: true },
    }).then(r => r ?? Promise.reject(createError({ statusCode: 404, statusMessage: 'Job not found' }))))
  }
  if (body.applicationId) {
    checks.push(db.query.application.findFirst({
      where: and(eq(application.id, body.applicationId), eq(application.organizationId, orgId)),
      columns: { id: true },
    }).then(r => r ?? Promise.reject(createError({ statusCode: 404, statusMessage: 'Application not found' }))))
  }
  if (body.stepInstanceId) {
    checks.push(db.query.recruitmentStepInstance.findFirst({
      where: eq(recruitmentStepInstance.id, body.stepInstanceId),
      with: { workflow: { columns: { organizationId: true } } },
    }).then(r => (r && r.workflow.organizationId === orgId)
      ? r
      : Promise.reject(createError({ statusCode: 404, statusMessage: 'Step not found' }))))
  }
  await Promise.all(checks)

  const [row] = await db.insert(callTranscript).values({
    organizationId: orgId,
    candidateId: body.candidateId ?? null,
    jobId: body.jobId ?? null,
    applicationId: body.applicationId ?? null,
    stepInstanceId: body.stepInstanceId ?? null,
    source: body.source,
    text: body.text,
    charCount: body.text.length,
    recordedAt: body.recordedAt ?? null,
    durationSeconds: body.durationSeconds ?? null,
    consentNoted: body.consentNoted,
    createdById: userId,
  }).returning()
  if (!row) throw createError({ statusCode: 500, statusMessage: 'Failed to save transcript' })

  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'created',
    resourceType: 'call_transcript',
    resourceId: row.id,
    metadata: { charCount: row.charCount, stepInstanceId: row.stepInstanceId, candidateId: row.candidateId },
  }).catch(() => {})

  setResponseStatus(event, 201)
  const { text: _text, ...rest } = row
  return rest
})
