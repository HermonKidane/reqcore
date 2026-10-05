import { and, desc, eq, sql } from 'drizzle-orm'
import { candidate, extensionCaptureEvent, job } from '../../../database/schema'
import { extensionCaptureSchema } from '../../../utils/schemas/extension'
import { authenticateExtensionKey } from '../../../utils/extensionKey'

/**
 * POST /api/extension/capture
 *
 * Secured ingestion boundary for the Save-to-ATS browser extension
 * (BUILD-PLAN §2.1 guardrail 13):
 * - per-user API key auth (bearer over TLS; server stores only the SHA-256 hash)
 * - per-key rate limit (60 req/min)
 * - required Idempotency-Key header + (apiKeyId, idempotencyKey) unique row =
 *   replay protection; concurrent duplicate → stored result returned
 * - org-scoped duplicate detection (normalized email, then normalized LinkedIn URL)
 *   with the CSV-import duplicatePolicy semantics (skip/update)
 * - candidate writes reuse the candidate_email single code path (invariants I1–I3)
 * - photo stored in S3/MinIO AFTER the DB transaction commits; a failed upload
 *   never fails the capture (response carries photoStored: false)
 * - no CORS headers: MV3 extensions with host permissions don't need them
 */

const extensionCaptureLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  message: 'Extension capture rate limit exceeded',
})

const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{1,128}$/
const MAX_PHOTO_BYTES = 2 * 1024 * 1024 // 2 MB

const PHOTO_MAGIC: Record<string, { bytes: number[]; ext: string }> = {
  'image/jpeg': { bytes: [0xff, 0xd8, 0xff], ext: 'jpg' },
  'image/png': { bytes: [0x89, 0x50, 0x4e, 0x47], ext: 'png' },
  'image/webp': { bytes: [0x52, 0x49, 0x46, 0x46], ext: 'webp' }, // "RIFF"; "WEBP" at offset 8 checked below
}

/** lowercase, strip protocol / leading www. / query / fragment / trailing slash */
function normalizeLinkedinUrl(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('?')[0]!
    .split('#')[0]!
    .replace(/\/+$/, '')
}

interface DecodedPhoto {
  contentType: string
  buffer: Buffer
  ext: string
}

async function getOpenJobs(orgId: string): Promise<Array<{ id: string; title: string }>> {
  return db
    .select({ id: job.id, title: job.title })
    .from(job)
    .where(and(eq(job.organizationId, orgId), eq(job.status, 'open')))
    .orderBy(desc(job.createdAt))
    .limit(50)
}

