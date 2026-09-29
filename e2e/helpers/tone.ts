/**
 * Tone regression net + spoken-word counting for AI-output e2e
 * (design reviews 2026-09-29 — opus findings D, fable findings 5/13/14).
 *
 * Philosophy: the model's OWN wording must never preach (trust/rapport/
 * relationship-building), cheerlead, or hype. Quoted material is exempt —
 * fields that carry the candidate's or job order's own words are skipped,
 * and any match whose exact text also appears in the input snapshot is
 * attributed quoting, not the model's vocabulary.
 *
 * Default policy: scan EVERY string leaf of the parsed output except the
 * quote-key deny-list (fable finding 13 — maintaining a per-field allow
 * list lets unclassified fields slip through unscanned).
 */

/** Fields that carry quoted source wording — never the model's own. */
export const QUOTE_KEYS: ReadonlySet<string> = new Set([
  'candidateWords',
  'words',
  'sourceQuote',
  'mirror',
  'fromNotes',
  'evidence',
  'value',
  'jobOrderReference',
])

const META = /\b(?:build|builds|building|built|earn(?:s|ed|ing)?|establish(?:es|ed|ing)?|develop(?:s|ed|ing)?|strengthen(?:s|ed|ing)?)\s+(?:[\w'’]+\s+){0,2}?(?:trust|rapport|relationships?)\b|\brapport\b|\b(?:trust|relationship)[- ]building\b/i
const BARE = /\b(?:trust|relationships?)\b/i
const CHEER = /\b(?:great job|well done|you(?:'ve|’ve| have) got this|(?:best of |good )luck|exciting opportunit\w*|amazing|fantastic|perfect fit)\b/i

export interface ToneViolation {
  path: string
  kind: 'cheer' | 'preach'
  match: string
}

function walk(value: unknown, path: string, key: string | null, visit: (path: string, key: string | null, text: string) => void): void {
  if (typeof value === 'string') {
    visit(path, key, value)
    return
  }
  if (Array.isArray(value)) {
    // Propagate the array's key so a deny-listed key of string arrays
    // (e.g. candidateWords: string[]) still applies to its items.
    value.forEach((item, i) => walk(item, `${path}[${i}]`, key, visit))
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      walk(v, `${path}.${k}`, k, visit)
    }
  }
}

/**
 * Every preachy/cheerful wording in the model's own text. A match is
 * exempt only when the exact matched text also appears in the input
 * snapshot (case-insensitive) — i.e. it was quoted, not coined. Every
 * occurrence is checked: one exempt quote does not launder a coined word
 * elsewhere in the same string.
 */
export function findToneViolations(output: unknown, inputSnapshot: unknown): ToneViolation[] {
  const inputText = JSON.stringify(inputSnapshot ?? {}).toLowerCase()
  const violations: ToneViolation[] = []

  walk(output, '$', null, (path, key, text) => {
    if (key && QUOTE_KEYS.has(key)) return

    for (const cheer of text.matchAll(new RegExp(CHEER.source, 'gi'))) {
      if (!inputText.includes(cheer[0].toLowerCase())) {
        violations.push({ path, kind: 'cheer', match: cheer[0] })
      }
    }
    for (const preach of text.matchAll(new RegExp(`${META.source}|${BARE.source}`, 'gi'))) {
      if (!inputText.includes(preach[0].toLowerCase())) {
        violations.push({ path, kind: 'preach', match: preach[0] })
      }
    }
  })

  return violations
}

/**
 * Words the consultant speaks: cue markers "(PAUSE)"/"(warm)" and bare
 * punctuation don't count; each "[CONFIRM: …]" placeholder counts as 3
 * words (it resolves to real spoken words the 95-word cap must see —
 * review finding 14). Mirrors server/utils/ai/provider.ts — keep in sync.
 */
export function countSpokenWords(script: string): number {
  const tokens = script
    .replace(/\[CONFIRM:[^\]]*\]/g, ' ␟ ')
    .split(/\s+/)
    .filter(t => t.length > 0)
  let words = 0
  let confirms = 0
  for (const t of tokens) {
    if (t === '␟') { confirms += 1; continue }
    if (/^\(.*\)\.?$/.test(t)) continue // cue marker
    if (!/[\p{L}\p{N}]/u.test(t)) continue // punctuation residue
    words += 1
  }
  return words + confirms * 3
}
