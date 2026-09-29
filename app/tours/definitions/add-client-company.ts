import type { TourDefinition } from '../types'

/**
 * Add a client company — the Companies page.
 * The create form only renders after the Add button is clicked, so the
 * form-filling instruction is a modal step (no target) that cannot break
 * when the form is open or closed.
 */
export const addClientCompanyTour: TourDefinition = {
  id: 'add-client-company',
  label: 'Adding a client company',
  description: 'Record the companies your client contacts work at.',
  routePatterns: [/^\/dashboard\/companies\/?$/],
  steps: [
    {
      target: 'companies-add',
      title: 'Add a company',
      body: 'Client companies are the businesses you recruit for. Click Add Company to open the form — name is all you need to start.',
    },
    {
      title: 'Fill in the basics',
      body: 'Type the company name (required) and, if you know it, the website. Then press Save — you’ll land on the company page where you can add client contacts and link the company to jobs.',
    },
    {
      target: 'companies-search',
      title: 'Find companies fast',
      body: 'Search filters the list as you type. Handy once you have dozens of clients.',
    },
    {
      target: 'companies-list',
      title: 'Your client list',
      body: 'Each row shows the company, its website, and how many active client contacts you have there. Click a company to open it.',
    },
  ],
}
