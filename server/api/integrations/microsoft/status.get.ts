import { getMicrosoftSyncStatus, requireUserSession } from '../../../utils/graph/integration'

/**
 * GET /api/integrations/microsoft/status — the signed-in user's To Do /
 * Outlook sync state (linked? scopes granted? on? last sync / error).
 * Per-user, not org data: any signed-in user, own row only.
 */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  return getMicrosoftSyncStatus(session.user.id)
})
