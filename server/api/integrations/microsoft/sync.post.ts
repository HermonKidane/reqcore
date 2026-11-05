import { getIntegration, getMicrosoftSyncStatus, requireUserSession } from '../../../utils/graph/integration'
import { pullTasks, pushPending } from '../../../utils/graph/sync'

const MIN_INTERVAL_MS = 10_000

/**
 * POST /api/integrations/microsoft/sync — "Sync now".
 * Pushes pending/changed tasks (up to 50 inline) then a forced pull.
 * Errors are reported in the returned status, not as a failed request.
 */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const integ = await getIntegration(userId)
  if (!integ?.enabled) throw createError({ statusCode: 409, statusMessage: 'To Do & Calendar sync is off' })
  // Forced pulls skip the 2-minute throttle, so stop button-mashing here
  if (integ.lastPullAt && Date.now() - integ.lastPullAt.getTime() < MIN_INTERVAL_MS) {
    throw createError({ statusCode: 429, statusMessage: 'Synced a moment ago. Try again in a few seconds.' })
  }

  const { pushed } = await pushPending(userId, { limit: 50 })
  const pull = await pullTasks(userId, { force: true })
  return { ...(await getMicrosoftSyncStatus(userId)), pushed, pull }
})
