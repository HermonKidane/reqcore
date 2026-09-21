import { eq, and, inArray } from 'drizzle-orm'
import { candidateImport, candidateImportRow, candidate } from '../../../../../database/schema'
import { z } from 'zod'

const mappingSchema = z.object({
  mapping: z.record(z.string(), z.string()),
})

const VALID_TARGETS = new Set([
  'email', 'firstName', 'lastName', 'displayName', 'phone', 'ignore', '',
])

/**
 * PUT /api/candidates/import/{id}/mapping
 * Save field mapping for the import.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId

  const importId = getRouterParam(event, 'id')
  if (!importId) {
    throw createError({ statusCode: 400, statusMessage: 'Import ID is required' })
  }

  const body = await readValidatedBody(event, mappingSchema.parse)

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

  // Only allow mapping in uploaded or mapped status (not processing/committed/failed)
  if (!['uploaded', 'mapped'].includes(importRecord.status)) {
    throw createError({
      statusCode: 409,
      statusMessage: `Cannot modify mapping when import status is "${importRecord.status}"`,
    })
  }

  // Validate mapping keys match actual columns
  const validColumns = new Set(importRecord.columns)
  for (const column of Object.keys(body.mapping)) {
    if (!validColumns.has(column)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Mapping key "${column}" does not match any CSV column`,
      })
    }
  }

  // Validate mapping targets
  for (const [column, target] of Object.entries(body.mapping)) {
    if (!VALID_TARGETS.has(target)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid mapping target "${target}" for column "${column}". Valid targets: ${[...VALID_TARGETS].filter(Boolean).join(', ')}`,
      })
    }
  }

  // Ensure email is mapped
  const hasEmailMapping = Object.values(body.mapping).includes('email')
  if (!hasEmailMapping) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Email column must be mapped',
    })
  }

  // Atomic transition: uploaded → mapped
  const [claimed] = await db.update(candidateImport)
    .set({
      mapping: body.mapping,
      status: 'mapped',
      updatedAt: new Date(),
    })
    .where(and(
      eq(candidateImport.id, importId),
      inArray(candidateImport.status, ['uploaded', 'mapped']),
    ))
    .returning({ id: candidateImport.id })

  if (!claimed) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Import status changed concurrently. Please refresh and try again.',
    })
  }

  // Re-normalize rows and update stats in a transaction
  const stats = await db.transaction(async (tx) => {
    const rows = await tx.query.candidateImportRow.findMany({
      where: eq(candidateImportRow.importId, importId),
      orderBy: (row, { asc }) => [asc(row.rowIndex)],
    })

    // Get existing candidate emails for duplicate detection
    const existingCandidates = await tx.query.candidate.findMany({
      where: eq(candidate.organizationId, orgId),
      columns: { email: true },
    })
    const existingEmails = new Set(existingCandidates.map((c) => c.email.toLowerCase().trim()))

    const seenInFile = new Set<string>()

    for (const row of rows) {
      const normalized = applyMapping(row.rawData, body.mapping)
      const email = normalized.email?.toLowerCase().trim() || ''

      let status: 'ready' | 'duplicate_existing' | 'duplicate_in_file' | 'error' = 'ready'
      let errorMessage: string | undefined

      if (!email) {
        status = 'error'
        errorMessage = 'Email is required'
      } else if (seenInFile.has(email)) {
        status = 'duplicate_in_file'
      } else if (existingEmails.has(email)) {
        status = 'duplicate_existing'
      }

      if (email) seenInFile.add(email)

      await tx.update(candidateImportRow)
        .set({ normalizedData: normalized, status, errorMessage, updatedAt: new Date() })
        .where(eq(candidateImportRow.id, row.id))
    }

    // Count statuses
    const updatedRows = await tx.query.candidateImportRow.findMany({
      where: eq(candidateImportRow.importId, importId),
      columns: { status: true },
    })

    return {
      readyRows: updatedRows.filter((r) => r.status === 'ready').length,
      duplicateRows: updatedRows.filter((r) => r.status === 'duplicate_existing').length,
      duplicateInFileRows: updatedRows.filter((r) => r.status === 'duplicate_in_file').length,
      errorRows: updatedRows.filter((r) => r.status === 'error').length,
    }
  })

  await db.update(candidateImport)
    .set(stats)
    .where(eq(candidateImport.id, importId))

  // Return updated import
  const updated = await db.query.candidateImport.findFirst({
    where: eq(candidateImport.id, importId),
  })

  const sampleRows = await db.query.candidateImportRow.findMany({
    where: eq(candidateImportRow.importId, importId),
    orderBy: (row, { asc }) => [asc(row.rowIndex)],
    limit: 10,
  })

  return {
    job: {
      id: updated!.id,
      columns: updated!.columns,
      mapping: updated!.mapping,
    },
    summary: {
      total: updated!.totalRows,
      ready: stats.readyRows,
      duplicate: stats.duplicateRows,
      duplicateInFile: stats.duplicateInFileRows,
      error: stats.errorRows,
    },
    sampleRows: sampleRows.map((r) => ({
      id: r.id,
      rowIndex: r.rowIndex,
      rawData: r.rawData,
      normalizedData: r.normalizedData,
      status: r.status,
      errorMessage: r.errorMessage,
    })),
    targetJob: updated!.jobId ? { id: updated!.jobId } : null,
    candidateProperties: [],
    propertyTypeSuggestions: {},
  }
})

function applyMapping(
  rawData: Record<string, string>,
  mapping: Record<string, string>,
): {
  email?: string
  firstName?: string
  lastName?: string
  displayName?: string
  phone?: string
} {
  const result: Record<string, string | undefined> = {}

  for (const [column, target] of Object.entries(mapping)) {
    if (target === 'ignore' || target === '') continue

    const value = rawData[column]?.trim()
    if (value) {
      result[target] = value
    }
  }

  // Build displayName from first+last if not explicitly mapped
  if (!result.displayName && result.firstName && result.lastName) {
    result.displayName = `${result.firstName} ${result.lastName}`
  }

  return {
    email: result.email,
    firstName: result.firstName,
    lastName: result.lastName,
    displayName: result.displayName,
    phone: result.phone,
  }
}
