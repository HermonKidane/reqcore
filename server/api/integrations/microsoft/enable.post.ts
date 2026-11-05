import { MICROSOFT, GraphError, graphClient } from '../../../utils/graph/client'
import { ensureTodoList } from '../../../utils/graph/todo'
import { pushPending, pullTasks } from '../../../utils/graph/sync'
import { getIntegration, getMicrosoftAccount, getMicrosoftSyncStatus, missingScopes, requireUserSession } from '../../../utils/graph/integration'
import { userIntegration } from '../../../database/schema'

/**
 * POST /api/integrations/microsoft/enable — turn the sync on.
 * Needs a linked Microsoft account whose granted scopes include
 * Tasks.ReadWrite + Calendars.ReadWrite (the "Connect To Do & Calendar"
 * link step). Creates the "MyRecruiter" list now so a bad token shows up
 * here, then pushes existing open tasks in the background.
 */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const acct = await getMicrosoftAccount(userId)
  if (!acct) throw createError({ statusCode: 409, statusMessage: 'Connect your Microsoft account first' })
  const missing = missingScopes(acct.scope)
  if (missing.length) {
    throw createError({ statusCode: 409, statusMessage: `Microsoft has not granted: ${missing.join(', ')}. Use Connect To Do & Calendar.`, data: { missingScopes: missing } })
  }

  const now = new Date()
  await db.insert(userIntegration)
    .values({ userId, provider: MICROSOFT, enabled: true, lastError: null })
    .onConflictDoUpdate({
      target: [userIntegration.userId, userIntegration.provider],
      set: { enabled: true, lastError: null, updatedAt: now },
    })

  try {
    const g = await graphClient(userId)
    const integ = await getIntegration(userId)
    await ensureTodoList(g, { cachedListId: integ?.todoListId })
  }
  catch (err) {
    // A reconnect error has already switched the integration off again
    const message = err instanceof GraphError ? err.message : 'Could not reach Microsoft To Do. Try again later.'
    throw createError({ statusCode: 502, statusMessage: message })
  }

  // First push + pull in the background: may be many tasks
  setImmediate(() => {
    pushPending(userId).then(() => pullTasks(userId, { force: true })).catch(() => {})
  })

  return getMicrosoftSyncStatus(userId)
})
