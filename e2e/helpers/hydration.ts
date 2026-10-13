import type { Page } from '@playwright/test'

/** Wait until the Nuxt app is interactive (see app/plugins/hydrated.client.ts). */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === '1', null, { timeout: 30_000 })
}
