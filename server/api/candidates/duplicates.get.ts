import { and, eq, inArray, sql } from 'drizzle-orm'
import { candidate } from '../../database/schema'
import { candidateDuplicatesQuerySchema } from '../../utils/schemas/candidate'
import { findCandidateIdByLinkedinUrl, type DupExecutor } from '../../utils/linkedinUrl'

/**
 * GET /api/candidates/duplicates
 *
 * "Is this person already here?" — called by the Add Candidate form when
 * email / phone / LinkedIn / name lose focus. Read-only, org-scoped, at
 * most 5 people, strongest match first, one entry per person.
 *
 *   email     exact    (candidate_email, normalised — same lookup as create)
 *   linkedin  exact    (normalised URL — same lookup as create)
 *   phone     likely   (digits only, last 9 equal; input needs 9+ digits)
 *   name      possible (first AND last name equal, case-insensitive;
 *                       'likely' when the company matches too)
 *
 * The response never carries email or phone values.
 * (Static route: wins over the sibling `[id]` route in Nitro's router.)
 */

const MAX_MATCHES = 5

// Generous: the form calls this on blur, debounced.
const duplicatesLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 120,
  message: 'Too many duplicate checks. Please wait a moment and try again.',
})

type Reason = 'email' | 'linkedin' | 'phone' | 'name'
type Strength = 'exact' | 'likely' | 'possible'
interface Hit { reason: Reason, strength: Strength, rank: number }

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  await duplicatesLimiter(event, `dup:${session.user.id}`)

  const query = await getValidatedQuery(event, candidateDuplicatesQuerySchema.parse)

  const hits = new Map<string, Hit>()
  const add = (id: string | null | undefined, hit: Hit) => {
    if (!id || id === query.excludeId) return
    const current = hits.get(id)
    if (!current || hit.rank < current.rank) hits.set(id, hit)
  }

  const executor = db as unknown as DupExecutor

  if (query.email) {
    add(await findCandidateIdByEmail(executor, orgId, query.email), { reason: 'email', strength: 'exact', rank: 0 })
  }

  if (query.linkedinUrl && /linkedin\.com\//i.test(query.linkedinUrl)) {
    add(await findCandidateIdByLinkedinUrl(executor, orgId, query.linkedinUrl), { reason: 'linkedin', strength: 'exact', rank: 1 })
  }

  const phoneDigits = (query.phone ?? '').replace(/\D/g, '')
  if (phoneDigits.length >= 9) {
    const last9 = phoneDigits.slice(-9)
    const rows = await db
      .select({ id: candidate.id })
      .from(candidate)
      .where(and(
        eq(candidate.organizationId, orgId),
        sql`${candidate.phone} IS NOT NULL`,
        sql`right(regexp_replace(${candidate.phone}, '[^0-9]', '', 'g'), 9) = ${last9}::text`,
      ))
      .limit(MAX_MATCHES + 1)
    for (const row of rows) add(row.id, { reason: 'phone', strength: 'likely', rank: 2 })
  }

  if (query.firstName && query.lastName) {
    const company = query.company ?? ''
    const sameCompany = sql<boolean>`(${company}::text <> '' AND lower(btrim(coalesce(${candidate.company}, ''))) = lower(${company}::text))`
    const rows = await db
      .select({ id: candidate.id, sameCompany })
      .from(candidate)
      .where(and(
        eq(candidate.organizationId, orgId),
        sql`lower(btrim(${candidate.firstName})) = lower(${query.firstName}::text)`,
        sql`lower(btrim(${candidate.lastName})) = lower(${query.lastName}::text)`,
      ))
      .orderBy(sql`${sameCompany} DESC`, sql`${candidate.createdAt} DESC`)
      .limit(MAX_MATCHES + 1)
    for (const row of rows) {
      add(row.id, row.sameCompany
        ? { reason: 'name', strength: 'likely', rank: 3 }
        : { reason: 'name', strength: 'possible', rank: 4 })
    }
  }

  if (hits.size === 0) return { matches: [] }

  const people = await db
    .select({
      id: candidate.id,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      company: candidate.company,
      position: candidate.position,
      location: candidate.location,
    })
    .from(candidate)
    .where(and(eq(candidate.organizationId, orgId), inArray(candidate.id, [...hits.keys()])))

  const matches = people
    .map((person) => {
      const hit = hits.get(person.id)!
      return { ...person, reason: hit.reason, strength: hit.strength, rank: hit.rank }
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_MATCHES)
    .map(({ rank: _rank, ...match }) => match)

  return { matches }
})
