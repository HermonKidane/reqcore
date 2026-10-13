import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { APIError } from 'better-auth/api'
import { ac, owner, admin, member } from '~~/shared/permissions'
import { sendOrgInvitationEmail } from './email'
import * as schema from '../database/schema'

type Auth = ReturnType<typeof betterAuth>
let _auth: Auth | undefined

function resolveTrustedOrigins(baseUrl: string): string[] {
  const configuredOrigins = env.BETTER_AUTH_TRUSTED_ORIGINS
  const baseOrigin = new URL(baseUrl)
  const isLocalBase = baseOrigin.hostname === 'localhost' || baseOrigin.hostname === '127.0.0.1'
  const defaultDevOrigins = (import.meta.dev || isLocalBase)
    ? [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
      ]
    : []

  return Array.from(new Set([baseOrigin.origin, ...configuredOrigins, ...defaultDevOrigins]))
}

function resolveBetterAuthUrl(): string {
  const explicitUrl = env.BETTER_AUTH_URL?.trim()
  const railwayDomain = env.RAILWAY_PUBLIC_DOMAIN?.trim()
  const hasPreviewDomain = railwayDomain ? railwayDomain.toLowerCase().includes('-pr-') : false
  const hasPrNumber = !!env.RAILWAY_GIT_PR_NUMBER?.trim()
  const isPreview = isRailwayPreviewEnvironment(env.RAILWAY_ENVIRONMENT_NAME) || hasPreviewDomain || hasPrNumber

  if (!isPreview) {
    if (!explicitUrl) {
      throw new Error('BETTER_AUTH_URL is required outside Railway PR/preview environments')
    }

    return explicitUrl
  }

  if (railwayDomain) {
    const previewUrl = `https://${railwayDomain}`
    console.info(`[Reqcore] Using Railway public-domain BETTER_AUTH_URL: ${previewUrl}`)
    return previewUrl
  }

  const prNumber = env.RAILWAY_GIT_PR_NUMBER?.trim()
  if (prNumber) {
    console.warn(
      `[Reqcore] Railway PR number detected (${prNumber}) but RAILWAY_PUBLIC_DOMAIN is missing. ` +
      'Set BETTER_AUTH_URL explicitly or ensure Railway generated domains are enabled.',
    )
  }

  if (explicitUrl) {
    console.info('[Reqcore] Using explicit BETTER_AUTH_URL in Railway PR/preview environment')
    return explicitUrl
  }

  throw new Error(
    'Unable to resolve BETTER_AUTH_URL in Railway PR/preview environment. ' +
    'Set RAILWAY_GIT_PR_NUMBER, RAILWAY_PUBLIC_DOMAIN, or BETTER_AUTH_URL.',
  )
}

/**
 * Social sign-in providers, each enabled only when its client id + secret are set.
 * Redirect URIs are fixed by Better Auth: <BETTER_AUTH_URL>/api/auth/callback/<provider>
 * — register exactly those at Google / Entra (see .env.example).
 */
export function resolveSocialProviders(): NonNullable<Parameters<typeof betterAuth>[0]['socialProviders']> {
  const providers: NonNullable<Parameters<typeof betterAuth>[0]['socialProviders']> = {}

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      prompt: 'select_account',
    }
  }

  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    providers.microsoft = {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      tenantId: env.MICROSOFT_TENANT_ID,
      prompt: 'select_account',
      disableProfilePhoto: true,
      // Entra's `email` claim is NOT verified by default: a tenant admin can set any
      // address on a user (the "nOAuth" takeover). Treat it as verified only when the
      // token carries Microsoft's verification claims — these must be added as
      // optional claims on the app registration (Token configuration → ID token:
      // email, xms_edov, verified_primary_email, verified_secondary_email).
      mapProfileToUser: (profile) => {
        const email = typeof profile.email === 'string' ? profile.email.toLowerCase() : undefined
        const inList = (list: unknown) => Array.isArray(list) && !!email && list.some(e => typeof e === 'string' && e.toLowerCase() === email)
        const emailVerified = !!email && (
          profile.email_verified === true
          || profile.xms_edov === true
          || inList(profile.verified_primary_email)
          || inList(profile.verified_secondary_email)
        )
        return { emailVerified }
      },
    }
  }

  return providers
}

