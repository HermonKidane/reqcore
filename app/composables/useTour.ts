import { driver, type DriveStep } from 'driver.js'
import type { TourDefinition } from '~/tours/types'
import { getTour } from '~/tours'

/**
 * Guided tours (PRD: Driver.js, CBT-style onboarding).
 *
 * Conventions implemented here:
 * - Wait for target elements before highlighting (async-loaded content):
 *   every anchored step is resolved with a short poll; a target that never
 *   appears is SKIPPED with a console warning — never a crash.
 * - Multi-page tours: current tour + step persist in localStorage; pass
 *   { resume: true } to continue where the user left off.
 * - Fail gracefully + log on missing targets.
 *
 * Backend progress tracking (user × tour × completed-at table + checklist
 * view) is intentionally NOT here — PRD batches it with the next
 * schema-touching workstream. Until then completion is kept in
 * localStorage so the launcher can distinguish "Show me how" from "Replay".
 */

const STATE_KEY = 'mr.tour.state'
const COMPLETED_KEY = 'mr.tour.completed'

/** How long to wait for one step's target element before skipping it. */
const TARGET_TIMEOUT_MS = 6_000
const POLL_INTERVAL_MS = 100

interface TourState {
  tourId: string
  stepIndex: number
}

function readState(): TourState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    return raw ? JSON.parse(raw) as TourState : null
  }
  catch {
    return null
  }
}

function writeState(state: TourState | null) {
  if (state) localStorage.setItem(STATE_KEY, JSON.stringify(state))
  else localStorage.removeItem(STATE_KEY)
}

export function readCompletedTourIds(): string[] {
  try {
    const raw = localStorage.getItem(COMPLETED_KEY)
    return raw ? JSON.parse(raw) as string[] : []
  }
  catch {
    return []
  }
}

function markCompleted(tourId: string) {
  const done = new Set(readCompletedTourIds())
  done.add(tourId)
  localStorage.setItem(COMPLETED_KEY, JSON.stringify([...done]))
}

function waitForTarget(target: string, timeoutMs: number): Promise<boolean> {
  const selector = `[data-tour="${target}"]`
  return new Promise((resolve) => {
    if (document.querySelector(selector)) return resolve(true)
    const started = Date.now()
    const timer = window.setInterval(() => {
      if (document.querySelector(selector)) {
        window.clearInterval(timer)
        resolve(true)
      }
      else if (Date.now() - started > timeoutMs) {
        window.clearInterval(timer)
        resolve(false)
      }
    }, POLL_INTERVAL_MS)
  })
}

export function useTour() {
  /**
   * Start a tour. With { resume: true }, continues from the persisted step
   * if one exists for this tour (multi-page resume convention).
   *
   * Returns the driver instance, or null when the tour is unknown.
   */
  async function startTour(tourId: string, opts: { resume?: boolean } = {}) {
    if (!import.meta.client) return null

    const tour = getTour(tourId)
    if (!tour) {
      console.warn(`[tours] unknown tour "${tourId}"`)
      return null
    }

    // Wait for all targets up front (in parallel), then drop the ones that
    // never appeared. Modal steps (no target) always survive.
    const resolved = await Promise.all(tour.steps.map(async (step) => {
      if (!step.target) return { step, ok: true as const }
      const ok = await waitForTarget(step.target, TARGET_TIMEOUT_MS)
      if (!ok) {
        console.warn(`[tours] tour "${tour.id}": target [data-tour="${step.target}"] not found — step "${step.title}" skipped`)
      }
      return { step, ok: ok as boolean }
    }))

    const steps: DriveStep[] = resolved
      .filter(r => r.ok)
      .map(({ step }) => ({
        ...(step.target ? { element: `[data-tour="${step.target}"]` } : {}),
        popover: {
          title: step.title,
          description: step.body,
          side: step.side ?? 'bottom',
        },
      }))

    if (steps.length === 0) {
      console.warn(`[tours] tour "${tour.id}": no resolvable steps on this page — aborting gracefully`)
      writeState(null)
      return null
    }

    // Multi-page resume: continue from the persisted step index.
    let startIndex = 0
    if (opts.resume) {
      const saved = readState()
      if (saved?.tourId === tour.id) {
        startIndex = Math.min(Math.max(saved.stepIndex, 0), steps.length - 1)
      }
    }

    const persistProgress = (nextIndex: number) => {
      if (nextIndex >= steps.length) writeState(null) // finished
      else writeState({ tourId: tour.id, stepIndex: nextIndex })
    }

    // Set when the user advances PAST the last step — driver.js then
    // destroys itself, and onDestroyed uses this flag (getActiveIndex() is
    // undefined after teardown, so the index alone can't prove completion).
    let finished = false

    const driverObj = driver({
      steps,
      activeIndex: startIndex,
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      popoverClass: 'mr-tour-popover',
      onNextClick: () => {
        const idx = driverObj.getActiveIndex() ?? 0
        if (idx >= steps.length - 1) finished = true
        persistProgress(idx + 1)
        driverObj.moveNext()
      },
      onPrevClick: () => {
        persistProgress(Math.max((driverObj.getActiveIndex() ?? 0) - 1, 0))
        driverObj.movePrevious()
      },
      onCloseClick: () => {
        writeState(null)
        driverObj.destroy()
      },
      onDestroyed: () => {
        if (finished) markCompleted(tour.id)
        writeState(null)
      },
    })

    driverObj.drive()
    return driverObj
  }

  /** The persisted in-progress tour, if any (used for "Resume tour"). */
  function pendingTourId(): string | null {
    if (!import.meta.client) return null
    return readState()?.tourId ?? null
  }

  return { startTour, pendingTourId }
}

export type { TourDefinition }
