/**
 * Phone normaliser (Add Candidate 2.0). Pure module: no imports — used in
 * the browser on blur and on the server in create/update, so both sides
 * produce the same value.
 *
 * UK numbers become "+44 7700 900123": country code, one space, then the
 * rest as typed (brackets, dashes and dots removed, double spaces closed).
 * Numbers already starting with "+" are kept and only tidied. Anything the
 * function does not understand is returned trimmed and unchanged.
 */

export const PHONE_MAX_LENGTH = 50

/** Remove brackets / dashes / dots, close up runs of spaces. */
function tidy(value: string): string {
  return value.replace(/[()\[\]\-–.]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function normalisePhone(input: string | null | undefined, defaultCountry: string = 'GB'): string {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return ''

  // Only phone characters, and at least 7 digits — otherwise leave it alone.
  if (!/^[+\d\s()\[\]\-–.]+$/.test(trimmed)) return trimmed
  const digitCount = trimmed.replace(/\D/g, '').length
  if (digitCount < 7 || digitCount > 15) return trimmed
  // A "+" is only valid as the very first character.
  if (trimmed.lastIndexOf('+') > 0) return trimmed

  let out: string | null = null

  // +44 (0)20 7946 0958  /  +44 020 …  →  +44 20 7946 0958
  const plus44 = /^\+\s*44\s*(?:\(\s*0\s*\)|0(?=[\s\d]))?\s*(.*)$/.exec(trimmed)
  if (plus44) {
    out = `+44 ${tidy(plus44[1]!)}`
  }
  else if (trimmed.startsWith('+')) {
    // Another country: keep, tidy, single space after "+".
    out = `+${tidy(trimmed.slice(1))}`
  }
  else if (defaultCountry === 'GB') {
    const flat = tidy(trimmed)
    if (/^00\s*44/.test(flat)) {
      // 0044 7700 900123 / 0044 (0)7700 … → +44 7700 900123
      const rest = flat.replace(/^00\s*44\s*/, '').replace(/^0\s*/, '')
      out = `+44 ${rest}`
    }
    else if (/^0[1237]/.test(flat)) {
      out = `+44 ${flat.slice(1).trim()}`
    }
  }

  if (out === null) return trimmed
  out = out.replace(/\s+/g, ' ').trim()
  // Never return something longer than the column allows, or a bare prefix.
  if (out.length > PHONE_MAX_LENGTH || out.replace(/\D/g, '').length < 7) return trimmed
  return out
}
