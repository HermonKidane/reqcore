import { eq, and } from 'drizzle-orm'
import { candidateImport, candidateImportRow, candidate, job } from '../../../database/schema'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_ROWS = 5000
const MAX_COLUMNS = 100
const MAX_FIELD_LENGTH = 2000

/**
 * POST /api/candidates/import
 * Upload a CSV file for candidate import.
 * Multipart form: file (CSV), optional jobId
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  // Parse multipart form
  const formData = await readMultipartFormData(event)
  if (!formData || formData.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No file uploaded' })
  }

  const filePart = formData.find((part) => part.name === 'file')
  const jobIdPart = formData.find((part) => part.name === 'jobId')

  if (!filePart || !filePart.data) {
    throw createError({ statusCode: 400, statusMessage: 'No file provided' })
  }

  // Enforce file size limit
  if (filePart.data.length > MAX_FILE_SIZE) {
    throw createError({
      statusCode: 413,
      statusMessage: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    })
  }

  const filename = filePart.filename || 'unknown.csv'
  if (!filename.toLowerCase().endsWith('.csv')) {
    throw createError({ statusCode: 400, statusMessage: 'File must be a CSV' })
  }

  const jobId = jobIdPart?.data?.toString() || null

  // Validate jobId if provided
  if (jobId) {
    const targetJob = await db.query.job.findFirst({
      where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
      columns: { id: true },
    })
    if (!targetJob) {
      throw createError({ statusCode: 404, statusMessage: 'Target job not found' })
    }
  }

  // Parse CSV
  const csvText = filePart.data.toString('utf-8')
  const { columns, rows: dataRows } = parseCSV(csvText)

  if (dataRows.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'CSV must have at least one data row' })
  }

  if (dataRows.length > MAX_ROWS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Too many rows. Maximum is ${MAX_ROWS} rows per import.`,
    })
  }

  if (columns.length > MAX_COLUMNS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Too many columns. Maximum is ${MAX_COLUMNS} columns.`,
    })
  }

  // Truncate long field values
  const truncatedRows = dataRows.map((row) => {
    const truncated: Record<string, string> = {}
    for (const [key, value] of Object.entries(row)) {
      truncated[key] = value.slice(0, MAX_FIELD_LENGTH)
    }
    return truncated
  })

  // Create import record + rows in a transaction
  const importRecord = await db.transaction(async (tx) => {
    const [record] = await tx.insert(candidateImport).values({
      organizationId: orgId,
      createdById: userId,
      jobId,
      originalFilename: filename.slice(0, 255),
      fileSizeBytes: filePart!.data!.length,
      columns,
      status: 'uploaded',
      totalRows: truncatedRows.length,
    }).returning()

    if (!record) {
      throw createError({ statusCode: 500, statusMessage: 'Failed to create import record' })
    }

    // Get existing candidate emails for duplicate detection
    const existingCandidates = await tx.query.candidate.findMany({
      where: eq(candidate.organizationId, orgId),
      columns: { email: true },
    })
    const existingEmails = new Set(existingCandidates.map((c) => c.email.toLowerCase().trim()))

    // O(n) duplicate detection using a Set
    const seenInFile = new Set<string>()
    const autoNormalized = truncatedRows.map((rawData) => extractNormalizedData(rawData))

    const rowsToInsert = truncatedRows.map((rawData, idx) => {
      const nd = autoNormalized[idx]
      const email = nd.email?.toLowerCase().trim() || ''

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

      return {
        organizationId: orgId,
        importId: record.id,
        rowIndex: idx,
        rawData,
        normalizedData: nd,
        status,
        errorMessage,
      }
    })

    await tx.insert(candidateImportRow).values(rowsToInsert)

    const stats = {
      readyRows: rowsToInsert.filter((r) => r.status === 'ready').length,
      duplicateRows: rowsToInsert.filter((r) => r.status === 'duplicate_existing').length,
      duplicateInFileRows: rowsToInsert.filter((r) => r.status === 'duplicate_in_file').length,
      errorRows: rowsToInsert.filter((r) => r.status === 'error').length,
    }

    await tx.update(candidateImport)
      .set(stats)
      .where(eq(candidateImport.id, record.id))

    return record
  })

  // Fetch sample rows (first 10) — outside transaction
  const sampleRows = await db.query.candidateImportRow.findMany({
    where: eq(candidateImportRow.importId, importRecord.id),
    orderBy: (row, { asc }) => [asc(row.rowIndex)],
    limit: 10,
  })

  // Auto-suggest mapping
  const autoMapping = suggestMapping(columns)

  return {
    job: {
      id: importRecord.id,
      columns,
      mapping: autoMapping,
    },
    summary: {
      total: truncatedRows.length,
      ready: sampleRows.filter((r) => r.status === 'ready').length,
      duplicate: sampleRows.filter((r) => r.status === 'duplicate_existing').length,
      duplicateInFile: sampleRows.filter((r) => r.status === 'duplicate_in_file').length,
      error: sampleRows.filter((r) => r.status === 'error').length,
    },
    sampleRows: sampleRows.map((r) => ({
      id: r.id,
      rowIndex: r.rowIndex,
      rawData: r.rawData,
      normalizedData: r.normalizedData,
      status: r.status,
      errorMessage: r.errorMessage,
    })),
    targetJob: jobId ? { id: jobId } : null,
    candidateProperties: [],
    propertyTypeSuggestions: suggestPropertyTypes(columns),
  }
})

/**
 * Robust CSV parser supporting quoted fields, embedded commas, and escaped quotes.
 * Handles multiline quoted fields correctly.
 */
