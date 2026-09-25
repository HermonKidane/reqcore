import { createRateLimiter } from '../utils/rateLimit'

const SAFE_METHODS = new Set(['GET', 'HEAD'])
const SKIP_METHODS = new Set(['OPTIONS'])

// Baseline global API limits (per IP) — env-tunable; production defaults
// are intentionally tight. Sandboxes/CI running the full e2e suite from one
// IP should raise them via env (see .env.example).
const globalReadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: env.RATE_LIMIT_GLOBAL_READ_MAX,
  message: 'Too many API requests. Please try again shortly.',
})

const globalWriteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: env.RATE_LIMIT_GLOBAL_WRITE_MAX,
  message: 'Too many write requests. Please try again shortly.',
})

// Auth endpoints get their own buckets to reduce brute-force risk without
// starving the rest of the API traffic from the same IP.
const authReadLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxRequests: env.RATE_LIMIT_AUTH_READ_MAX,
  message: 'Too many auth requests. Please try again shortly.',
})

const authWriteLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxRequests: env.RATE_LIMIT_AUTH_WRITE_MAX,
  message: 'Too many sign-in attempts. Please wait before trying again.',
})

export default defineEventHandler(async (event) => {
  // Skip all rate limiting in development for E2E test stability
  if (process.env.NODE_ENV !== 'production') return

  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return

  const method = event.method.toUpperCase()
  if (SKIP_METHODS.has(method)) return

  if (path.startsWith('/api/auth/')) {
    if (SAFE_METHODS.has(method)) {
      await authReadLimiter(event)
      return
    }

    await authWriteLimiter(event)
    return
  }

  if (SAFE_METHODS.has(method)) {
    await globalReadLimiter(event)
    return
  }

  await globalWriteLimiter(event)
})