import type { TourDefinition } from '../types'

/**
 * Getting started — the My Jobs dashboard.
 * Landmark tour only: every step anchors an element that is present for a
 * typical org. The needs-attention step is conditional (only renders with
 * open jobs + new applicants) — the runtime launcher skips it gracefully
 * when absent, and the e2e target net always creates the condition.
 */
export const gettingStartedTour: TourDefinition = {
  id: 'getting-started',
  label: 'Getting around My Jobs',
  description: 'A quick orientation: where your jobs live and how to start one.',
  routePatterns: [/^\/dashboard\/?$/],
  steps: [
    {
      target: 'nav-new-job',
      title: 'Start a new job',
      body: 'Every placement starts as a job. Click New Job here in the top bar — or the button at the top of this page — whenever you take on a new role.',
      side: 'bottom',
    },
    {
      target: 'jobs-new-job',
      title: 'Same button, up top',
      body: 'This button does the same thing. The top bar follows you everywhere; the header button saves a scroll.',
    },
    {
      target: 'nav-main',
      title: 'Your four sections',
      body: 'Jobs is home. Candidates is your talent pool, Companies holds your client companies, and Applications is every application across all jobs.',
      side: 'bottom',
    },
    {
      target: 'jobs-needs-attention',
      title: 'What needs you',
      body: 'When an open job gets a new application it lands here, at the top of your jobs page, so nothing waits on you overnight.',
    },
    {
      target: 'nav-settings',
      title: 'Settings and team',
      body: 'Invite colleagues, manage your organisation and review account settings from here.',
      side: 'bottom',
    },
    {
      title: 'That’s the basics',
      body: 'Create a job, publish it, and share the public link to start receiving candidates. You can replay this tour any time from the Show me how button.',
    },
  ],
}
