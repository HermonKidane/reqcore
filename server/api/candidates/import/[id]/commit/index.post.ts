import { eq, and, inArray } from 'drizzle-orm'
import { candidateImport, candidateImportRow, candidate, application } from '../../../../../database/schema'
import { z } from 'zod'

const commitSchema = z.object({
  duplicatePolicy: z.enum(['skip', 'update']).default('skip'),
})

const MAX_ROWS_PER_IMPORT = 5000
const MAX_FIELD_LENGTH = 2000

/**
 * POST /api/candidates/import/{id}/commit
 * Execute the import — create/update candidates and optionally apply to job.
 * All operations run in a single transaction.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const importId = getRouterParam(event, 'id')
  if (!importId) {
    throw createError({ statusCode: 400, statusMessage: 'Import ID is required' })
  }

  const body = await readValidatedBody(event, commitSchema.parse)

  // Verify import exists and belongs to org
  const importRecord = await db.query.candidateImport.findFirst({
    where: and(
      eq(candidateImport.id, importId),
      eq(candidateImport.organizationId, orgId),
    ),
  })

  if (!importRecord) {
    throw createError({ statusCode: 404, statusMessage: 'Import not found' })
  }

  // Atomic status transition: mapped → processing
  // This prevents concurrent commits from both processing the same import
  const [claimed] = await db.update(candidateImport)
    .set({
      status: 'processing',
      duplicatePolicy: body.duplicatePolicy,
      updatedAt: new Date(),
    })
    .where(and(
      eq(candidateImport.id, importId),
      eq(candidateImport.status, 'mapped'),
    ))
    .returning({ id: candidateImport.id })

  if (!claimed) {
    throw createError({
      statusCode: 409,
      statusMessage: `Import cannot be committed (current status: ${importRecord.status})`,
    })
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Get all rows that need processing
      const rowsToProcess = await tx.query.candidateImportRow.findMany({
        where: and(
          eq(candidateImportRow.importId, importId),
          inArray(candidateImportRow.status, ['ready', 'duplicate_existing']),
        ),
        orderBy: (row, { asc }) => [asc(row.rowIndex)],
      })

      let created = 0
      let updated = 0
      let skipped = 0
      let applied = 0

      // Build email → candidateId map for duplicate detection
      const existingCandidates = await tx.query.candidate.findMany({
        where: eq(candidate.organizationId, orgId),
        columns: { id: true, email: true },
      })
      const candidateByEmail = new Map(
        existingCandidates.map((c) => [c.email.toLowerCase().trim(), c.id]),
      )

      for (const row of rowsToProcess) {
        const nd = row.normalizedData
        if (!nd?.email) {
          await tx.update(candidateImportRow)
            .set({ status: 'error', errorMessage: 'Missing email', updatedAt: new Date() })
            .where(eq(candidateImportRow.id, row.id))
          skipped++
          continue
        }

        const email = nd.email.toLowerCase().trim()
        const existingId = candidateByEmail.get(email)
        let candidateId: string

        if (existingId) {
          if (body.duplicatePolicy === 'skip') {
            await tx.update(candidateImportRow)
              .set({ status: 'skipped', updatedAt: new Date() })
              .where(eq(candidateImportRow.id, row.id))
            skipped++
            continue
          } else {
            // Update existing candidate — only overwrite non-empty fields to prevent data loss
            const updatePayload: Record<string, any> = {
              updatedAt: new Date(),
            }
            if (nd.firstName) updatePayload.firstName = nd.firstName
            if (nd.lastName) updatePayload.lastName = nd.lastName
            if (nd.phone) updatePayload.phone = nd.phone
            if (nd.linkedinUrl) updatePayload.linkedinUrl = nd.linkedinUrl
            if (nd.company) updatePayload.company = nd.company
            if (nd.position) updatePayload.position = nd.position
            if (nd.connectedOn) updatePayload.connectedOn = nd.connectedOn
            // Only set source if not already set
            updatePayload.source = 'linkedin'

            await tx.update(candidate)
              .set(updatePayload)
              .where(eq(candidate.id, existingId))
            candidateId = existingId
            updated++
          }
        } else {
          // Create new candidate
          const nameParts = (nd.displayName || '').split(' ')
          const firstName = nd.firstName || nameParts[0] || ''
          const lastName = nd.lastName || nameParts.slice(1).join(' ') || ''

          const [newCandidate] = await tx.insert(candidate).values({
            organizationId: orgId,
            firstName,
            lastName,
            email: nd.email.trim().slice(0, MAX_FIELD_LENGTH),
            phone: nd.phone || null,
            linkedinUrl: nd.linkedinUrl || null,
            company: nd.company || null,
            position: nd.position || null,
            source: 'linkedin',
            connectedOn: nd.connectedOn || null,
          }).returning({ id: candidate.id })

          if (!newCandidate) {
            await tx.update(candidateImportRow)
              .set({ status: 'error', errorMessage: 'Failed to create candidate', updatedAt: new Date() })
              .where(eq(candidateImportRow.id, row.id))
            skipped++
            continue
          }

          candidateId = newCandidate.id
          candidateByEmail.set(email, candidateId)
          created++
        }

        // Mark row as committed
        await tx.update(candidateImportRow)
          .set({ status: 'committed', candidateId, updatedAt: new Date() })
          .where(eq(candidateImportRow.id, row.id))

        // Apply to job if jobId set
        if (importRecord.jobId) {
          const [appResult] = await tx.insert(application).values({
            organizationId: orgId,
            candidateId,
            jobId: importRecord.jobId,
            status: 'new',
          })
            .onConflictDoNothing()
            .returning({ id: application.id })

          if (appResult) applied++
        }
      }

      // Mark error/duplicate_in_file rows as skipped
      await tx.update(candidateImportRow)
        .set({ status: 'skipped', updatedAt: new Date() })
        .where(and(
          eq(candidateImportRow.importId, importId),
          inArray(candidateImportRow.status, ['duplicate_in_file', 'error']),
        ))

      const totalSkipped = skipped + importRecord.duplicateInFileRows + importRecord.errorRows

      // Finalize import
      await tx.update(candidateImport)
        .set({
          status: 'committed',
          createdCount: created,
          updatedCount: updated,
          skippedCount: totalSkipped,
          appliedCount: applied,
          committedAt: new Date(),
          committedById: userId,
          updatedAt: new Date(),
        })
        .where(eq(candidateImport.id, importId))

      return { created, updated, skipped: totalSkipped, applied }
    })

    // Everything below is post-commit and non-fatal.
    // The import has been committed — failures here must NOT mark it as failed.
    let finalRows: any[] = []
    try {
      finalRows = await db.query.candidateImportRow.findMany({
        where: eq(candidateImportRow.importId, importId),
        orderBy: (row, { asc }) => [asc(row.rowIndex)],
        limit: 10,
      })
    } catch {
      // Non-critical — return empty preview
    }

    // Record activity (fire-and-forget, non-critical)
    try {
      recordActivity({
        organizationId: orgId,
        actorId: userId,
        action: 'created',
        resourceType: 'candidate_import',
        resourceId: importId,
        metadata: {
          filename: importRecord.originalFilename,
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          applied: result.applied,
          duplicatePolicy: body.duplicatePolicy,
        },
      })
    } catch {
      // Non-critical
    }

    return {
      result: {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        applied: result.applied,
      },
      preview: {
        job: { id: importRecord.id },
        summary: {
          total: importRecord.totalRows,
          ready: importRecord.readyRows,
          duplicate: importRecord.duplicateRows,
          duplicateInFile: importRecord.duplicateInFileRows,
          error: importRecord.errorRows,
        },
        sampleRows: finalRows.map((r: any) => ({
          id: r.id,
          rowIndex: r.rowIndex,
          rawData: r.rawData,
          normalizedData: r.normalizedData,
          status: r.status,
          errorMessage: r.errorMessage,
        })),
      },
    }
  } catch (err: any) {
    // Mark as failed — use a generic message for the client
    console.error(`Import ${importId} failed:`, err)

    await db.update(candidateImport)
      .set({
        status: 'failed',
        errorMessage: 'Import processing failed. Please try again or contact support.',
        updatedAt: new Date(),
      })
      .where(eq(candidateImport.id, importId))

    throw createError({
      statusCode: 500,
      statusMessage: 'Import failed. Please try again.',
    })
  }
})
