import { test, expect } from '../fixtures'

/**
 * Settings → Account → "Connected sign-ins" (link Google / Microsoft to a password account).
 * The provider round-trip can't run headless, so this covers what we own:
 * - the section lists the password method as active for a fresh email/password user
 * - a Connect button per configured provider, no Disconnect for unlinked ones
 * - POST /api/auth/link-social for a configured provider hands back a provider URL
 *   (i.e. the server-side link flow is wired and requires a session)
 * - link-flow error codes coming back on the page render a human message
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('connected sign-ins', () => {
  test('account page lists sign-in methods for a password user', async ({ authenticatedPage: page, request }) => {
    const providers = await (await request.get('/api/auth-providers')).json()

    await page.goto('/dashboard/settings/account')
    const section = page.getByTestId('connected-accounts')
    await expect(section.getByRole('heading', { name: 'Connected sign-ins' })).toBeVisible()

    const password = section.getByTestId('method-password')
    await expect(password).toBeVisible()
    await expect(password.getByText('Active')).toBeVisible()

    for (const id of ['google', 'microsoft'] as const) {
      const row = section.getByTestId(`method-${id}`)
      if (providers[id]) {
        await expect(row).toBeVisible()
        await expect(row.getByText('Not connected')).toBeVisible()
        await expect(section.getByTestId(`connect-${id}`)).toBeEnabled()
        await expect(section.getByTestId(`disconnect-${id}`)).toHaveCount(0)
      }
      else {
        await expect(row).toHaveCount(0)
      }
    }
  })

  test('link-social for a configured provider returns the provider URL (session required)', async ({ authenticatedPage: page, request }) => {
    const providers = await (await request.get('/api/auth-providers')).json()
    const provider = providers.google ? 'google' : providers.microsoft ? 'microsoft' : null
    test.skip(!provider, 'no social provider configured on this server')

    // Signed-in context (cookies from the fixture)
    const res = await page.request.post('/api/auth/link-social', {
      headers: { Origin: BASE },
      data: { provider, callbackURL: '/dashboard/settings/account', disableRedirect: true },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.url).toMatch(provider === 'google' ? /accounts\.google\.com/ : /login\.microsoftonline\.com/)

    // Anonymous context → rejected
    const anon = await request.post('/api/auth/link-social', {
      headers: { Origin: BASE },
      data: { provider, callbackURL: '/dashboard/settings/account', disableRedirect: true },
    })
    expect(anon.status()).toBe(401)
  })

  test('unlinking the only sign-in method is refused by the server', async ({ authenticatedPage: page }) => {
    const res = await page.request.post('/api/auth/unlink-account', {
      headers: { Origin: BASE },
      data: { providerId: 'credential' },
    })
    expect(res.status()).toBe(400)
    await page.goto('/dashboard/settings/account')
    await expect(page.getByTestId('method-password').getByText('Active')).toBeVisible()
  })

  for (const [code, fragment] of [
    ["email_doesn't_match", 'different email address'],
    ['unable_to_link_account', 'did not confirm your email'],
    ['account_already_linked_to_different_user', 'different MyRecruiter user'],
    ['something_unknown', 'failed'],
  ] as const) {
    test(`?error=${code} renders a readable message`, async ({ authenticatedPage: page }) => {
      await page.goto(`/dashboard/settings/account?error=${encodeURIComponent(code)}`)
      const section = page.getByTestId('connected-accounts')
      await expect(section.getByRole('alert')).toContainText(fragment)
      // The URL is cleaned so a refresh doesn't repeat the message
      await expect.poll(() => new URL(page.url()).searchParams.get('error')).toBeNull()
    })
  }

  test('?linked=google shows a success note', async ({ authenticatedPage: page }) => {
    await page.goto('/dashboard/settings/account?linked=google')
    await expect(page.getByTestId('connected-accounts').getByRole('status')).toContainText('Google connected')
  })
})
