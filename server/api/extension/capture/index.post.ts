import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { application, candidate, candidateEducation, candidateExperience, candidateSkill, clientCompany, comment, extensionCaptureEvent, job, personRole } from '../../../database/schema'
import { extensionCaptureSchema } from '../../../utils/schemas/extension'
import { authenticateExtensionKey, extensionRoleAllows } from '../../../utils/extensionKey'
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
 *
 * C2.2 (capture actions): the Save-to-ATS popup can send three extras —
 * `note` (→ comment on the candidate), `jobIds` (→ applications, status
 * 'new'), and `captureAs: 'contact'` (→ active client_contact role at a
 * client company, find-or-create by normalized name). They apply in ALL
 * THREE outcomes, including duplicate_skipped ("already in ATS → still add
 * note / jobs / contact role"); candidate fields stay untouched on skip.
 * Job ids are validated as open BEFORE the AI parse; the contact company
 * name (contactCompany ?? merged company) is required before the
 * transaction; both need comment/application create permission. One AI
 * call per capture: Save reuses Preview's result via the merged fields.
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
    email: body.email ?? parsed?.email,
    phone: body.phone ?? parsed?.phone,
    company: body.company ?? parsed?.company,
    position: body.position ?? parsed?.position ?? parsed?.headline,
    headline: body.headline ?? parsed?.headline,
    summary: body.summary ?? parsed?.summary,
    location: body.location ?? parsed?.location,
    experiences: body.experiences?.length ? body.experiences : parsed?.experiences,
    education: body.education?.length ? body.education : parsed?.education,
    skills: body.skills?.length ? body.skills : parsed?.skills,
  }
  // Pages decorate phones with emoji/icons ("📞+1 323…") — keep phone chars only
  if (merged.phone) {
    merged.phone = merged.phone.replace(/[^\d+()\-.\s]/g, '').replace(/\s+/g, ' ').trim() || undefined
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

/** What the popup shows before saving: merged fields, photo excluded.
 * C2.2: the FULL summary — the popup sends Preview's fields back on Save. */
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
    summary: merged.summary ?? null,
    location: merged.location ?? null,
    experiences: merged.experiences ?? [],
    education: merged.education ?? [],
    skills: merged.skills ?? [],
  }
}

// ─────────────────────────────────────────────
// C2.2: capture actions — note / jobIds / contact role
// ─────────────────────────────────────────────

/** tx inside db.transaction — typed without importing PgTransaction. */
type CaptureTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

interface CaptureActions {
  noteId: string | null
  applications: Array<{ jobId: string, applicationId: string | null, outcome: 'created' | 'already_applied' }>
  contact: { clientCompanyId: string, companyName: string, roleId: string | null, roleStarted: boolean } | null
}

/**
 * C2.2: apply the popup's optional actions inside the capture transaction.
 * Runs in ALL THREE outcomes (created / updated / duplicate_skipped) once
 * the candidate id is known, BEFORE the extensionCaptureEvent insert.
 * Everything is idempotent-by-conflict: an existing application or an
 * already-active role is reported, never an error. tx.select/tx.insert/
 * tx.execute only — never tx.query.* (hangs with postgres-js).
 */
async function applyCaptureActions(
  tx: CaptureTx,
  args: {
    organizationId: string
    userId: string
    candidateId: string
    note?: string | undefined
    jobIds: string[]
    /** Set only when captureAs === 'contact' (already resolved + required). */
    contactCompanyName?: string | undefined
  },
): Promise<CaptureActions> {
  const { organizationId, userId, candidateId, note, jobIds, contactCompanyName } = args

  // note → comment on the candidate
  let noteId: string | null = null
  if (note) {
    const [row] = await tx.insert(comment).values({
      organizationId,
      authorId: userId,
      targetType: 'candidate',
      targetId: candidateId,
      body: note,
    }).returning({ id: comment.id })
    noteId = row?.id ?? null
  }

  // jobIds → applications (status 'new'); jobs not returned = already applied
  const applications: CaptureActions['applications'] = []
  if (jobIds.length) {
    const created = await tx.insert(application).values(
      jobIds.map((jobId) => ({
        organizationId,
        candidateId,
        jobId,
        status: 'new' as const,
      })),
    ).onConflictDoNothing().returning({ id: application.id, jobId: application.jobId })
    const createdByJob = new Map(created.map((row) => [row.jobId, row.id]))
    for (const jobId of jobIds) {
      const applicationId = createdByJob.get(jobId) ?? null
      applications.push({ jobId, applicationId, outcome: applicationId ? 'created' : 'already_applied' })
    }
  }

  // contact → find-or-create client_company, then active client_contact role
  let contact: CaptureActions['contact'] = null
  if (contactCompanyName) {
    const name = contactCompanyName
    await tx.insert(clientCompany).values({
      organizationId,
      name,
      // Same normalisation as server/api/client-companies/index.post.ts
      normalizedName: sql`lower(btrim(${name}))`,
    }).onConflictDoNothing()

    const [company] = await tx.select({ id: clientCompany.id, name: clientCompany.name })
      .from(clientCompany)
      .where(and(
        eq(clientCompany.organizationId, organizationId),
        eq(clientCompany.normalizedName, sql`lower(btrim(${name}))`),
      ))
      .limit(1)
    if (!company) {
      throw createError({ statusCode: 500, statusMessage: 'Failed to resolve client company' })
    }

    const [roleRow] = await tx.insert(personRole).values({
      organizationId,
      candidateId,
      role: 'client_contact',
      clientCompanyId: company.id,
    }).onConflictDoNothing().returning({ id: personRole.id })

    contact = {
      clientCompanyId: company.id,
      companyName: company.name,
      roleId: roleRow?.id ?? null,
      roleStarted: roleRow != null,
    }
  }

  return { noteId, applications, contact }
}