export default defineEventHandler(async (event) => {
  const { keyId, organizationId, userId } = await authenticateExtensionKey(event)

  // Per-key rate limit (60 req/min) — keyed by credential, not IP
  await extensionCaptureLimiter(event, keyId)

  const idempotencyKey = getHeader(event, 'idempotency-key')
  if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Idempotency-Key header required (1-128 chars, [A-Za-z0-9._:-])',
    })
  }

  const body = await readBody422(event, extensionCaptureSchema)

  // ── Photo: decode + validate BEFORE any DB work (413/422 fast-fail) ──────
  let photo: DecodedPhoto | null = null
  if (body.photo) {
    if (!/^[A-Za-z0-9+/=\s]+$/.test(body.photo.dataBase64)) {
      throw createError({ statusCode: 422, statusMessage: 'Validation failed: photo.dataBase64: invalid base64' })
    }
    const buffer = Buffer.from(body.photo.dataBase64.replace(/\s/g, ''), 'base64')
    if (buffer.length === 0) {
      throw createError({ statusCode: 422, statusMessage: 'Validation failed: photo.dataBase64: decodes to empty data' })
    }
    if (buffer.length > MAX_PHOTO_BYTES) {
      throw createError({ statusCode: 413, statusMessage: 'Photo exceeds the 2 MB limit' })
    }
    const magic = PHOTO_MAGIC[body.photo.contentType]!
    const matchesMagic = magic.bytes.every((b, i) => buffer[i] === b)
      && (body.photo.contentType !== 'image/webp'
        || buffer.subarray(8, 12).toString('latin1') === 'WEBP')
    if (!matchesMagic) {
      throw createError({
        statusCode: 422,
        statusMessage: `Validation failed: photo content does not match ${body.photo.contentType}`,
      })
    }
    photo = { contentType: body.photo.contentType, buffer, ext: magic.ext }
  }

  // ── Idempotent replay: stored result wins, nothing else happens ──────────
  const [existingEvent] = await db
    .select({
      candidateId: extensionCaptureEvent.candidateId,
      outcome: extensionCaptureEvent.outcome,
      matchedBy: extensionCaptureEvent.matchedBy,
    })
    .from(extensionCaptureEvent)
    .where(and(
      eq(extensionCaptureEvent.apiKeyId, keyId),
      eq(extensionCaptureEvent.idempotencyKey, idempotencyKey),
    ))
    .limit(1)

  if (existingEvent) {
    return {
      candidateId: existingEvent.candidateId,
      outcome: existingEvent.outcome,
      matchedBy: existingEvent.matchedBy,
      replayed: true,
      photoStored: null,
      openJobs: await getOpenJobs(organizationId),
    }
  }

  // ── Candidate write + capture-event row in ONE transaction ───────────────
  // NOTE: use tx.select()/tx.execute() inside transactions — tx.query.* hangs
  // with postgres-js (known Drizzle gotcha).
  type CaptureResult = {
    candidateId: string
    outcome: 'created' | 'updated' | 'duplicate_skipped'
    matchedBy: 'email' | 'linkedin' | null
    photoKey: string | null
    created: boolean
    candidateName: string | null
  }

  let result: CaptureResult

  try {
    result = await db.transaction(async (tx) => {
      // Drizzle's PgTransaction is structurally what the email helpers want,
      // but its conditional execute<> signature won't assign to their
      // Executor type (same pre-existing TS wart as candidates/index.post.ts).
      const emailTx = tx as unknown as Parameters<typeof findCandidateIdByEmail>[0]

      // Duplicate detection, org-scoped: email first, then LinkedIn URL
      let matchedId: string | null = null
      let matchedBy: 'email' | 'linkedin' | null = null

      if (body.email) {
        matchedId = await findCandidateIdByEmail(emailTx, organizationId, body.email)
        if (matchedId) matchedBy = 'email'
      }

      if (!matchedId && body.linkedinUrl) {
        const wanted = normalizeLinkedinUrl(body.linkedinUrl)
        // Same normalization as normalizeLinkedinUrl(), done in SQL so we
        // never pull every candidate's URL into memory
        const rows = await tx.execute<{ id: string }>(sql`
          SELECT id FROM candidate
          WHERE organization_id = ${organizationId}
            AND linkedin_url IS NOT NULL
            AND rtrim(split_part(split_part(
                  regexp_replace(regexp_replace(lower(btrim(linkedin_url)), '^https?://', ''), '^www[.]', ''),
                  '?', 1), '#', 1), '/') = ${wanted}
          LIMIT 1
        `)
        if (rows[0]) {
          matchedId = rows[0].id
          matchedBy = 'linkedin'
        }
      }

      if (matchedId) {
        if (body.duplicatePolicy === 'skip') {
          await tx.insert(extensionCaptureEvent).values({
            organizationId,
            apiKeyId: keyId,
            idempotencyKey,
            candidateId: matchedId,
            outcome: 'duplicate_skipped',
            matchedBy,
          })
          return {
            candidateId: matchedId,
            outcome: 'duplicate_skipped' as const,
            matchedBy,
            photoKey: null,
            created: false,
            candidateName: null,
          }
        }

        // update — only overwrite provided, non-empty fields (never blank out)
        await tx.execute(sql`SELECT id FROM candidate WHERE id = ${matchedId} FOR UPDATE`)

        const updatePayload: Record<string, unknown> = { updatedAt: new Date() }
        if (body.firstName?.trim()) updatePayload.firstName = body.firstName.trim()
        if (body.lastName?.trim()) updatePayload.lastName = body.lastName.trim()
        if (body.phone?.trim()) updatePayload.phone = body.phone.trim()
        if (body.linkedinUrl?.trim()) updatePayload.linkedinUrl = body.linkedinUrl.trim()
        if (body.company?.trim()) updatePayload.company = body.company.trim()
        if (body.position?.trim()) updatePayload.position = body.position.trim()

        let photoKey: string | null = null
        if (photo) {
          photoKey = `candidate-photos/${organizationId}/${matchedId}/${Date.now()}.${photo.ext}`
          updatePayload.photoKey = photoKey
          updatePayload.photoUpdatedAt = new Date()
        }

        await tx.update(candidate)
          .set(updatePayload)
          .where(eq(candidate.id, matchedId))

        // Email via the single email code path (invariants I1–I3). Only fills
        // a MISSING email — an existing primary is never overwritten (no
        // secondary-email API yet), and an email owned by a different
        // candidate is left alone (never break uniqueness).
        if (body.email) {
          const [current] = await tx.select({ email: candidate.email })
            .from(candidate)
            .where(eq(candidate.id, matchedId))
          const owner = await findCandidateIdByEmail(emailTx, organizationId, body.email)
          if (!current?.email && owner === null) {
            await insertPrimaryEmail(emailTx, organizationId, matchedId, body.email.trim(), {
              source: 'extension',
              sourceDetail: { platform: body.source, sourceDetail: body.sourceDetail ?? null },
            })
          }
        }

        await tx.insert(extensionCaptureEvent).values({
          organizationId,
          apiKeyId: keyId,
          idempotencyKey,
          candidateId: matchedId,
          outcome: 'updated',
          matchedBy,
        })

        return {
          candidateId: matchedId,
          outcome: 'updated' as const,
          matchedBy,
          photoKey,
          created: false,
          candidateName: [body.firstName?.trim(), body.lastName?.trim()].filter(Boolean).join(' ') || null,
        }
      }

      // create — mirror server/api/candidates/index.post.ts (cache starts NULL)
      const [created] = await tx.insert(candidate).values({
        organizationId,
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        email: null,
        phone: body.phone?.trim() || null,
        linkedinUrl: body.linkedinUrl?.trim() || null,
        company: body.company?.trim() || null,
        position: body.position?.trim() || null,
        source: body.source,
        sourceDetail: body.sourceDetail?.trim() || null,
      }).returning({ id: candidate.id })

      if (!created) {
        throw createError({ statusCode: 500, statusMessage: 'Failed to create candidate' })
      }

      if (body.email) {
        await insertPrimaryEmail(emailTx, organizationId, created.id, body.email.trim(), {
          source: 'extension',
          sourceDetail: { platform: body.source, sourceDetail: body.sourceDetail ?? null },
        })
      }

      let photoKey: string | null = null
      if (photo) {
        photoKey = `candidate-photos/${organizationId}/${created.id}/${Date.now()}.${photo.ext}`
        await tx.update(candidate)
          .set({ photoKey, photoUpdatedAt: new Date() })
          .where(eq(candidate.id, created.id))
      }

      await tx.insert(extensionCaptureEvent).values({
        organizationId,
        apiKeyId: keyId,
        idempotencyKey,
        candidateId: created.id,
        outcome: 'created',
        matchedBy: null,
      })

      return {
        candidateId: created.id,
        outcome: 'created' as const,
        matchedBy: null,
        photoKey,
        created: true,
        candidateName: `${body.firstName.trim()} ${body.lastName.trim()}`,
      }
    })
  }
  catch (err) {
    // Concurrent duplicate idempotency key: the other request committed the
    // event row first — return the stored result instead of erroring.
    if (isUniqueViolation(err)) {
      const [stored] = await db
        .select({
          candidateId: extensionCaptureEvent.candidateId,
          outcome: extensionCaptureEvent.outcome,
          matchedBy: extensionCaptureEvent.matchedBy,
        })
        .from(extensionCaptureEvent)
        .where(and(
          eq(extensionCaptureEvent.apiKeyId, keyId),
          eq(extensionCaptureEvent.idempotencyKey, idempotencyKey),
        ))
        .limit(1)

      if (stored) {
        return {
          candidateId: stored.candidateId,
          outcome: stored.outcome,
          matchedBy: stored.matchedBy,
          replayed: true,
          photoStored: null,
          openJobs: await getOpenJobs(organizationId),
        }
      }
      // A raced candidate_email unique violation without a stored event:
      // same contract as the manual-create endpoint.
      throw createError({
        statusCode: 409,
        statusMessage: 'A candidate with this email already exists',
      })
    }
    throw err
  }

  // ── Photo upload AFTER the transaction commits (non-fatal on failure) ────
  let photoStored = false
  if (photo && result.photoKey) {
    try {
      await uploadToS3(result.photoKey, photo.buffer, photo.contentType)
      photoStored = true
    }
    catch (err) {
      // Capture already succeeded — the candidate row references the key but
      // the object is missing; the client sees photoStored: false.
      console.error('[Reqcore] Extension photo upload failed:', err)
    }
  }

  if (result.outcome !== 'duplicate_skipped') {
    recordActivity({
      organizationId,
      actorId: userId,
      action: result.outcome === 'created' ? 'created' : 'updated',
      resourceType: 'candidate',
      resourceId: result.candidateId,
      metadata: {
        ...(result.candidateName ? { name: result.candidateName } : {}),
        via: 'extension_capture',
        source: body.source,
      },
    })
  }

  setResponseStatus(event, result.created ? 201 : 200)
  return {
    candidateId: result.candidateId,
    outcome: result.outcome,
    matchedBy: result.matchedBy,
    replayed: false,
    photoStored,
    openJobs: await getOpenJobs(organizationId),
  }
})