function parseCSV(text: string): { columns: string[]; rows: Record<string, string>[] } {
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1)
  }

  const records: string[][] = []
  let currentField = ''
  let currentRecord: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          currentField += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        currentField += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        currentRecord.push(currentField.trim())
        currentField = ''
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[i + 1] === '\n') i++ // skip \r\n
        currentRecord.push(currentField.trim())
        currentField = ''
        if (currentRecord.some((f) => f !== '')) {
          records.push(currentRecord)
        }
        currentRecord = []
      } else {
        currentField += char
      }
    }
  }

  // Handle last record if file doesn't end with newline
  if (currentField || currentRecord.length > 0) {
    currentRecord.push(currentField.trim())
    if (currentRecord.some((f) => f !== '')) {
      records.push(currentRecord)
    }
  }

  if (records.length < 2) {
    return { columns: records[0] || [], rows: [] }
  }

  const rawColumns = records[0]

  // Deduplicate and sanitize column names
  const seen = new Map<string, number>()
  const columns = rawColumns.map((col, idx) => {
    let name = col || `Column_${idx + 1}`
    const count = seen.get(name) || 0
    seen.set(name, count + 1)
    return count === 0 ? name : `${name}_${count + 1}`
  })

  // Parse data rows
  const rows = records.slice(1).map((record) => {
    const row: Record<string, string> = {}
    columns.forEach((col, idx) => {
      row[col] = record[idx] || ''
    })
    return row
  })

  return { columns, rows }
}

function extractNormalizedData(rawData: Record<string, string>) {
  const get = (...keys: string[]) => {
    for (const key of keys) {
      // Case-insensitive lookup
      const lowerKey = key.toLowerCase()
      for (const [k, v] of Object.entries(rawData)) {
        if (k.toLowerCase().trim() === lowerKey && v?.trim()) return v.trim()
      }
    }
    return undefined
  }

  const email = get('Email', 'E-mail', 'E-mail Address', 'email')
  const firstName = get('First Name', 'FirstName', 'first_name', 'First', 'Given Name', 'GivenName')
  const lastName = get('Last Name', 'LastName', 'last_name', 'Last', 'Family Name', 'Surname')
  const fullName = get('Full Name', 'FullName', 'full_name', 'Name')
  const displayName = get('Display Name', 'DisplayName', 'display_name')
  const phone = get('Phone', 'phone', 'Phone Number', 'Mobile', 'Telephone')

  return {
    email,
    firstName,
    lastName,
    displayName: displayName || fullName,
    phone,
  }
}

function suggestMapping(columns: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  const lowerMap: Record<string, string> = {}

  const fieldAliases: Record<string, string[]> = {
    email: ['email', 'e-mail', 'e-mail address'],
    firstName: ['first name', 'firstname', 'first_name', 'first', 'given name', 'givenname'],
    lastName: ['last name', 'lastname', 'last_name', 'last', 'family name', 'surname'],
    displayName: ['display name', 'displayname', 'full name', 'fullname', 'name'],
    phone: ['phone', 'phone number', 'mobile', 'telephone'],
  }

  for (const [field, aliases] of Object.entries(fieldAliases)) {
    for (const alias of aliases) {
      lowerMap[alias] = field
    }
  }

  for (const col of columns) {
    const lower = col.toLowerCase().trim()
    if (lowerMap[lower]) {
      mapping[col] = lowerMap[lower]
    } else {
      mapping[col] = ''
    }
  }

  return mapping
}

function suggestPropertyTypes(columns: string[]): Record<string, string> {
  const suggestions: Record<string, string> = {}
  for (const col of columns) {
    const lower = col.toLowerCase()
    if (lower.includes('date') || lower.includes('dob') || lower.includes('birth')) {
      suggestions[col] = 'date'
    } else if (lower.includes('url') || lower.includes('link') || lower.includes('website')) {
      suggestions[col] = 'url'
    } else if (lower.includes('email')) {
      suggestions[col] = 'email'
    } else if (lower.includes('phone') || lower.includes('number') || lower.includes('age')) {
      suggestions[col] = 'number'
    } else if (lower.includes('note') || lower.includes('comment') || lower.includes('description')) {
      suggestions[col] = 'long_text'
    } else {
      suggestions[col] = 'text'
    }
  }
  return suggestions
}
