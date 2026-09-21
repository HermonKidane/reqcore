import { eq, and, asc } from 'drizzle-orm'
import { candidateImport, candidateImportRow } from '../../../../database/schema'

/**
 * GET /api/candidates/import/{id}
 * Get import status and preview rows.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const importId = getRouterParam(event, 'id')
  if (!importId) {
    throw createError({ statusCode: 400, statusMessage: 'Import ID is required' })
  }

  const importRecord = await db.query.candidateImport.findFirst({
    where: and(
      eq(candidateImport.id, importId),
      eq(candidateImport.organizationId, orgId),
    ),
    with: {
      job: { columns: { id: true, title: true, status: true } },
      createdBy: { columns: { id: true, name: true, email: true } },
    },
  })

  if (!importRecord) {
    throw createError({ statusCode: 404, statusMessage: 'Import not found' })
  }

  // Get all rows for preview
  const rows = await db.query.candidateImportRow.findMany({
    where: eq(candidateImportRow.importId, importId),
    orderBy: asc(candidateImportRow.rowIndex),
  })

  return {
    job: {
      id: importRecord.id,
      columns: importRecord.columns,
      mapping: importRecord.mapping,
      status: importRecord.status,
      originalFilename: importRecord.originalFilename,
      totalRows: importRecord.totalRows,
    },
    summary: {
      total: importRecord.totalRows,
      ready: importRecord.readyRows,
      duplicate: importRecord.duplicateRows,
      duplicateInFile: importRecord.duplicateInFileRows,
      error: importRecord.errorRows,
    },
    sampleRows: rows.map((r) => ({
      id: r.id,
      rowIndex: r.rowIndex,
      rawData: r.rawData,
      normalizedData: r.normalizedData,
      status: r.status,
      errorMessage: r.errorMessage,
    })),
    targetJob: importRecord.job,
    candidateProperties: [],
    propertyTypeSuggestions: {},
    createdBy: importRecord.createdBy,
    createdAt: importRecord.createdAt,
    committedAt: importRecord.committedAt,
    results: importRecord.createdCount !== null ? {
      created: importRecord.createdCount,
      updated: importRecord.updatedCount,
      skipped: importRecord.skippedCount,
      applied: importRecord.appliedCount,
    } : null,
  }
})
