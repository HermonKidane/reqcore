import type { TourDefinition } from './types'
import { gettingStartedTour } from './definitions/getting-started'
import { addClientCompanyTour } from './definitions/add-client-company'
import { addCandidateTour } from './definitions/add-candidate'
import { workflowPanelTour } from './definitions/workflow-panel'

/**
 * Tour registry — pure config, no Nuxt/Vue imports, so both the UI
 * (composables/useTour.ts via TourLauncher.vue) and the Playwright
 * target-existence spec import the same source of truth.
 */

export const tours: TourDefinition[] = [
  gettingStartedTour,
  addClientCompanyTour,
  addCandidateTour,
  workflowPanelTour,
]

export function getTour(id: string): TourDefinition | undefined {
  return tours.find(t => t.id === id)
}

/**
 * Locale prefixes the app can emit in URLs (i18n.config). Anything longer
 * is left alone. Extend here if a new locale is added.
 */
const LOCALE_PATTERN = /^\/(en|es|fr|de|nb|vi)(?=\/|$)/

/**
 * Tours offered on a given URL path. Strips a leading locale segment, then
 * matches each tour's anchored routePatterns. Results are ordered by
 * pattern length (most specific first) so page-specific tours beat any
 * broader match.
 */
export function toursForPath(path: string): TourDefinition[] {
  const stripped = path.replace(LOCALE_PATTERN, '') || '/'
  return tours
    .filter(t => t.routePatterns.some(re => re.test(stripped)))
    .sort((a, b) =>
      Math.max(...b.routePatterns.map(String).map(s => s.length))
      - Math.max(...a.routePatterns.map(String).map(s => s.length)))
}
