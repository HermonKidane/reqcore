import { test, expect } from '../fixtures'
import { waitForHydration } from '../helpers/hydration'

/**
 * Email mistakes on the auth forms are caught before the request is sent and
 * explained in plain English (no "[body.email] Invalid email address").
 */

test.describe('auth email checks', () => {
  test('sign-up: a domain without a dot is stopped on the device with a plain message', async ({ page }) => {
    let apiCalls = 0
    page.on('request', (req) => { if (req.url().includes('/api/auth/sign-up')) apiCalls++ })

    await page.goto('/auth/sign-up')
    await waitForHydration(page)
    await page.getByLabel('Name').fill('Isaac Kidane')
    await page.getByLabel('Email').fill('isaac@r2r')
    await page.getByLabel('Password', { exact: true }).fill('TestPassword123!')
    await page.getByLabel('Confirm password').fill('TestPassword123!')
    await page.getByRole('button', { name: 'Sign up' }).click()

    const msg = page.getByTestId('email-error')
    await expect(msg).toBeVisible()
    await expect(msg).toContainText('full email address')
    await expect(msg).not.toContainText('[body')
    await expect(page.getByLabel('Email')).toBeFocused()
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(apiCalls).toBe(0)
  })

  test('sign-up: a common domain typo offers a one-tap correction', async ({ page }) => {
    await page.goto('/auth/sign-up')
    await waitForHydration(page)
    const email = page.getByLabel('Email')
    await email.fill('isaac@gmial.com')
    await email.blur()
    const hint = page.getByTestId('email-suggestion')
    await expect(hint).toContainText('isaac@gmail.com')
    await hint.getByRole('button').click()
    await expect(email).toHaveValue('isaac@gmail.com')
    await expect(hint).toHaveCount(0)
  })

  test('sign-in: same check, and a wrong password reads as plain English', async ({ page }) => {
    await page.goto('/auth/sign-in')
    await waitForHydration(page)
    await page.getByLabel('Email').fill('someone@r2r')
    await page.getByLabel('Password').fill('whatever123')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByTestId('email-error')).toContainText('full email address')

    await page.getByLabel('Email').fill('nobody-e2e@test.local')
    await page.getByRole('button', { name: 'Sign in' }).click()
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible({ timeout: 15_000 })
    await expect(alert).not.toContainText('[body')
    await expect(alert).toContainText(/wrong email or password|too many attempts/i)
  })
})
