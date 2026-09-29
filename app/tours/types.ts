/**
 * Guided-tour types — pure config, no Nuxt/Vue imports.
 *
 * PRD conventions (myrecruiter PRD "ATS guided tours"):
 * - Tours target stable `data-tour` attribute values ONLY — never CSS classes
 *   or DOM structure. The attribute lives on the element; the step references
 *   it by name here.
 * - Tour definitions are config (steps/target/title/text), one file per tour,
 *   editable without touching component code.
 * - Step text: short, practical, UK English.
 *
 * Kept dependency-free so the Playwright target-existence spec imports the
 * SAME definitions the UI runs (e2e/regression/tour-targets.spec.ts).
 */

export interface TourStep {
  /**
   * Value of the `data-tour` attribute to anchor this step to.
   * Omit for a centred modal step (instructional text with no highlight).
   */
  target?: string
  title: string
  body: string
  /** Preferred popover side, passed to driver.js. Default 'bottom'. */
  side?: 'top' | 'right' | 'bottom' | 'left'
}

export interface TourDefinition {
  /** Stable id, used in localStorage state and the launcher. */
  id: string
  /** Short label shown in the "Show me how" launcher. */
  label: string
  /** One-line description shown alongside the label. */
  description: string
  /**
   * URL patterns (locale-agnostic) this tour is offered on, tested against
   * the path AFTER stripping any `/en`-style locale segment — so
   * `/^\/dashboard\/?$/` matches both `/dashboard` and `/en/dashboard`.
   * Keep patterns anchored; an unanchored pattern would leak onto subpages.
   */
  routePatterns: RegExp[]
  steps: TourStep[]
}
