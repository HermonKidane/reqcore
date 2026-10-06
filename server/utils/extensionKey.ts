import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { extensionApiKey, member } from '../database/schema'
import { admin, member as memberRole, owner } from '~~/shared/permissions'

const ROLES = { owner, admin, member: memberRole } as const

// ─────────────────────────────────────────────
// Browser-extension API keys (C1)
// ─────────────────────────────────────────────

/**
 * Key format: "mrx_" + base64url(32 random bytes) = 256 bits of entropy.
 * Keys are random high-entropy secrets, so SHA-256 (not bcrypt) is the
 * correct at-rest transform — the server stores ONLY the hash. Because
 * only the hash is stored, HMAC request signing is not possible; the
 * boundary is protected by bearer-over-TLS + idempotency keys +
 * per-key rate limiting + soft revocation (guardrail 13).
 */

export function hashExtensionKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

export function generateExtensionKey(): { plaintext: string; prefix: string; hash: string } {
  const plaintext = `mrx_${randomBytes(32).toString('base64url')}`
  return { plaintext, prefix: plaintext.slice(0, 12), hash: hashExtensionKey(plaintext) }
}

export interface AuthenticatedExtensionKey {
  keyId: string
  organizationId: string
  userId: string
  /** C2.2: the key owner's CURRENT membership role string (comma-separated). */
  role: string
}

/**
 * C2.2: does a (possibly comma-separated) membership role string allow the
 * given permissions? Same ROLES/authorize logic as the candidate-check below —
 * any one of the member's roles granting the permission is enough.
 */
export function extensionRoleAllows(
  role: string,
  permissions: Parameters<typeof owner.authorize>[0],
): boolean {
  return role.split(',').some((r) => {
    const def = ROLES[r.trim() as keyof typeof ROLES]
    return def?.authorize(permissions).success === true
  })
}

/**
 * Authenticate `Authorization: Bearer mrx_...` for extension-facing routes.
 *
 * 401 on: missing/malformed header, unknown key, revoked key, or a key whose
 * user is no longer a member of the key's organization (Better Auth `member`).
 * 403 if the user's current role lacks candidate create+update.
 * Lookup is by SHA-256 hash — no plaintext secret is ever compared or stored.
 *
 * Updates lastUsedAt fire-and-forget (never blocks or fails the request).
 */
export async function authenticateExtensionKey(event: H3Event): Promise<AuthenticatedExtensionKey> {
  const header = getHeader(event, 'authorization')
  const match = header?.match(/^Bearer\s+(\S+)$/)
  if (!match) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or missing API key' })
  }

  const [keyRow] = await db
    .select({
      keyId: extensionApiKey.id,
      organizationId: extensionApiKey.organizationId,
      userId: extensionApiKey.userId,
    })
    .from(extensionApiKey)
    .where(and(
      eq(extensionApiKey.keyHash, hashExtensionKey(match[1]!)),
      isNull(extensionApiKey.revokedAt),
    ))
    .limit(1)

  if (!keyRow) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or missing API key' })
  }

  // Key's owner must still be a member of the key's org
  const [membership] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(
      eq(member.userId, keyRow.userId),
      eq(member.organizationId, keyRow.organizationId),
    ))
    .limit(1)

  if (!membership) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or missing API key' })
  }

  // Re-check the owner's CURRENT role on every call (a later downgrade must
  // stop an old key from writing). Better Auth stores multiple roles comma-separated.
  if (!extensionRoleAllows(membership.role, { candidate: ['create', 'update'] })) {
    throw createError({ statusCode: 403, statusMessage: 'Your role cannot add candidates' })
  }

  // Fire-and-forget: last-used tracking must never break the request
  db.update(extensionApiKey)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(extensionApiKey.id, keyRow.keyId), isNull(extensionApiKey.revokedAt)))
    .then(() => {})
    .catch(() => {})

  return { ...keyRow, role: membership.role }
}