/** Which social providers are configured (safe to expose — no secrets). */
export function enabledSocialProviders(): { google: boolean, microsoft: boolean } {
  return {
    google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    microsoft: !!(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET),
  }
}

/**
 * Lazily create the Better Auth instance on first access.
 * Prevents build-time prerendering from crashing when auth env vars
 * aren't available (Railway injects env vars only at deploy time).
 */
function getAuth(): Auth {
  if (!_auth) {
    const baseURL = resolveBetterAuthUrl()

    _auth = betterAuth({
      baseURL,
      trustedOrigins: resolveTrustedOrigins(baseURL),
      database: drizzleAdapter(db, {
        provider: 'pg',
        schema,
      }),
      secret: env.BETTER_AUTH_SECRET,
      // better-auth's own limiter + session.ip_address read the FIRST
      // X-Forwarded-For hop by default, which is client-controlled behind an
      // appending proxy (nginx $proxy_add_x_forwarded_for). nginx overwrites
      // X-Real-IP with $remote_addr, so trust only that.
      advanced: {
        ipAddress: {
          ipAddressHeaders: ['x-real-ip'],
        },
      },
      rateLimit: {
        customRules: {
          '/sign-in/*': { window: 10, max: env.RATE_LIMIT_SIGNIN_MAX },
          '/sign-up/*': { window: 10, max: env.RATE_LIMIT_SIGNIN_MAX },
        },
      },
      emailAndPassword: {
        enabled: true,
      },
      socialProviders: resolveSocialProviders(),
      databaseHooks: {
        user: {
          create: {
            // OAuth sign-ups must arrive with a provider-verified email. Otherwise an
            // unverified Microsoft/Entra email could create a user that a later verified
            // Google login for the same address would implicitly link into.
            // Email/password sign-ups (path /sign-up/email) are unaffected.
            before: async (user, ctx) => {
              if (ctx?.path === '/callback/:id' && !user.emailVerified) {
                throw new APIError('BAD_REQUEST', { message: 'provider email not verified' })
              }
            },
          },
        },
      },
      account: {
        accountLinking: {
          // Better Auth default: an OAuth login is linked to an existing user with the
          // same email ONLY when the provider reports the email as verified (or the
          // provider is listed in trustedProviders). We list none — Google verifies
          // Workspace emails itself; Microsoft only when the optional claims below are
          // present. Otherwise the login fails with `account_not_linked` instead of
          // merging into someone else's account.
          enabled: true,
          trustedProviders: [],
        },
      },
      plugins: [
        organization({
          // ── Access Control ──────────────────────────────────────
          // Declarative RBAC — permissions defined once in shared/permissions.ts,
          // enforced on every API route via requirePermission().
          ac,
          roles: {
            owner,
            admin,
            member,
          },

          // ── Invitation Email ────────────────────────────────────
          // Required for Better Auth's built-in invitation flow.
          // Constructs a link the invitee clicks to accept.
          // Uses Resend when RESEND_API_KEY is configured, otherwise logs to console.
          async sendInvitationEmail(data) {
            const inviteLink = `${baseURL}/auth/accept-invitation/${data.id}`
            await sendOrgInvitationEmail(data, inviteLink)
          },

          // ── Security Hardening ──────────────────────────────────
          // Cancel stale invitations when a new one is sent to the same email.
          cancelPendingInvitationsOnReInvite: true,
          // 48 hours (default) — explicitly stated for auditability.
          invitationExpiresIn: 48 * 60 * 60,
        }),
      ],
    })
  }
  return _auth
}

/**
 * Lazily-initialized Better Auth instance.
 * The auth configuration is created on first property access — not at import time.
 * This prevents build-time prerendering from failing when BETTER_AUTH_SECRET
 * and BETTER_AUTH_URL aren't available.
 */
export const auth: Auth = new Proxy({} as Auth, {
  get(_, prop) {
    const instance = getAuth()
    const value = (instance as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function' ? (value as Function).bind(instance) : value
  },
})
