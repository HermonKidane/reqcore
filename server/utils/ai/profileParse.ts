import { z } from 'zod'
import { selectProvider, type AiGenerateResult, type AiRuntimeConfig } from './provider'

/**
 * AI profile-page parsing for the extension capture flow (design §10,
 * "People-Match AI" style): the extension sends the visible text of ONE
 * profile page; the server extracts structured fields with the org's BYOK
 * AI config and merges them into the capture (explicit extension fields
 * win — see the capture endpoint).
 *
 * Contract:
 * - Returns the validated object, or null on ANY failure (misconfigured
 *   provider, provider error, bad JSON, schema mismatch). The caller
 *   decides whether missing names are a hard 422.
 * - Never stores pageText; the only log line on failure is
 *   `[Reqcore] profile parse failed: <reason>` — NEVER page text.
 * - 30 s provider timeout via AbortSignal.timeout, combined with the
 *   caller's request signal when given.
 */

export const PROFILE_PARSE_STEP_KEY = 'profile-parse'

/** Max page text sent to the provider (input safety). */
const MAX_PAGE_TEXT_CHARS = 60_000
/** Provider call timeout. */
const PARSE_TIMEOUT_MS = 30_000

/**
 * Output contract — same length limits as extensionCaptureSchema. Facts the
 * model cannot find on the page must be OMITTED, not invented.
 */
export const profileParseExperienceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  company: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  startText: z.string().trim().max(50).optional(),
  endText: z.string().trim().max(50).optional(),
  isCurrent: z.boolean().optional(),
  description: z.string().trim().max(4000).optional(),
})

export const profileParseSchema = z.object({
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().min(1).max(200),
  headline: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  /** Current employer, if shown on the page. */
  company: z.string().trim().max(200).optional(),
  /** Current role title, if shown on the page. */
  position: z.string().trim().max(200).optional(),
  /** Page order, newest first; at most 30 entries. */
  experiences: z.array(profileParseExperienceSchema).max(30).optional(),
})

export type ProfileParseResult = z.infer<typeof profileParseSchema>

/**
 * System prompt (locked with the capture merge rule): extract ONE person's
 * public profile from scraped page text. Output ONLY JSON matching the
 * schema; never invent facts; ignore content about other people.
 */
export const PROFILE_PARSE_SYSTEM_PROMPT = `You extract a person's public profile from the text of a web page (a LinkedIn-style profile page).

Output rules:
- Output ONLY a single JSON object matching the requested schema. No markdown, no commentary, no code fences.
- Use ONLY facts that are present in the page text. NEVER invent or guess a value.
- Omit any field you cannot find in the text — do not return empty strings or placeholders.
- The page is ONE person's profile. Ignore any text about other people: sidebars and modules such as "People also viewed", "More profiles for you", "People you may know", "You might like", promoted content and ads. Never extract names, jobs or companies from those sections.
- Keep experiences in the order they appear on the page (newest first, as profiles are displayed).
- Return at most 30 experiences.
- Dates must be copied EXACTLY as shown on the page (e.g. "Jan 2020", "Present"). Do not reformat or compute durations.
- "company" and "position" refer to the person's CURRENT role when discernible from the page; otherwise omit them.
- "headline" is the short descriptive line shown directly under the person's name, when present.`

function parseFail(reason: string): null {
  // One line, reason only — NEVER page text or provider payloads.
  console.error(`[Reqcore] profile parse failed: ${reason}`)
  return null
}

function stripCodeFences(text: string): string {
  let raw = text.trim()
  if (raw.startsWith('```')) {
    raw = raw
      .replace(/^```[a-zA-Z]*\s*/, '')
      .replace(/```\s*$/, '')
      .trim()
  }
  return raw
}

/**
 * Parse visible profile-page text into validated fields using the same
 * runtime AI config as the workflow AI service (env first, runtimeConfig
 * fallback). 'misconfigured' → null (fail-closed, never mock-on-misconfig).
 * With no key configured the mock provider serves a deterministic
 * heuristic result so e2e works without a key (see provider.ts).
 */
export async function parseProfileText(params: {
  pageText: string
  pageUrl?: string | undefined
  /** Caller-side abort (e.g. request teardown); combined with the 30 s timeout. */
  signal?: AbortSignal | undefined
}): Promise<ProfileParseResult | null> {
  const { pageText, pageUrl, signal } = params

  // Same config source as server/api/step-instances/[id]/ai-runs.post.ts.
  const runtimeConfig = useRuntimeConfig() as unknown as AiRuntimeConfig
  const config: AiRuntimeConfig = {
    aiBaseUrl: process.env.AI_BASE_URL || runtimeConfig.aiBaseUrl,
    aiApiKey: process.env.AI_API_KEY || runtimeConfig.aiApiKey,
    aiModel: process.env.AI_MODEL || runtimeConfig.aiModel,
  }

  const selection = selectProvider(config)
  if (selection.kind === 'misconfigured') {
    return parseFail('AI provider misconfigured')
  }

  const timeout = AbortSignal.timeout(PARSE_TIMEOUT_MS)
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout

  const text = pageText.slice(0, MAX_PAGE_TEXT_CHARS)
  const userPrompt = `Page URL: ${pageUrl ?? 'unknown'}\n\nPage text:\n${text}`

  let result: AiGenerateResult
  try {
    result = await selection.provider.generate({
      systemPrompt: PROFILE_PARSE_SYSTEM_PROMPT,
      userPrompt,
      model: selection.model,
      stepKey: PROFILE_PARSE_STEP_KEY,
      signal: combinedSignal,
    })
  }
  catch (err: any) {
    return parseFail(String(err?.message ?? err).slice(0, 200))
  }

  let json: unknown
  try {
    json = JSON.parse(stripCodeFences(result.text))
  }
  catch {
    return parseFail('provider output was not valid JSON')
  }

  const validated = profileParseSchema.safeParse(json)
  if (!validated.success) {
    const first = validated.error.issues[0]
    const where = first?.path?.join('.') || '(root)'
    return parseFail(`schema validation failed at ${where}: ${first?.message ?? 'unknown issue'}`)
  }

  return validated.data
}