export default defineEventHandler(async (event) => {
  const { keyId, organizationId, userId, role } = await authenticateExtensionKey(event)

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
    return {
      preview: buildPreview(merged),
      parsed: parsedProfile !== null,
      duplicate,
      openJobs: await getOpenJobs(organizationId),
    }
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
      actions: null,
    }
  }

  const jobIds = body.jobIds?.length ? [...new Set(body.jobIds)] : []

  // ── C2.2 action permissions (BEFORE the job check and the AI
  //    parse — a refused save must not pay for a provider call): the key owner's
  //    current role must allow each requested action.
  if (body.note && !extensionRoleAllows(role, { comment: ['create'] })) {
    throw createError({ statusCode: 403, statusMessage: 'Your role cannot add comments' })
  }
  if (jobIds.length && !extensionRoleAllows(role, { application: ['create'] })) {
    throw createError({ statusCode: 403, statusMessage: 'Your role cannot add applications' })
  }

  // ── C2.2 job check (BEFORE the AI parse — nothing may be written/paid
  //    for an invalid save): every jobId must be an OPEN job in this org.
  if (jobIds.length) {
    const openJobRows = await db
      .select({ id: job.id })
      .from(job)
      .where(and(
        eq(job.organizationId, organizationId),
        eq(job.status, 'open'),
        inArray(job.id, jobIds),
      ))
    const openJobIds = new Set(openJobRows.map((row) => row.id))
    if (jobIds.some((id) => !openJobIds.has(id))) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Validation failed: jobIds: job not found or not open',
      })
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

  // ── C2.2 contact-company check: saving as a contact needs a company
  //    (explicit contactCompany wins, else the merged company from the page).
  //    BEFORE the transaction — nothing written on a missing company.
  const contactCompanyName = body.captureAs === 'contact'
    ? body.contactCompany ?? merged.company
    : undefined
  if (body.captureAs === 'contact' && !contactCompanyName) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Validation failed: contactCompany: a company is required to save a contact',
    })
  }

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
    actions: CaptureActions
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
          // C2.2: "already in ATS → still add note / jobs / contact role" —
          // the candidate's own fields stay untouched on skip.
          const actions = await applyCaptureActions(tx, {
            organizationId,
            userId,
            candidateId: matchedId,
            note: body.note,
            jobIds,
            contactCompanyName,
          })
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
            actions,
          }
        }

        // update — only overwrite provided, non-empty fields (never blank out)
        await tx.execute(sql`SELECT id FROM candidate WHERE id = ${matchedId} FOR UPDATE`)

        const updatePayload: Record<string, unknown> = { updatedAt: new Date() }
        if (merged.firstName?.trim()) updatePayload.firstName = merged.firstName.trim()
        if (merged.lastName?.trim()) updatePayload.lastName = merged.lastName.trim()
        if (merged.phone?.trim()) updatePayload.phone = merged.phone.trim()
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

        // C2.2 capture actions — AFTER the candidate update, BEFORE the event
        const actions = await applyCaptureActions(tx, {
          organizationId,
          userId,
          candidateId: matchedId,
          note: body.note,
          jobIds,
          contactCompanyName,
        })

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
          actions,
        }
      }

      // create — mirror server/api/candidates/index.post.ts (cache starts NULL)
      const [created] = await tx.insert(candidate).values({
        organizationId,
        firstName: captureFirstName,
        lastName: captureLastName,
        email: null,
        phone: merged.phone?.trim() || null,
        linkedinUrl: body.linkedinUrl?.trim() || null,
        company: merged.company?.trim() || null,
        position: merged.position?.trim() || null,
        // C2.1 richer capture (merged: body wins, AI fills)
        headline: merged.headline?.trim() || null,
        summary: merged.summary?.trim() || null,
        location: merged.location?.trim() || null,
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

      // C2.2 capture actions — BEFORE the event insert
      const actions = await applyCaptureActions(tx, {
        organizationId,
        userId,
        candidateId: created.id,
        note: body.note,
        jobIds,
        contactCompanyName,
      })

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
        actions,
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
          actions: null,
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

  // ── C2.2: fire-and-forget activity for the capture actions (same style
  //    as above — never blocks or fails the response).
  if (result.actions.noteId) {
    recordActivity({
      organizationId,
      actorId: userId,
      action: 'comment_added',
      resourceType: 'candidate',
      resourceId: result.candidateId,
      metadata: { commentId: result.actions.noteId, via: 'extension_capture' },
    })
  }
  for (const app of result.actions.applications) {
    if (app.outcome === 'created' && app.applicationId) {
      recordActivity({
        organizationId,
        actorId: userId,
        action: 'created',
        resourceType: 'application',
        resourceId: app.applicationId,
        metadata: { candidateId: result.candidateId, jobId: app.jobId, via: 'extension_capture' },
      })
    }
  }
  if (result.actions.contact?.roleStarted && result.actions.contact.roleId) {
    recordActivity({
      organizationId,
      actorId: userId,
      action: 'status_changed',
      resourceType: 'person_role',
      resourceId: result.actions.contact.roleId,
      metadata: {
        role: 'client_contact',
        from: null,
        to: 'active',
        companyId: result.actions.contact.clientCompanyId,
        via: 'extension_capture',
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
    actions: result.actions,
  }
})
