import { and, eq } from 'drizzle-orm'
import { userIntegration } from '../../../database/schema'
import { MICROSOFT } from '../../../utils/graph/client'
import { getMicrosoftSyncStatus, requireUserSession } from '../../../utils/graph/integration'

/**
 * POST /api/integrations/microsoft/disable — "Turn off sync".
 * Stops push and pull; keeps the Microsoft sign-in link, the list id and
 * the remote copies (turning back on carries on where it left off).
 */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  await db.update(userIntegration)
    .set({ enabled: false, updatedAt: new Date() })
    .where(and(eq(userIntegration.userId, session.user.id), eq(userIntegration.provider, MICROSOFT)))
  return getMicrosoftSyncStatus(session.user.id)
})
