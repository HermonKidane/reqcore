import { promisify } from 'node:util'
import { inflateRaw } from 'node:zlib'
import { fileTypeFromBuffer } from 'file-type'
import mammoth from 'mammoth'
import { getDocumentProxy } from 'unpdf'
import { z } from 'zod'
import { parseProfileText } from '../../utils/ai/profileParse'
import { extractContacts } from '../../utils/cvContacts'
import { MAX_FILE_SIZE, sanitizeFilename } from '../../utils/schemas/document'
import { CV_PARSE_TEXT_MAX, CV_PARSE_TEXT_MIN, parseCandidateTextSchema } from '../../utils/schemas/candidate'
import { dedupeSkills } from '../../utils/skills'
import { normalisePhone } from '~~/shared/phone'

/**
 * POST /api/candidates/parse
 *
 * Reads a CV (or pasted text) and returns form values for Add Candidate.
 * Accepts EITHER JSON `{ text }` (50–60,000 chars) OR multipart with one
 * `file` (PDF, DOCX or plain text, max 10 MB, type from magic bytes).
 *
 * Privacy (house rule for AI calls): email, phone and LinkedIn URL are read
 * HERE by extractContacts(); the model gets the redacted text only (pattern
 * matching, best effort), and any email / phone it returns is thrown away.
 *
 * Files are bounded before they are read: a .docx may unpack to at most
 * 40 MB, a PDF is read up to 40 pages / 15 s / the text limit.
 *
 * Read-only: nothing is written to the database or to storage, and neither
 * the text nor the file is logged. The form uploads the file to the new
 * profile itself, after the person is saved.
 */

const parseLimiter = createRateLimiter({
  windowMs: 10 * 60_000,
  maxRequests: 20,
  message: 'You have read a lot of CVs in a short time. Please wait a few minutes and try again.',
})

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const OLE2_MAGIC = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])

const UNREADABLE_FILE = 'We couldn\'t read any text in that file. It may be a scanned image. Paste the text instead.'
const WRONG_TYPE = 'That file type can\'t be read. Use a PDF, a Word .docx file or a plain text file.'

const emailRule = z.string().trim().max(255).email()

const PDF_MAX_PAGES = 40
const PDF_MAX_MS = 15_000
const DOCX_MAX_UNPACKED = 40 * 1024 * 1024
const DOCX_MAX_ENTRIES = 2000

const inflateRawAsync = promisify(inflateRaw)

/** Page by page, so a huge PDF stops at the page / time / text limit instead of being read whole. */
async function pdfToText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  try {
    const deadline = Date.now() + PDF_MAX_MS
    const pages: string[] = []
    let length = 0
    for (let n = 1; n <= Math.min(pdf.numPages, PDF_MAX_PAGES); n++) {
      const content = await (await pdf.getPage(n)).getTextContent()
      const pageText = content.items
        .map(item => 'str' in item && item.str != null ? item.str + (item.hasEOL ? '\n' : '') : '')
        .join('')
      pages.push(pageText)
      length += pageText.length
      if (length >= CV_PARSE_TEXT_MAX || Date.now() > deadline) break
    }
    // Same clean-up as unpdf's mergePages: keep line breaks, at most one blank line.
    return pages.join('\n').replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n')
  }
  finally {
    // Frees the parsed document (the method exists at runtime; unpdf's types leave it out)
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => {})
  }
}

/**
 * A .docx is a zip. Unpack every entry ourselves with a hard cap first, so a
 * small file that unpacks to gigabytes is refused before mammoth (which has no
 * cap) sees it. Reads the same central directory mammoth's zip reader uses.
 */
async function assertDocxUnpacksSmall(buffer: Buffer): Promise<void> {
  const fail = () => new Error('docx zip check failed')
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xFFFF); i--) {
    if (buffer.readUInt32LE(i) === 0x06054B50) { eocd = i; break }
  }
  if (eocd < 0) throw fail()
  const entries = buffer.readUInt16LE(eocd + 10)
  let at = buffer.readUInt32LE(eocd + 16)
  if (entries > DOCX_MAX_ENTRIES || entries === 0xFFFF || at === 0xFFFFFFFF) throw fail()

  let budget = DOCX_MAX_UNPACKED
  for (let n = 0; n < entries; n++) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== 0x02014B50) throw fail()
    const method = buffer.readUInt16LE(at + 10)
    const packed = buffer.readUInt32LE(at + 20)
    const local = buffer.readUInt32LE(at + 42)
    if (packed === 0xFFFFFFFF || local === 0xFFFFFFFF) throw fail()
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034B50) throw fail()
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
    if (start + packed > buffer.length) throw fail()
    if (method === 0) {
      budget -= packed
    }
    else if (method === 8) {
      // Throws when the entry would unpack past what is left of the budget
      const out = await inflateRawAsync(buffer.subarray(start, start + packed), { maxOutputLength: Math.max(budget, 1) })
      budget -= out.length
    }
    else {
      throw fail()
    }
    if (budget <= 0) throw fail()
    at += 46 + buffer.readUInt16LE(at + 28) + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32)
  }
}

