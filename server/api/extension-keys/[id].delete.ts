import { and, eq, isNull } from 'drizzle-orm'
import { extensionApiKey } from '../../database/schema'

/**
 * DELETE /api/extension-keys/:id
 * Soft-revoke the current user's own extension key.
 * 404 if the key doesn't exist OR belongs to another org OR another user —
 * never reveal a key's existence across those boundaries.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const keyId = getRouterParam(event, 'id')
  if (!keyId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing key ID' })
  }

  const [revoked] = await db
    .update(extensionApiKey)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(extensionApiKey.id, keyId),
      eq(extensionApiKey.organizationId, orgId),
      eq(extensionApiKey.userId, userId),
      isNull(extensionApiKey.revokedAt),
    ))
    .returning({ id: extensionApiKey.id, name: extensionApiKey.name })

  if (!revoked) {
    throw createError({ statusCode: 404, statusMessage: 'Extension key not found' })
  }

  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'deleted',
    resourceType: 'extension_api_key',
    resourceId: revoked.id,
    metadata: { name: revoked.name },
  })

  return { success: true }
})
