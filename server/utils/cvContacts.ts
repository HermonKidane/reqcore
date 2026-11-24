/**
 * CV contact extraction (Add Candidate 2.0). Pure module: no imports.
 *
 * House rule for AI calls: contact details never go to the model. The CV
 * parse route reads email / phone / LinkedIn URL HERE, on our server, and
 * sends the model `redactedText` only (every email → "[email]", every phone
 * → "[phone]"; the LinkedIn URL stays — it is a public profile address).
 *
 * Matching is pattern-based. A "plausible phone" has 7–15 digits and is not
 * a date, a year range ("2019 - 2023") or a ZIP+4 code.
 */

export interface ExtractedContacts {
  email?: string
  phone?: string
  linkedinUrl?: string
  redactedText: string
}

// Bounded + anchored at a token start: an unbounded local part is quadratic on a
// long run of letters (60,000 x 'a' took ~6 s).
const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}/g

// Optional "+" / "00" prefix, optional opening bracket, then digits with
// separators BETWEEN them (space, non-breaking space, dot, brackets, hyphen).
// Never crosses a line break. Lookbehind / lookahead keep it out of words,
// emails and longer digit strings.
// At most three separator characters between two digits (covers ") " and
// " - "), so a phone never swallows unrelated numbers further along the line.
const PHONE_RE = /(?<![A-Za-z0-9@_%+\-.\/])(?:\+[ \u00a0]?|00)?\(?\d(?:[ \u00a0.()\-]{0,3}\d){6,}(?![A-Za-z0-9@_%+\/]|[ \u00a0.()\-]{0,3}\d)/g

const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+\/?/i

const YEAR_RE = /^(?:19|20)\d{2}$/

/** True when the matched run of digits and separators looks like a phone number. */
export function isPlausiblePhone(candidate: string): boolean {
  const text = candidate.trim()
  const digits = text.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return false

  const hasPrefix = text.startsWith('+') || text.startsWith('00')
  const groups = text.split(/\D+/).filter(Boolean)

  if (!hasPrefix) {
    // Dates and year ranges: "2019 - 2023", "2019-03-01", "12.03.2019",
    // "03 2019 - 05 2021" — at least one year, everything else a year or a
    // 1–2 digit day / month.
    const years = groups.filter(g => YEAR_RE.test(g)).length
    if (years > 0 && groups.every(g => YEAR_RE.test(g) || g.length <= 2)) return false
    // US ZIP+4: 90210-1234
    if (/^\d{5}-\d{4}$/.test(text)) return false
    // One unbroken run with no leading 0: only 10–11 digits reads as a
    // phone (4155550123); shorter / longer runs are ids, reference numbers.
    if (groups.length === 1 && !digits.startsWith('0') && (digits.length < 10 || digits.length > 11)) return false
  }
  return true
}

function findPhones(text: string): Array<{ index: number, match: string }> {
  const found: Array<{ index: number, match: string }> = []
  for (const m of text.matchAll(PHONE_RE)) {
    if (isPlausiblePhone(m[0])) found.push({ index: m.index, match: m[0] })
  }
  return found
}

export function extractContacts(text: string): ExtractedContacts {
  const source = text ?? ''

  const emailMatch = source.match(EMAIL_RE)?.find(e => e.length <= 255)
  const email = emailMatch?.replace(/\.+$/, '')

  const linkedinMatch = LINKEDIN_RE.exec(source)?.[0]
  const linkedinUrl = linkedinMatch?.replace(/\/+$/, '')

  // Emails out first, so digits inside an address can never read as a phone.
  const withoutEmails = source.replace(EMAIL_RE, '[email]')

  const phones = findPhones(withoutEmails)
  const firstPhone = phones[0]?.match.replace(/[\u00a0 ]+/g, ' ').trim()

  let redactedText = ''
  let cursor = 0
  for (const p of phones) {
    redactedText += withoutEmails.slice(cursor, p.index) + '[phone]'
    cursor = p.index + p.match.length
  }
  redactedText += withoutEmails.slice(cursor)

  return {
    ...(email ? { email } : {}),
    ...(firstPhone && firstPhone.length <= 50 ? { phone: firstPhone } : {}),
    ...(linkedinUrl ? { linkedinUrl } : {}),
    redactedText,
  }
}