async function docxToText(buffer: Buffer): Promise<string> {
  await assertDocxUnpacksSmall(buffer)
  const { value } = await mammoth.extractRawText({ buffer })
  return value
}

/** Plain text = valid UTF-8 with no NUL bytes. */
function plainText(buffer: Buffer): string | null {
  if (buffer.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  }
  catch {
    return null
  }
}

async function fileToText(buffer: Buffer, filename: string): Promise<string> {
  const detected = await fileTypeFromBuffer(buffer)
  const mime = detected?.mime

  // Old binary Word (OLE2). file-type reports it as 'application/x-cfb', so check the magic bytes directly.
  if (buffer.length >= 8 && Buffer.compare(buffer.subarray(0, 8), OLE2_MAGIC) === 0) {
    throw createError({ statusCode: 415, statusMessage: 'Old .doc files can\'t be read. Save it as PDF or .docx and try again.' })
  }

  try {
    if (mime === PDF_MIME) return await pdfToText(buffer)
    // Some .docx files are only recognised as a plain zip — let mammoth decide.
    if (mime === DOCX_MIME || (mime === 'application/zip' && /\.docx$/i.test(filename))) return await docxToText(buffer)
  }
  catch {
    // Reason only — never the file or its text.
    console.error('[Reqcore] cv parse: text extraction failed')
    throw createError({ statusCode: 422, statusMessage: UNREADABLE_FILE })
  }

  if (!mime) {
    const text = plainText(buffer)
    if (text !== null) return text
  }

  throw createError({ statusCode: 415, statusMessage: WRONG_TYPE })
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })

  await parseLimiter(event, `cv-parse:${session.user.id}`)

  let text: string
  let source: 'file' | 'text'
  let filename: string | undefined

  const contentType = getHeader(event, 'content-type') ?? ''
  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    const formData = await readMultipartFormData(event)
    const filePart = formData?.find((part) => part.name === 'file')
    if (!filePart || !filePart.data || filePart.data.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'No file provided' })
    }
    if (filePart.data.length > MAX_FILE_SIZE) {
      throw createError({
        statusCode: 413,
        statusMessage: `That file is too big. The limit is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
      })
    }
    filename = sanitizeFilename(filePart.filename ?? 'cv')
    source = 'file'
    text = (await fileToText(filePart.data, filename)).slice(0, CV_PARSE_TEXT_MAX)
    if (text.trim().length < CV_PARSE_TEXT_MIN) {
      throw createError({ statusCode: 422, statusMessage: UNREADABLE_FILE })
    }
  }
  else {
    const body = await readBody422(event, parseCandidateTextSchema)
    source = 'text'
    text = body.text
    if (text.trim().length < CV_PARSE_TEXT_MIN) {
      throw createError({ statusCode: 422, statusMessage: `Validation failed: text: Paste at least ${CV_PARSE_TEXT_MIN} characters` })
    }
  }

  // Contact details are read locally; the model gets the redacted text only.
  const contacts = extractContacts(text)
  const email = contacts.email && emailRule.safeParse(contacts.email).success ? contacts.email.trim() : null
  const phone = contacts.phone ? normalisePhone(contacts.phone) : null
  const linkedinUrl = contacts.linkedinUrl ?? null

  const parsed = await parseProfileText({ pageText: contacts.redactedText, pageUrl: 'cv-upload', kind: 'cv' })

  if (!parsed && !email && !phone && !linkedinUrl) {
    throw createError({ statusCode: 502, statusMessage: 'Couldn\'t read that CV automatically. You can still type the details.' })
  }

  return {
    fields: {
      firstName: parsed?.firstName ?? null,
      // '-' is the parser's placeholder for "no last name found"
      lastName: parsed?.lastName && parsed.lastName !== '-' ? parsed.lastName : null,
      // ONLY from the local extraction — parsed.email / parsed.phone are never used
      email,
      phone,
      linkedinUrl,
      position: parsed?.position ?? null,
      company: parsed?.company ?? null,
      location: parsed?.location ?? null,
      headline: parsed?.headline ?? null,
      summary: parsed?.summary ?? null,
    },
    skills: dedupeSkills(parsed?.skills ?? []).map((skill) => skill.name),
    experiences: parsed?.experiences ?? [],
    education: parsed?.education ?? [],
    source,
    ...(filename ? { filename } : {}),
    ...(parsed ? {} : { aiUnavailable: true }),
  }
})
