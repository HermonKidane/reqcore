import { eq, and } from 'drizzle-orm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { candidate } from '../../../database/schema'
import { candidateIdParamSchema } from '../../../utils/schemas/candidate'

/**
 * GET /api/candidates/:id/photo
 *
 * Stream a candidate photo directly through the server for authenticated
 * display (avatars in list + detail). The bytes are proxied from S3/MinIO so
 * the bucket is never exposed publicly and presigned URLs are never issued.
 *
 * Security:
 *   - Auth required, candidate:read permission
 *   - Candidate must belong to the authenticated org (prevents IDOR);
 *     cross-org / missing candidate → 404 (no information leak)
 *   - No photoKey → 404; the raw key is never returned by any API
 *   - Cache-Control: private — browser cache only, no shared caches
 *   - X-Content-Type-Options: nosniff — serve only as an image
 */

// Content type derived from the stored key extension (validated at capture)
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  // Query scoped by BOTH id AND organizationId — prevents IDOR
  const [row] = await db
    .select({ photoKey: candidate.photoKey })
    .from(candidate)
    .where(and(eq(candidate.id, id), eq(candidate.organizationId, orgId)))
    .limit(1)

  if (!row || !row.photoKey) {
    throw createError({ statusCode: 404, statusMessage: 'Photo not found' })
  }

  const ext = row.photoKey.split('.').pop()?.toLowerCase() ?? ''
  const contentType = CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream'

  let s3Response
  try {
    s3Response = await s3Client.send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: row.photoKey,
      }),
    )
  }
  catch {
    throw createError({ statusCode: 404, statusMessage: 'Photo not found' })
  }

  if (!s3Response.Body) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to retrieve photo' })
  }

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  }

  // Forward Content-Length from S3
  if (s3Response.ContentLength) {
    headers['Content-Length'] = String(s3Response.ContentLength)
  }

  setResponseHeaders(event, headers)

  // Stream the S3 body to the response — no presigned URLs exposed
  return s3Response.Body.transformToWebStream()
})
