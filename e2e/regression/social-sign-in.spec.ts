import { test, expect } from '../fixtures'

/**
 * Social sign-in (Google / Microsoft) — regression.
 * The real OAuth round-trip can't run headless (provider login pages), so this
 * covers what we own: the provider-flag endpoint leaks nothing but booleans,
 * buttons appear only for configured providers, and Better Auth error codes
 * coming back on /auth/sign-in render a human message.
 */

test.describe('social sign-in', () => {
  test('GET /api/auth-providers returns only booleans', async ({ request }) => {
    const res = await request.get('/api/auth-providers')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['google', 'microsoft'])
    expect(typeof body.google).toBe('boolean')
    expect(typeof body.microsoft).toBe('boolean')
    expect(JSON.stringify(body)).not.toMatch(/secret|client/i)
  })

  test('sign-in page shows a button per configured provider', async ({ page, request }) => {
    const providers = await (await request.get('/api/auth-providers')).json()
    await page.goto('/auth/sign-in')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    const google = page.getByTestId('social-google')
    const microsoft = page.getByTestId('social-microsoft')
    if (providers.google) await expect(google).toBeVisible()
    else await expect(google).toHaveCount(0)
    if (providers.microsoft) await expect(microsoft).toBeVisible()
    else await expect(microsoft).toHaveCount(0)
  })

  test('sign-up page shows the same buttons', async ({ page, request }) => {
    const providers = await (await request.get('/api/auth-providers')).json()
    await page.goto('/auth/sign-up')
    await expect(page.getByTestId('social-google')).toHaveCount(providers.google ? 1 : 0)
    await expect(page.getByTestId('social-microsoft')).toHaveCount(providers.microsoft ? 1 : 0)
  })

  for (const [code, fragment] of [
    ['account_not_linked', 'already exists'],
    ['provider_email_not_verified', 'did not confirm your email'],
    ['state_mismatch', 'expired'],
    ['something_unknown', 'failed'],
  ] as const) {
    test(`?error=${code} renders a readable message`, async ({ page }) => {
      await page.goto(`/auth/sign-in?error=${code}`)
      await expect(page.locator('form').getByText(fragment, { exact: false }).first()).toBeVisible()
    })
  }
})
