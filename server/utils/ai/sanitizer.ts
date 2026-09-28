/**
 * Context sanitiser — the ONLY path by which free-form `completionData`
 * enters the AI input context (design-ai-slice.md §4, locked).
 *
 * One deterministic string pipeline, identical for all three opaque context
 * fields (`stepCompletionDataText`, `jobOrderContext.step1/step2`):
 *
 *   1. Stringify    — raw string when already a string, else JSON.stringify.
 *   2. Redact emails
 *   3. Redact phone-like runs
 *   4. Bound to 4096 UTF-8 bytes (UTF-8-safe cut + `…[truncated]` marker)
 *
 * The result is an opaque string — it is never parsed back as JSON, so
 * redactions cannot corrupt structure.
 *
 * Guarantee scope (locked honesty): redaction is PATTERN-BASED, not
 * exhaustive — strings matching the two regexes below are redacted; exotic
 * representations outside them (non-ASCII emails, `/`-separated phones) are
 * out of scope for this slice (recruiter-entered, English-market data).
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

// Single JS regex fully defining matching (design §4): the optional `+`/`00`
// prefix appears at most once, at the start; 7–15 digits total; separators
// only BETWEEN digits; lookbehind/lookahead forbid matches inside words,
// emails, or longer digit strings.
const PHONE_RE = /(?<![A-Za-z0-9@._%+-])(?:\+|00)?\d(?:[\d .()\-]*\d){6,14}(?![A-Za-z0-9@._%+-])/g

const LIMIT_BYTES = 4096
const MARKER = '…[truncated]'
// Computed, not hardcoded: '…' is 3 UTF-8 bytes + '[truncated]' 11 = 14.
// (The design doc says 13 — its arithmetic is off; the LOCKED invariant is
// "final string never exceeds 4096 UTF-8 bytes", which this satisfies.)
const MARKER_BYTES = new TextEncoder().encode(MARKER).length
const encoder = new TextEncoder()

/**
 * Sanitise an arbitrary stored value into the opaque context string.
 * Returns null when there is nothing meaningful to include
 * (null/undefined input, or a blank string result).
 */
export function sanitizeOpaqueString(data: unknown): string | null {
  if (data === null || data === undefined) return null

  let str: string
  try {
    str = typeof data === 'string' ? data : JSON.stringify(data)
  }
  catch {
    // JSON.stringify can throw on circular structures — never leak that.
    str = String(data)
  }
  if (str === undefined) return null // JSON.stringify(undefined) edge

  str = str.replace(EMAIL_RE, '[redacted-contact]')
  str = str.replace(PHONE_RE, '[redacted-contact]')

  if (str.trim() === '') return null

  const bytes = encoder.encode(str)
  if (bytes.length <= LIMIT_BYTES) return str

  // Retain the longest prefix whose byte length is ≤ LIMIT − marker bytes,
  // then append the marker so the FINAL string never exceeds the bound.
  let cut = LIMIT_BYTES - MARKER_BYTES
  // UTF-8-safe cut: scan back to the nearest byte that is NOT a continuation
  // byte (0b10xxxxxx) — that byte starts a codepoint.
  let byte = bytes[cut]
  while (cut > 0 && byte !== undefined && (byte & 0b1100_0000) === 0b1000_0000) {
    cut--
    byte = bytes[cut]
  }
  const prefix = new TextDecoder().decode(bytes.subarray(0, cut))
  return prefix + MARKER
}
