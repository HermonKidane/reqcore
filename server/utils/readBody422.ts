import type { H3Event } from 'h3'
import type { ZodType } from 'zod'

/**
 * readBody + zod safeParse that fails with 422 (not h3's default 400) and a
 * human-readable first-issue message. Use for write-body validation where the
 * API contract specifies 422 (person-model endpoints per design-person-apis.md).
 * Query/param validation keeps h3's getValidatedQuery/getValidatedRouterParams.
 */
export async function readBody422<S extends ZodType>(event: H3Event, schema: S): Promise<ReturnType<S['parse']>> {
  const raw = await readBody(event)
  const result = schema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
    throw createError({
      statusCode: 422,
      statusMessage: `Validation failed: ${where}${issue?.message ?? 'invalid body'}`,
    })
  }
  return result.data as ReturnType<S['parse']>
}
