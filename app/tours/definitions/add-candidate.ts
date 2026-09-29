import type { TourDefinition } from '../types'

/**
 * Add a candidate — the Candidates list page.
 * The add-candidate form lives on its own page; the form itself carries
 * data-tour="candidate-form" so this tour can extend onto it later.
 */
export const addCandidateTour: TourDefinition = {
  id: 'add-candidate',
  label: 'Adding a candidate',
  description: 'Build your talent pool one person at a time.',
  routePatterns: [/^\/dashboard\/candidates\/?$/],
  steps: [
    {
      target: 'candidates-add',
      title: 'Add a candidate',
      body: 'Click Add Candidate and fill in first name, last name and email — that’s the minimum. Phone is optional.',
    },
    {
      target: 'candidates-search',
      title: 'Search your pool',
      body: 'Search matches name and email as you type — useful when a client mentions someone you already know.',
    },
    {
      target: 'candidates-filters',
      title: 'Filter by relationship',
      body: 'These filters separate candidates (connections and prospects) from client contacts, and can narrow client contacts by company.',
    },
    {
      target: 'candidates-list',
      title: 'Your candidate pool',
      body: 'The list shows each person, their email, and how many job applications they have. Click anyone to see their full profile and history.',
    },
  ],
}
