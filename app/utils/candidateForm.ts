/**
 * Shared Tailwind class strings for the candidate forms (Add Candidate 2.0
 * and the qualifier fields reused in the profile edit form). Inputs are
 * 44 px tall and 16 px text on phones (no iOS zoom), compact from `sm:`.
 */
export const candidateInputClass
  = 'w-full min-h-11 rounded-lg border px-3 py-2 text-base sm:text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors'

export const candidateLabelClass = 'block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1'

export const candidateCardClass = 'rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4 sm:p-5'

export function candidateBorderClass(hasError: boolean | string | undefined): string {
  return hasError ? 'border-danger-300 dark:border-danger-700' : 'border-surface-300 dark:border-surface-700'
}
