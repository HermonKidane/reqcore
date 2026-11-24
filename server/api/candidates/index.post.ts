import { art14Defaults } from '../../utils/privacyNotice'
import { eq } from 'drizzle-orm'
import { candidate, candidateEducation, candidateExperience, candidateSkill } from '../../database/schema'
import { createCandidateSchema } from '../../utils/schemas/candidate'
import { findCandidateIdByLinkedinUrl, canonicalLinkedinUrl } from '../../utils/linkedinUrl'
import { dedupeSkills } from '../../utils/skills'
import { DEFAULT_SALARY_CURRENCY } from '~~/shared/candidate-qualifiers'

type CreatedCandidate = {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  linkedinUrl: string | null
  position: string | null
  company: string | null
  location: string | null
  headline: string | null
  summary: string | null
  sourceChannel: string | null
  salaryCurrency: string | null
  salaryCurrent: number | null
  salaryExpected: number | null
  dayRate: number | null
  noticePeriod: string | null
  rightToWork: string | null
  workPreference: string | null
  createdAt: Date
  updatedAt: Date
}

const createdColumns = {
  id: candidate.id,
  firstName: candidate.firstName,
  lastName: candidate.lastName,
  email: candidate.email,
  phone: candidate.phone,
  linkedinUrl: candidate.linkedinUrl,
  position: candidate.position,
  company: candidate.company,
  location: candidate.location,
  headline: candidate.headline,
  summary: candidate.summary,
  sourceChannel: candidate.sourceChannel,
  salaryCurrency: candidate.salaryCurrency,
  salaryCurrent: candidate.salaryCurrent,
  salaryExpected: candidate.salaryExpected,
  dayRate: candidate.dayRate,
  noticePeriod: candidate.noticePeriod,
  rightToWork: candidate.rightToWork,
  workPreference: candidate.workPreference,
  createdAt: candidate.createdAt,
  updatedAt: candidate.updatedAt,
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId

  const body = await readValidatedBody(event, createCandidateSchema.parse)

  const hasMoney = body.salaryCurrent != null || body.salaryExpected != null || body.dayRate != null
  const skills = dedupeSkills(body.skills ?? [])

  let created: CreatedCandidate | undefined

  try {
    ;[created] = await db.transaction(async (tx) => {
      // Uniqueness checks (org-wide, normalized) — not the cache
      if (body.email) {
        const existingId = await findCandidateIdByEmail(tx, orgId, body.email)
        if (existingId) {
          throw createError({
            statusCode: 409,
            statusMessage: 'A candidate with this email already exists',
            // Lets the form link to the existing person
            data: { existingId, field: 'email' },
          })
        }
      }

      if (body.linkedinUrl) {
        const linkedinTx = tx as unknown as Parameters<typeof findCandidateIdByLinkedinUrl>[0]
        const existingId = await findCandidateIdByLinkedinUrl(linkedinTx, orgId, body.linkedinUrl)
        if (existingId) {
          throw createError({
            statusCode: 409,
            statusMessage: 'A candidate with this LinkedIn URL already exists',
            data: { existingId, field: 'linkedinUrl' },
          })
        }
      }

      // Cache starts NULL; the helper is the ONLY writer of candidate.email
      const [created] = await tx.insert(candidate).values({
        organizationId: orgId,
        firstName: body.firstName,
        lastName: body.lastName,
        email: null,
        phone: body.phone,
        linkedinUrl: body.linkedinUrl ? canonicalLinkedinUrl(body.linkedinUrl) : null,
        position: body.position ?? null,
        company: body.company ?? null,
        location: body.location ?? null,
        headline: body.headline ?? null,
        summary: body.summary ?? null,
        // Add Candidate 2.0 qualifiers — currency defaults to GBP only when
        // a money field is set (the column itself has no default)
        sourceChannel: body.sourceChannel ?? null,
        salaryCurrency: body.salaryCurrency ?? (hasMoney ? DEFAULT_SALARY_CURRENCY : null),
        salaryCurrent: body.salaryCurrent ?? null,
        salaryExpected: body.salaryExpected ?? null,
        dayRate: body.dayRate ?? null,
        noticePeriod: body.noticePeriod ?? null,
        rightToWork: body.rightToWork ?? null,
        workPreference: body.workPreference ?? null,
        // Slice 1: Art 14 tracker starts at creation
        ...art14Defaults(),
        // source stays default 'manual'
      }).returning(createdColumns)

      if (!created) {
        throw createError({ statusCode: 500, statusMessage: 'Failed to create candidate' })
      }

      // Primary email row + cache sync, same transaction (single code path)
      if (body.email) {
        await insertPrimaryEmail(tx, orgId, created.id, body.email, { source: 'manual' })
      }

      // Skills / work history / education in the SAME transaction (tx.insert
      // only — tx.query.* hangs with postgres-js). Skills typed by the user
      // are 'manual'; history comes from the CV prefill, so 'cv'.
      if (skills.length) {
        await tx.insert(candidateSkill).values(
          skills.map((skill) => ({
            organizationId: orgId,
            candidateId: created.id,
            name: skill.name,
            normalizedName: skill.normalizedName,
            source: 'manual',
          })),
        )
      }
      if (body.experiences?.length) {
        await tx.insert(candidateExperience).values(
          body.experiences.map((exp, index) => ({
            organizationId: orgId,
            candidateId: created.id,
            title: exp.title,
            company: exp.company || null,
            location: exp.location || null,
            startText: exp.startText || null,
            endText: exp.endText || null,
            isCurrent: exp.isCurrent ?? false,
            description: exp.description || null,
            sortOrder: index,
            source: 'cv',
          })),
        )
      }
      if (body.education?.length) {
        await tx.insert(candidateEducation).values(
          body.education.map((edu, index) => ({
            organizationId: orgId,
            candidateId: created.id,
            school: edu.school,
            degree: edu.degree || null,
            fieldOfStudy: edu.fieldOfStudy || null,
            startText: edu.startText || null,
            endText: edu.endText || null,
            description: edu.description || null,
            sortOrder: index,
            source: 'cv',
          })),
        )
      }

      // Re-select so the response carries the synced cache value
      const [synced] = await tx.select(createdColumns).from(candidate).where(eq(candidate.id, created.id))

      return [synced!]
    })
  }
  catch (err) {
    // Lost race: another request created the same normalized email concurrently
    if (isUniqueViolation(err)) {
      // Best effort: the winner has committed, so its id can be looked up
      const existingId = body.email
        ? await findCandidateIdByEmail(db as unknown as Parameters<typeof findCandidateIdByEmail>[0], orgId, body.email).catch(() => null)
        : null
      throw createError({
        statusCode: 409,
        statusMessage: 'A candidate with this email already exists',
        ...(existingId ? { data: { existingId, field: 'email' } } : {}),
      })
    }
    throw err
  }

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to create candidate' })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'candidate',
    resourceId: created.id,
    metadata: { name: `${created.firstName} ${created.lastName}` },
  })

  setResponseStatus(event, 201)
  return created
})
