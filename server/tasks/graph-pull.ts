import { and, eq, sql } from 'drizzle-orm'
import { userIntegration } from '../database/schema'
import { MICROSOFT } from '../utils/graph/client'
import { pullTasks, pushPending } from '../utils/graph/sync'

// Arbitrary constant shared by every container: "graph:pull is running".
const ADVISORY_LOCK_ID = 726_311_501

/**
 * Every 15 minutes (nuxt.config scheduledTasks): for each user with the
 * Microsoft sync on, retry stuck pushes then pull To Do changes.
 * pg_try_advisory_xact_lock makes a second container skip instead of
 * double-running; the lock is released when the transaction ends.
 */
export default defineTask({
  meta: {
    name: 'graph:pull',
    description: 'Microsoft To Do / Outlook: push pending tasks and pull remote changes for every enabled user',
  },
  async run() {
    const summary = { users: 0, pushed: 0, seen: 0, changed: 0, errors: 0, skipped: false }
    await db.transaction(async (tx) => {
      const rows = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(${ADVISORY_LOCK_ID}) as locked`)
      if (!rows[0]?.locked) {
        summary.skipped = true
        return
      }
      const users = await tx.select({ userId: userIntegration.userId })
        .from(userIntegration)
        .where(and(eq(userIntegration.provider, MICROSOFT), eq(userIntegration.enabled, true)))
      for (const { userId } of users) {
        summary.users++
        try {
          summary.pushed += (await pushPending(userId, { limit: 100 })).pushed
          const r = await pullTasks(userId)
          summary.seen += r.seen
          summary.changed += r.completed + r.reopened + r.cancelled + r.accepted
          if (r.status === 'error') summary.errors++
        }
        catch {
          summary.errors++
        }
      }
    })
    // Counts only: never remote ids, never tokens
    console.info(`[graph:pull] users=${summary.users} pushed=${summary.pushed} seen=${summary.seen} changed=${summary.changed} errors=${summary.errors}${summary.skipped ? ' (skipped: another runner holds the lock)' : ''}`)
    return { result: summary }
  },
})
