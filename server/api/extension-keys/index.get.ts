import { and, desc, eq } from 'drizzle-orm'
import { extensionApiKey } from '../../database/schema'

/**
 * GET /api/extension-keys
 * List the current user's extension API keys in the active organization.
 * Never returns keyHash — and the plaintext key is never stored, so it
 * can never be returned either.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const keys = await db
    .select({
      id: extensionApiKey.id,
      name: extensionApiKey.name,
      keyPrefix: extensionApiKey.keyPrefix,
      createdAt: extensionApiKey.createdAt,
      lastUsedAt: extensionApiKey.lastUsedAt,
      revokedAt: extensionApiKey.revokedAt,
    })
    .from(extensionApiKey)
    .where(and(
      eq(extensionApiKey.organizationId, orgId),
      eq(extensionApiKey.userId, userId),
    ))
    .orderBy(desc(extensionApiKey.createdAt))

  return keys
})
