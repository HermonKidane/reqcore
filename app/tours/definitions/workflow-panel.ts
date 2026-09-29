import type { TourDefinition } from '../types'

/**
 * The 30-step workflow panel — application detail page.
 * The panel is the R2R operating model: 5 phases, 30 steps, each with a
 * status. Steps that depend on an expanded phase or a started step are
 * deliberately NOT anchored (conditional targets break tours); this tour
 * orients, it does not drive the workflow.
 */
export const workflowPanelTour: TourDefinition = {
  id: 'workflow-panel',
  label: 'The 30-step workflow',
  description: 'How to read and drive the placement workflow on an application.',
  routePatterns: [/^\/dashboard\/applications\/.+/],
  steps: [
    {
      target: 'workflow-panel',
      title: 'The placement workflow',
      body: 'Every application carries the full 30-step recruiting process — from completing the job order through to post-placement admin. The bar shows overall progress.',
    },
    {
      target: 'workflow-phases',
      title: 'Five phases, thirty steps',
      body: 'Steps are grouped into five phases: intake and sourcing, introduction and initial selection, deep evaluation, offer and onboarding, and administration. Open a phase to see its steps.',
    },
    {
      title: 'Work the steps',
      body: 'Click a step to expand it, then Start it when you begin the work. When a step is done, mark it complete — the bar and your team’s progress update straight away.',
    },
  ],
}
