import { and, count, eq, isNull } from 'drizzle-orm'
import { extensionApiKey } from '../../database/schema'
import { createExtensionKeySchema } from '../../utils/schemas/extension'
import { generateExtensionKey } from '../../utils/extensionKey'

const MAX_ACTIVE_KEYS_PER_USER = 10

/**
 * POST /api/extension-keys
 * Create an extension API key for the current user in the active org.
 * The plaintext key is returned ONCE, here, and never again.
 * Max 10 active keys per user per org → 409 beyond that.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const body = await readValidatedBody(event, createExtensionKeySchema.parse)

  const [activeCount] = await db
    .select({ n: count() })
    .from(extensionApiKey)
    .where(and(
      eq(extensionApiKey.organizationId, orgId),
      eq(extensionApiKey.userId, userId),
      isNull(extensionApiKey.revokedAt),
    ))

  if ((activeCount?.n ?? 0) >= MAX_ACTIVE_KEYS_PER_USER) {
    throw createError({
      statusCode: 409,
      statusMessage: `Maximum of ${MAX_ACTIVE_KEYS_PER_USER} active extension keys per user`,
    })
  }

  const { plaintext, prefix, hash } = generateExtensionKey()

  const [created] = await db
    .insert(extensionApiKey)
    .values({
      organizationId: orgId,
      userId,
      name: body.name,
      keyPrefix: prefix,
      keyHash: hash,
    })
    .returning({
      id: extensionApiKey.id,
      name: extensionApiKey.name,
      keyPrefix: extensionApiKey.keyPrefix,
      createdAt: extensionApiKey.createdAt,
    })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to create extension key' })
  }

  recordActivity({
    organizationId: orgId,
    actorId: userId,
    action: 'created',
    resourceType: 'extension_api_key',
    resourceId: created.id,
    metadata: { name: created.name },
  })

  setResponseStatus(event, 201)
  // The ONLY response that ever carries the plaintext key
  return { ...created, key: plaintext }
})
