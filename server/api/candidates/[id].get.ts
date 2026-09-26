import { eq, and, desc, asc, sql } from 'drizzle-orm'
import { candidate, personRole } from '../../database/schema'
import { candidateIdParamSchema } from '../../utils/schemas/candidate'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  const result = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    with: {
      applications: {
        columns: { id: true, status: true, createdAt: true },
        with: {
          job: {
            columns: { id: true, title: true },
          },
        },
        orderBy: (application, { desc }) => [desc(application.createdAt)],
      },
      documents: {
        columns: { id: true, type: true, originalFilename: true, mimeType: true, createdAt: true },
        orderBy: (document, { desc }) => [desc(document.createdAt)],
      },
      // Multi-email store: primary first. source_detail is provenance — omitted.
      emails: {
        columns: { id: true, email: true, label: true, isPrimary: true, source: true, optOutAt: true },
        orderBy: (email, { desc }) => [desc(email.isPrimary), asc(email.createdAt)],
      },
      // Person roles: active first (startedAt DESC), then ended (endedAt DESC).
      roles: {
        columns: {
          id: true,
          role: true,
          clientCompanyId: true,
          startedAt: true,
          endedAt: true,
        },
        with: {
          clientCompany: { columns: { id: true, name: true } },
        },
        orderBy: (role, { desc }) => [
          sql`case when ${role.endedAt} is null then 0 else 1 end`,
          desc(role.endedAt),
          desc(role.startedAt),
        ],
      },
    },
  })

  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  return result
})
