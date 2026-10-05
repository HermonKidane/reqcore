import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { candidate, candidateEducation, candidateExperience, candidateSkill, extensionCaptureEvent, job } from '../../../database/schema'
import { extensionCaptureSchema } from '../../../utils/schemas/extension'
import { authenticateExtensionKey } from '../../../utils/extensionKey'
import { parseProfileText, type ProfileParseResult } from '../../../utils/ai/profileParse'

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
 *
 * C2 (AI page parsing, design §10):
 * - optional pageText (+pageUrl) is parsed with the org's BYOK AI config
 *   BEFORE the transaction (never on an idempotent replay); extension-sent
 *   fields win, AI fills the gaps (names, location, company, position,
 *   experiences); pageText is never stored
 * - X-Capture-Mode: preview = read-only dry run: validation + parsing +
 *   duplicate lookup, no writes, no Idempotency-Key required
 */

const extensionCaptureLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  message: 'Extension capture rate limit exceeded',
})

const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{1,128}$/
const MAX_PHOTO_BYTES = 2 * 1024 * 1024 // 2 MB
/** C2: pageText above this size is rejected with 413 before any parsing. */
const MAX_PAGE_TEXT_CHARS = 200_000

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

// ─────────────────────────────────────────────
// C2: AI page parsing (design §10) + duplicate lookup shared by the
// capture and preview code paths
// ─────────────────────────────────────────────

/**
 * Minimal structural type for the duplicate lookup (same shape as the
 * Executor in candidateEmail.ts). tx/db don't assign cleanly to it
 * (conditional-generic execute<> signature — same pre-existing TS wart as
 * below), so call sites cast.
 */
interface DupExecutor {
  execute: <T = unknown>(query: SQL) => Promise<T[]>
}

/**
 * Org-scoped duplicate detection: normalized email first, then normalized
 * LinkedIn URL. Shared by the capture transaction and the read-only
 * preview path. Reads via the passed executor so the capture path keeps
 * running INSIDE its transaction.
 */
async function findDuplicateCandidate(
  executor: DupExecutor,
  organizationId: string,
  body: { email?: string | undefined, linkedinUrl?: string | undefined },
): Promise<{ candidateId: string, matchedBy: 'email' | 'linkedin' } | null> {
  if (body.email) {
    const id = await findCandidateIdByEmail(executor, organizationId, body.email)
    if (id) return { candidateId: id, matchedBy: 'email' }
  }

  if (body.linkedinUrl) {
    const wanted = normalizeLinkedinUrl(body.linkedinUrl)
    // Same normalization as normalizeLinkedinUrl(), done in SQL so we
    // never pull every candidate's URL into memory
    const rows = await executor.execute<{ id: string }>(sql`
      SELECT id FROM candidate
      WHERE organization_id = ${organizationId}
        AND linkedin_url IS NOT NULL
        AND rtrim(split_part(split_part(
              regexp_replace(regexp_replace(lower(btrim(linkedin_url)), '^https?://', ''), '^www[.]', ''),
              '?', 1), '#', 1), '/') = ${wanted}
      LIMIT 1
    `)
    if (rows[0]) {
      return { candidateId: rows[0].id, matchedBy: 'linkedin' }
    }
  }

  return null
}

interface MergedCapture {
  firstName?: string | undefined
  lastName?: string | undefined
  email?: string | undefined
  phone?: string | undefined
  linkedinUrl?: string | undefined
  company?: string | undefined
  position?: string | undefined
  headline?: string | undefined
  summary?: string | undefined
  location?: string | undefined
  experiences?: ProfileParseResult['experiences']
  education?: ProfileParseResult['education']
  skills?: string[]
}

/** Same email rule as extensionCaptureSchema's body email. */
const captureEmailRule = z.string().trim().max(320).email()

/**
 * Merge rule (design §10): fields the extension sent explicitly WIN
 * (name from the page title, linkedinUrl, photo); the AI parse fills
 * everything missing — location, company, position, headline, summary,
 * education, skills, and the names when absent. `position` falls back to
 * the profile headline.
 *
 * C2.1: the AI email is merged only when it passes the SAME email rule as
 * the body — an invalid AI email is dropped, never stored or matched on.
 */
