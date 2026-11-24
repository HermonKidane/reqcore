/**
 * Candidate qualifiers (Add Candidate 2.0) — the ONE place the option lists
 * and their human labels live. Imported by the server schemas (validation)
 * and by the UI (selects + profile display). Pure module: no imports.
 */

export const SOURCE_CHANNELS = ['linkedin', 'job_board', 'referral', 'headhunt', 'database', 'event', 'website', 'agency', 'other'] as const
export type SourceChannel = typeof SOURCE_CHANNELS[number]
export const SOURCE_CHANNEL_LABELS: Record<SourceChannel, string> = {
  linkedin: 'LinkedIn',
  job_board: 'Job board',
  referral: 'Referral',
  headhunt: 'Headhunt',
  database: 'Our database',
  event: 'Event',
  website: 'Website',
  agency: 'Agency',
  other: 'Other',
}

export const NOTICE_PERIODS = ['immediate', '1_week', '2_weeks', '1_month', '2_months', '3_months', '6_months', 'other'] as const
export type NoticePeriod = typeof NOTICE_PERIODS[number]
export const NOTICE_PERIOD_LABELS: Record<NoticePeriod, string> = {
  immediate: 'Available now',
  '1_week': '1 week',
  '2_weeks': '2 weeks',
  '1_month': '1 month',
  '2_months': '2 months',
  '3_months': '3 months',
  '6_months': '6 months',
  other: 'Other',
}

export const RIGHT_TO_WORK = ['yes', 'sponsorship_needed', 'unknown'] as const
export type RightToWork = typeof RIGHT_TO_WORK[number]
export const RIGHT_TO_WORK_LABELS: Record<RightToWork, string> = {
  yes: 'Has the right to work in the UK',
  sponsorship_needed: 'Needs visa sponsorship',
  unknown: 'Not known yet',
}

export const WORK_PREFERENCES = ['office', 'hybrid', 'remote', 'flexible'] as const
export type WorkPreference = typeof WORK_PREFERENCES[number]
export const WORK_PREFERENCE_LABELS: Record<WorkPreference, string> = {
  office: 'Office',
  hybrid: 'Hybrid',
  remote: 'Remote',
  flexible: 'Flexible',
}

/** Currencies offered in the form. The API accepts any 3-letter ISO code. */
export const SALARY_CURRENCIES = ['GBP', 'EUR', 'USD'] as const
export const DEFAULT_SALARY_CURRENCY = 'GBP'

export const SALARY_MAX = 10_000_000
export const DAY_RATE_MAX = 100_000
export const SKILLS_MAX = 50
export const SKILL_MAX_LENGTH = 80

/** The eight qualifier fields as the form holds them ('' = not set). */
export interface QualifierFormValues {
  sourceChannel: string
  salaryCurrency: string
  salaryCurrent: string
  salaryExpected: string
  dayRate: string
  noticePeriod: string
  rightToWork: string
  workPreference: string
}

export function emptyQualifiers(): QualifierFormValues {
  return {
    sourceChannel: '',
    salaryCurrency: DEFAULT_SALARY_CURRENCY,
    salaryCurrent: '',
    salaryExpected: '',
    dayRate: '',
    noticePeriod: '',
    rightToWork: '',
    workPreference: '',
  }
}

/** "£65,000" — whole units, en-GB grouping. Unknown currency codes fall back to "65,000 XYZ". */
export function formatMoney(amount: number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return ''
  const code = (currency || DEFAULT_SALARY_CURRENCY).toUpperCase()
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(amount)
  }
  catch {
    return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(amount)} ${code}`
  }
}

/**
 * Check a money input as typed in the form. Returns the whole number, null
 * when blank, or an error message in plain words.
 */
export function parseMoneyInput(raw: string | number | null | undefined, max: number): { value: number | null, error?: string } {
  const text = String(raw ?? '').trim()
  if (text === '') return { value: null }
  if (!/^\d+$/.test(text)) return { value: null, error: 'Use a whole number with no commas or symbols' }
  const value = Number(text)
  if (value > max) return { value: null, error: `Must be ${new Intl.NumberFormat('en-GB').format(max)} or less` }
  return { value }
}
