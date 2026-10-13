/**
 * GET /api/auth-providers — which social sign-in buttons to show.
 * Public, read-only, no secrets (ids/secrets never leave the server).
 */
export default defineEventHandler(() => enabledSocialProviders())
