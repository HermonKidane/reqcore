/**
 * CV contact extraction (Add Candidate 2.0). Pure module: no imports.
 *
 * House rule for AI calls: contact details never go to the model. The CV
 * parse route reads email / phone / LinkedIn URL HERE, on our server, and
 * sends the model `redactedText` only (email → "[email]", phone → "[phone]",
 * LinkedIn profile address → "[linkedin]").
 *
 * Redaction is deliberately wider than extraction: anything that could be a
 * phone number (7–15 digits, not a date) or a spelled-out address
 * ("jane (at) mail.com") is hidden from the model, but only a confident match
 * is offered to the form.
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

// "jane (at) mail.com", "jane [at] mail [dot] com" — hidden from the model, never offered to the form.
const SPELLED_EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}\s{0,2}[(\[{<]\s{0,2}at\s{0,2}[)\]}>]\s{0,2}[A-Za-z0-9-]{1,63}(?:\s{0,2}(?:\.|[(\[{<]\s{0,2}dot\s{0,2}[)\]}>])\s{0,2}[A-Za-z0-9-]{1,63}){1,4}/gi

// A run of digits and phone separators. One character class repeated, so the
// scan is linear; the rules (gaps, context, digit count) are applied in code.
// (A single regex with a bounded-gap repeat was quadratic on "1 1 1 1 …".)
const DIGIT_RUN_RE = /\d[\d \u00a0.()\-\/]*/g
const SEPARATOR_GAP_RE = /[^\d]{4,}/
const BEFORE_BLOCKED_RE = /[A-Za-z0-9@_%+\-.\/]/

const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]{1,200}\/?/gi

const YEAR_RE = /^(?:19|20)\d{2}$/

function looksLikeDate(text: string, groups: string[]): boolean {
  // Dates and year ranges: "2019 - 2023", "2019-03-01", "12.03.2019",
  // "03/2019 - 05/2021" — at least one year, everything else a year or a
  // 1–2 digit day / month.
  const years = groups.filter(g => YEAR_RE.test(g)).length
  if (years > 0 && groups.every(g => YEAR_RE.test(g) || g.length <= 2)) return true
  // US ZIP+4: 90210-1234
  return /^\d{5}-\d{4}$/.test(text)
}

/** Wide rule, used for redaction: could this be a phone number at all? */
export function isPossiblePhone(candidate: string): boolean {
  const text = candidate.trim()
  const digits = text.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return false
  if (text.startsWith('+') || text.startsWith('00')) return true
  return !looksLikeDate(text, text.split(/\D+/).filter(Boolean))
}

/** Strict rule, used for the form: does this read as a phone number? */
export function isPlausiblePhone(candidate: string): boolean {
  const text = candidate.trim()
  if (!isPossiblePhone(text)) return false
  if (text.startsWith('+') || text.startsWith('00')) return true
  const digits = text.replace(/\D/g, '')
  const groups = text.split(/\D+/).filter(Boolean)
  // One unbroken run with no leading 0: only 10–11 digits reads as a
  // phone (4155550123); shorter / longer runs are ids, reference numbers.
  if (groups.length === 1 && !digits.startsWith('0') && (digits.length < 10 || digits.length > 11)) return false
  return true
}

/**
 * Every possible phone in the text, in order. A phone is digits with at most
 * three separator characters between two digits (covers ") " and " - "), may
 * start with "+", "00" or "(", never crosses a line break and never starts
 * inside a word, an address or a longer token.
 */
function findPhones(text: string): Array<{ index: number, match: string }> {
  const found: Array<{ index: number, match: string }> = []
  for (const run of text.matchAll(DIGIT_RUN_RE)) {
    let offset = 0
    for (const piece of splitOnGaps(run[0])) {
      const pieceStart = run.index + run[0].indexOf(piece, offset)
      offset = pieceStart - run.index + piece.length
      // Trim to first digit … last digit (a closing bracket after the last digit is dropped)
      const core = piece.replace(/[^\d]+$/, '')
      if (!core) continue
      let start = pieceStart
      let match = core
      // Take back a leading "(" and / or "+" (with one optional space) in front of the first digit
      if (text[start - 1] === '(') { start--; match = '(' + match }
      if (text[start - 1] === '+') { start--; match = '+' + match }
      else if ((text[start - 1] === ' ' || text[start - 1] === '\u00a0') && text[start - 2] === '+') { start -= 2; match = text.slice(start, start + 2) + match }
      const before = start > 0 ? text[start - 1]! : ''
      if (before && BEFORE_BLOCKED_RE.test(before)) continue
      if (isPossiblePhone(match)) found.push({ index: start, match })
    }
  }
  return found
}

function splitOnGaps(run: string): string[] {
  const pieces: string[] = []
  let rest = run
  while (rest) {
    const gap = SEPARATOR_GAP_RE.exec(rest)
    if (!gap) { pieces.push(rest); break }
    if (gap.index > 0) pieces.push(rest.slice(0, gap.index))
    rest = rest.slice(gap.index + gap[0].length)
  }
  return pieces.filter(piece => /\d/.test(piece)).map(piece => piece.replace(/^[^\d]+/, ''))
}

export function extractContacts(text: string): ExtractedContacts {
  const source = text ?? ''

  const emailMatch = source.match(EMAIL_RE)?.find(e => e.length <= 255)
  const email = emailMatch?.replace(/\.+$/, '')

  const linkedinMatch = source.match(LINKEDIN_RE)?.[0]
  const linkedinUrl = linkedinMatch?.replace(/\/+$/, '')

  // Addresses out first, so digits inside one can never read as a phone.
  const withoutAddresses = source
    .replace(EMAIL_RE, '[email]')
    .replace(SPELLED_EMAIL_RE, '[email]')
    .replace(LINKEDIN_RE, '[linkedin]')

  const phones = findPhones(withoutAddresses)
  const firstPhone = phones.find(p => isPlausiblePhone(p.match))?.match.replace(/[\u00a0 ]+/g, ' ').trim()

  let redactedText = ''
  let cursor = 0
  for (const p of phones) {
    redactedText += withoutAddresses.slice(cursor, p.index) + '[phone]'
    cursor = p.index + p.match.length
  }
  redactedText += withoutAddresses.slice(cursor)

  return {
    ...(email ? { email } : {}),
    ...(firstPhone && firstPhone.length <= 50 ? { phone: firstPhone } : {}),
    ...(linkedinUrl ? { linkedinUrl } : {}),
    redactedText,
  }
}