function mergeCaptureFields(
  body: ReturnType<typeof extensionCaptureSchema.parse>,
  parsed: ProfileParseResult | null,
): MergedCapture {
  const merged: MergedCapture = {
    ...body,
    firstName: body.firstName ?? parsed?.firstName,
    lastName: body.lastName ?? parsed?.lastName,
    company: body.company ?? parsed?.company,
    position: body.position ?? parsed?.position ?? parsed?.headline,
    headline: body.headline ?? parsed?.headline,
    summary: body.summary ?? parsed?.summary,
    location: body.location ?? parsed?.location,
    experiences: body.experiences?.length ? body.experiences : parsed?.experiences,
    education: body.education?.length ? body.education : parsed?.education,
    skills: body.skills?.length ? body.skills : parsed?.skills,
  }
  if (merged.email && !captureEmailRule.safeParse(merged.email).success) {
    console.error('[Reqcore] AI-provided capture email failed validation — dropped')
    merged.email = undefined
  }
  return merged
}

/** Skills deduped by normalizedName (lower+trim), blanks skipped. */
function dedupeSkills(skills: string[]): Array<{ name: string, normalizedName: string }> {
  const seen = new Set<string>()
  const out: Array<{ name: string, normalizedName: string }> = []
  for (const raw of skills) {
    const name = raw.trim()
    if (!name) continue
    const normalizedName = name.toLowerCase()
    if (seen.has(normalizedName)) continue
    seen.add(normalizedName)
    out.push({ name, normalizedName })
  }
  return out
}

/** What the popup shows before saving: merged fields, photo excluded. */
function buildPreview(merged: MergedCapture) {
  return {
    firstName: merged.firstName ?? null,
    lastName: merged.lastName ?? null,
    email: merged.email ?? null,
    phone: merged.phone ?? null,
    linkedinUrl: merged.linkedinUrl ?? null,
    company: merged.company ?? null,
    position: merged.position ?? null,
    headline: merged.headline ?? null,
    // first 300 chars is enough for the popup to confirm the About text
    summary: merged.summary ? merged.summary.slice(0, 300) : null,
    location: merged.location ?? null,
    experiences: merged.experiences ?? [],
    education: merged.education ?? [],
    skills: merged.skills ?? [],
  }
}

