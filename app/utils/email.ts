/**
 * Friendly email checks for the auth forms.
 * The browser's `type="email"` accepts "name@host" (no dot), so we ask for a full
 * address up front instead of letting the server reply with a validator message.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Domains people mistype most; small on purpose — a wrong guess is worse than none. */
const COMMON_DOMAINS = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com',
  'icloud.com', 'me.com', 'yahoo.com', 'yahoo.co.uk', 'btinternet.com', 'protonmail.com', 'proton.me',
]

export interface EmailCheck {
  ok: boolean
  /** Message to show under the field when not ok */
  message?: string
  /** Full corrected address when the domain looks like a typo of a common one */
  suggestion?: string
}

/** Damerau-free edit distance (insert / delete / substitute), enough for domain typos. */
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let left = i
    for (let j = 1; j <= b.length; j++) {
      const cur = Math.min(
        prev[j]! + 1,
        left + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev[j - 1] = left
      left = cur
    }
    prev[b.length] = left
  }
  return prev[b.length]!
}

export function suggestDomain(domain: string): string | null {
  const d = domain.toLowerCase()
  if (COMMON_DOMAINS.includes(d)) return null
  let best: string | null = null
  let bestDist = 3
  for (const candidate of COMMON_DOMAINS) {
    const dist = editDistance(d, candidate)
    if (dist < bestDist || (dist === bestDist && best && candidate.length < best.length)) {
      best = candidate
      bestDist = dist
    }
  }
  // One keystroke away for short domains, up to two for longer ones; a wrong guess is worse than none.
  const allowed = d.length < 8 ? 1 : 2
  return best && bestDist <= allowed ? best : null
}

export function checkEmail(raw: string): EmailCheck {
  const value = raw.trim()
  if (!value) return { ok: false, message: 'Enter your email address.' }
  if (!EMAIL_RE.test(value)) {
    return { ok: false, message: 'That doesn’t look like a full email address, for example name@company.com.' }
  }
  const at = value.lastIndexOf('@')
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  const better = suggestDomain(domain)
  if (better) return { ok: true, suggestion: `${local}@${better}` }
  return { ok: true }
}

/** Turn Better Auth / validator wording into something a person can act on. */
export function friendlyAuthError(message: string | undefined, fallback: string): string {
  if (!message) return fallback
  const stripped = message.replace(/^\[[\w.]+\]\s*/, '').trim()
  const lower = stripped.toLowerCase()
  // Order matters: "invalid email or password" must not be read as an email-format error.
  if (lower.includes('invalid email or password') || lower.includes('invalid password')) return 'Wrong email or password. Please try again.'
  if (lower.includes('invalid email')) return 'That doesn’t look like a full email address. Check it and try again.'
  if (lower.includes('already exists')) return 'An account with this email already exists. Sign in instead.'
  if (lower.includes('password too short')) return 'Password must be at least 8 characters.'
  if (lower.includes('too many requests') || lower.includes('rate limit')) return 'Too many attempts. Wait a minute and try again.'
  return stripped || fallback
}