export default defineEventHandler(async (event) => {
  const { keyId, organizationId, userId } = await authenticateExtensionKey(event)

  // Per-key rate limit (60 req/min) — keyed by credential, not IP
  await extensionCaptureLimiter(event, keyId)

  // Preview is read-only, so it is the one mode that needs no Idempotency-Key
  const isPreview = getHeader(event, 'x-capture-mode') === 'preview'
  const idempotencyKey = getHeader(event, 'idempotency-key') ?? ''
  if (!isPreview && !idempotencyKeyPattern.test(idempotencyKey)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Idempotency-Key header required (1-128 chars, [A-Za-z0-9._:-])',
    })
  }

  const body = await readBody422(event, extensionCaptureSchema)

  if (body.pageText && body.pageText.length > MAX_PAGE_TEXT_CHARS) {
    throw createError({ statusCode: 413, statusMessage: 'Page text exceeds the 200 KB limit' })
  }

  // ── C2 preview mode (read-only): auth + rate limit + validation + AI
  //    parsing + duplicate lookup. NOTHING is written, and no
  //    Idempotency-Key is required. Lets the popup show the recruiter what
  //    the AI read before they hit Save (design §10, guardrail 11).
  if (isPreview) {
    const parsedProfile = body.pageText
      ? await parseProfileText({ pageText: body.pageText, pageUrl: body.pageUrl })
      : null
    const merged = mergeCaptureFields(body, parsedProfile)
    if (!merged.firstName || !merged.lastName) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Could not read this page — open a single profile page and try again',
      })
    }
    // C2.1: duplicate lookup on the MERGED values — an AI-read email/URL
    // must find the existing record too (body-only lookup missed it).
    const duplicate = await findDuplicateCandidate(
      db as unknown as DupExecutor,
      organizationId,
      { email: merged.email, linkedinUrl: merged.linkedinUrl },
    )
    return { preview: buildPreview(merged), parsed: parsedProfile !== null, duplicate }
  }

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
      parsed: false,
      preview: null,
    }
  }

  // ── AI page parsing (C2) — BEFORE the transaction, only when pageText is
  //    present and this is not an idempotent replay (a replay must not pay
  //    for another provider call; the stored result wins above).
  //    pageText is NEVER stored — it lives only in this request.
  const parsedProfile = body.pageText
    ? await parseProfileText({ pageText: body.pageText, pageUrl: body.pageUrl })
    : null

  // Merge rule: extension-sent fields win, AI fills the gaps (see helper).
  const merged = mergeCaptureFields(body, parsedProfile)

  if (!merged.firstName || !merged.lastName) {
    // Parsing failed (or returned nothing usable) and the extension didn't
    // send names either — nothing to create the candidate from.
    throw createError({
      statusCode: 422,
      statusMessage: 'Could not read this page — open a single profile page and try again',
    })
  }
  // The guard above guarantees both names; locals keep the transaction
  // closures free of undefined-check noise.
  const captureFirstName = merged.firstName
  const captureLastName = merged.lastName

  // ── Candidate write + capture-event row in ONE transaction ───────────────
  // NOTE: use tx.select()/tx.execute() inside transactions — tx.query.* hangs
  // with postgres-js (known Drizzle gotcha).
  type CaptureResult = {
    candidateId: string
    outcome: 'created' | 'updated' | 'duplicate_skipped'
    matchedBy: 'email' | 'linkedin' | null
    photoKey: string | null
    previousPhotoKey: string | null
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
      // (shared with the read-only preview path). C2.1: on the MERGED
      // values, so an AI-read email matches an existing candidate too.
      const dup = await findDuplicateCandidate(
        tx as unknown as DupExecutor,
        organizationId,
        { email: merged.email, linkedinUrl: merged.linkedinUrl },
      )
      const matchedId = dup?.candidateId ?? null
      const matchedBy = dup?.matchedBy ?? null

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
            previousPhotoKey: null,
            created: false,
            candidateName: null,
          }
        }

        // update — only overwrite provided, non-empty fields (never blank out)
        await tx.execute(sql`SELECT id FROM candidate WHERE id = ${matchedId} FOR UPDATE`)

        const updatePayload: Record<string, unknown> = { updatedAt: new Date() }
        if (merged.firstName?.trim()) updatePayload.firstName = merged.firstName.trim()
        if (merged.lastName?.trim()) updatePayload.lastName = merged.lastName.trim()
        if (body.phone?.trim()) updatePayload.phone = body.phone.trim()
        if (body.linkedinUrl?.trim()) updatePayload.linkedinUrl = body.linkedinUrl.trim()
        if (merged.company?.trim()) updatePayload.company = merged.company.trim()
        if (merged.position?.trim()) updatePayload.position = merged.position.trim()
        // C2.1: headline/summary only when provided non-empty (never blank out)
        if (merged.headline?.trim()) updatePayload.headline = merged.headline.trim()
        if (merged.summary?.trim()) updatePayload.summary = merged.summary.trim()
        // location: only overwrite when provided non-empty (never blank out)
        if (merged.location?.trim()) updatePayload.location = merged.location.trim()

        // Work history: when provided non-empty, replace the candidate's
        // 'capture'-sourced rows wholesale (fresh scrape wins); 'manual' /
        // 'import' rows are never touched.
        if (merged.experiences?.length) {
          await tx.delete(candidateExperience)
            .where(and(
              eq(candidateExperience.candidateId, matchedId),
              eq(candidateExperience.organizationId, organizationId),
              eq(candidateExperience.source, 'capture'),
            ))
          await tx.insert(candidateExperience).values(
            merged.experiences.map((exp, index) => ({
              organizationId,
              candidateId: matchedId,
              title: exp.title.trim(),
              company: exp.company?.trim() || null,
              location: exp.location?.trim() || null,
              startText: exp.startText?.trim() || null,
              endText: exp.endText?.trim() || null,
              isCurrent: exp.isCurrent ?? false,
              description: exp.description?.trim() || null,
              sortOrder: index,
              source: 'capture',
            })),
          )
        }

        // C2.1 Education: same replace-when-non-empty semantics as
        // experiences — 'manual' / 'import' rows are never touched.
        if (merged.education?.length) {
          await tx.delete(candidateEducation)
            .where(and(
              eq(candidateEducation.candidateId, matchedId),
              eq(candidateEducation.organizationId, organizationId),
              eq(candidateEducation.source, 'capture'),
            ))
          await tx.insert(candidateEducation).values(
            merged.education.map((edu, index) => ({
              organizationId,
              candidateId: matchedId,
              school: edu.school.trim(),
              degree: edu.degree?.trim() || null,
              fieldOfStudy: edu.fieldOfStudy?.trim() || null,
              startText: edu.startText?.trim() || null,
              endText: edu.endText?.trim() || null,
              description: edu.description?.trim() || null,
              sortOrder: index,
              source: 'capture',
            })),
          )
        }

        // C2.1 Skills: ADDITIVE only — insert the ones not already stored,
        // never delete (manual skills survive a re-capture).
        if (merged.skills?.length) {
          const wanted = dedupeSkills(merged.skills)
          if (wanted.length) {
            const existing = await tx.select({ normalizedName: candidateSkill.normalizedName })
              .from(candidateSkill)
              .where(and(
                eq(candidateSkill.candidateId, matchedId),
                eq(candidateSkill.organizationId, organizationId),
              ))
            const existingNames = new Set(existing.map((row) => row.normalizedName))
            const missing = wanted.filter((skill) => !existingNames.has(skill.normalizedName))
            if (missing.length) {
              await tx.insert(candidateSkill).values(
                missing.map((skill) => ({
                  organizationId,
                  candidateId: matchedId,
                  name: skill.name,
                  normalizedName: skill.normalizedName,
                  source: 'capture',
                })),
              )
            }
          }
        }

        let photoKey: string | null = null
        let previousPhotoKey: string | null = null
        if (photo) {
          const [prev] = await tx.select({ photoKey: candidate.photoKey })
            .from(candidate)
            .where(eq(candidate.id, matchedId))
          previousPhotoKey = prev?.photoKey ?? null
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
        // candidate is left alone (never break uniqueness). C2.1: the merged
        // email (body wins, AI fills) — already validated in mergeCaptureFields.
        if (merged.email) {
          const [current] = await tx.select({ email: candidate.email })
            .from(candidate)
            .where(eq(candidate.id, matchedId))
          const owner = await findCandidateIdByEmail(emailTx, organizationId, merged.email)
          if (!current?.email && owner === null) {
            await insertPrimaryEmail(emailTx, organizationId, matchedId, merged.email.trim(), {
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
          previousPhotoKey,
          created: false,
          candidateName: [merged.firstName?.trim(), merged.lastName?.trim()].filter(Boolean).join(' ') || null,
        }
      }

      // create — mirror server/api/candidates/index.post.ts (cache starts NULL)
      const [created] = await tx.insert(candidate).values({
        organizationId,
        firstName: captureFirstName,
        lastName: captureLastName,
        email: null,
        phone: body.phone?.trim() || null,
        linkedinUrl: body.linkedinUrl?.trim() || null,
        company: body.company?.trim() || null,
        position: body.position?.trim() || null,
        // C2.1 richer capture (merged: body wins, AI fills)
        headline: merged.headline?.trim() || null,
        summary: merged.summary?.trim() || null,
        location: body.location?.trim() || null,
        source: body.source,
        sourceDetail: body.sourceDetail?.trim() || null,
      }).returning({ id: candidate.id })

      if (!created) {
        throw createError({ statusCode: 500, statusMessage: 'Failed to create candidate' })
      }

      // C2.1: merged email (body wins, AI fills — validated in mergeCaptureFields)
      if (merged.email) {
        await insertPrimaryEmail(emailTx, organizationId, created.id, merged.email.trim(), {
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

      // Work history from the scrape (source 'capture', array order = display order)
      if (merged.experiences?.length) {
        await tx.insert(candidateExperience).values(
          merged.experiences.map((exp, index) => ({
            organizationId,
            candidateId: created.id,
            title: exp.title.trim(),
            company: exp.company?.trim() || null,
            location: exp.location?.trim() || null,
            startText: exp.startText?.trim() || null,
            endText: exp.endText?.trim() || null,
            isCurrent: exp.isCurrent ?? false,
            description: exp.description?.trim() || null,
            sortOrder: index,
            source: 'capture',
          })),
        )
      }

      // C2.1 Education from the scrape (array order = display order)
      if (merged.education?.length) {
        await tx.insert(candidateEducation).values(
          merged.education.map((edu, index) => ({
            organizationId,
            candidateId: created.id,
            school: edu.school.trim(),
            degree: edu.degree?.trim() || null,
            fieldOfStudy: edu.fieldOfStudy?.trim() || null,
            startText: edu.startText?.trim() || null,
            endText: edu.endText?.trim() || null,
            description: edu.description?.trim() || null,
            sortOrder: index,
            source: 'capture',
          })),
        )
      }

      // C2.1 Skills (deduped by normalizedName, blanks skipped)
      if (merged.skills?.length) {
        const skills = dedupeSkills(merged.skills)
        if (skills.length) {
          await tx.insert(candidateSkill).values(
            skills.map((skill) => ({
              organizationId,
              candidateId: created.id,
              name: skill.name,
              normalizedName: skill.normalizedName,
              source: 'capture',
            })),
          )
        }
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
        previousPhotoKey: null,
        created: true,
        candidateName: `${captureFirstName} ${captureLastName}`,
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
          parsed: false,
          preview: null,
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
      // Best-effort: remove the replaced photo only once the new one is stored
      if (result.previousPhotoKey && result.previousPhotoKey !== result.photoKey) {
        await deleteFromS3(result.previousPhotoKey).catch((err) => {
          console.error('[Reqcore] Old candidate photo cleanup failed:', err)
        })
      }
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
    parsed: parsedProfile !== null,
    preview: buildPreview(merged),
  }
})
