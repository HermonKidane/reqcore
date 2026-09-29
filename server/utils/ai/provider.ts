/**
 * AI provider adapter (design-ai-slice.md §2, locked).
 *
 * One shipped implementation: OpenAI-compatible `POST {baseUrl}/chat/completions`
 * with `Authorization: Bearer`. Covers the direct Google key (Google's
 * OpenAI-compat endpoint) and naga; an Anthropic-compatible implementation
 * is adapter-shaped for later.
 *
 * Mock mode is used ONLY when AI_API_KEY is explicitly unset (the safe
 * default: no key → no external calls). The fail-closed rule lives in the
 * service: when a key IS set but AI_BASE_URL is missing/unparseable the run
 * fails with 'AI provider misconfigured' — NEVER a silent mock fallback.
 *
 * Mock canned output uses the NEW step-5 shape (`pitchScript`,
 * `packageBullets`, `objectionRehearsal`) per the prompt-templates draft
 * §0.2 — keep in sync with `shared/recruitment/ai-prompts.ts` and the
 * e2e key assertions.
 */

export interface AiGenerateOptions {
  systemPrompt: string
  userPrompt: string
  model: string
  /** Step key — lets the mock return deterministic per-step output. */
  stepKey: string
  signal: AbortSignal
}

export interface AiGenerateResult {
  text: string
  raw: unknown
}

export interface AiProvider {
  /** Provider identifier stored on the run row ('openai-compat' | 'mock'). */
  provider: string
  generate: (opts: AiGenerateOptions) => Promise<AiGenerateResult>
}

export class OpenAiCompatProvider implements AiProvider {
  readonly provider = 'openai-compat'

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async generate(opts: AiGenerateOptions): Promise<AiGenerateResult> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        signal: opts.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: 'system', content: opts.systemPrompt },
            { role: 'user', content: opts.userPrompt },
          ],
        }),
      })
    }
    catch (err: any) {
      if (err?.name === 'AbortError') throw new Error('AI provider request timed out')
      throw new Error(`AI provider request failed: ${String(err?.message ?? err)}`)
    }

    if (!res.ok) {
      // Sanitised error: status + message only — never headers/keys.
      let message = res.statusText
      try {
        const body = await res.json()
        message = body?.error?.message ?? message
      }
      catch { /* non-JSON error body — keep statusText */ }
      throw new Error(`AI provider error ${res.status}: ${message}`)
    }

    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || text === '') {
      throw new Error('AI provider returned an empty response')
    }
    return { text, raw: data }
  }
}

/**
 * Deterministic canned output per stepKey (mock mode / e2e).
 *
 * v2 compliance (design reviews 2026-09-29, findings 9/10/12):
 * - The step-5 output is NEUTRAL and rule-compliant: no invented social
 *   proof, no banned softeners, no hype, no ask after a second refusal.
 * - spokenWordCount is RECOUNTED from the script (countSpokenWords) —
 *   never a made-up number; each [CONFIRM: …] counts as 3 words.
 * - Steps 11 and 20 are POPULATED with fields the e2e tone helper reads;
 *   empty arrays would let the tone net scan nothing and pass vacuously.
 * Keep in sync with `shared/recruitment/ai-prompts.ts` and the
 * e2e key assertions.
 */

/**
 * Words the consultant speaks: cue markers "(PAUSE)"/"(warm)" and bare
 * punctuation tokens don't count; each "[CONFIRM: …]" placeholder counts
 * as 3 words (it resolves to real spoken words the cap must see).
 * Mirrors e2e/helpers/tone.ts — keep the two in sync.
 */
export function countSpokenWords(script: string): number {
  const tokens = script
    .replace(/\[CONFIRM:[^\]]*\]/g, ' ␟ ')
    .split(/\s+/)
    .filter(t => t.length > 0)
  let words = 0
  let confirms = 0
  for (const t of tokens) {
    if (t === '␟') { confirms += 1; continue }
    if (/^\(.*\)$/.test(t)) continue // cue marker
    if (/^[—–\-•]$/.test(t)) continue
    words += 1
  }
  return words + confirms * 3
}

const MOCK_STEP5_SCRIPT = 'Hi [CONFIRM: first name], I understand you work in [CONFIRM: specialism]? (PAUSE) I work for [CONFIRM: firm description and location], recruiting in [CONFIRM: sector]. I\'m calling to arrange a short call, at a time that suits you, to outline a role. (PAUSE) Would tomorrow at 1pm or 6pm work, or is another time better?'

const MOCK_STEP5 = {
  pitchScript: {
    script: MOCK_STEP5_SCRIPT,
    spokenWordCount: countSpokenWords(MOCK_STEP5_SCRIPT),
    estimatedSeconds: 32,
    confirmBeforeUse: ['first name', 'specialism', 'firm description and location', 'sector', 'who leads the search', 'why them'],
    doNotCallReason: null,
  },
  packageBullets: [] as unknown[],
  objectionRehearsal: [
    {
      objection: 'I\'m not interested',
      keyLine: null,
      softener: 'OK, I hear you',
      labels: ['Seems like now is a bad time to be called at work'],
      mirror: '…not interested?',
      afterPause: 'Listen for any specific reason — it becomes follow-up material.',
      exitLine: 'No problem at all — thank you for your time. If it\'s easier, I can text first so you know who\'s calling. Either way, your preference will be respected.',
    },
    {
      objection: 'I\'m happy where I am',
      keyLine: null,
      softener: 'Makes sense',
      labels: ['Sounds like you\'re loyal to your current firm'],
      mirror: '…happy where you are?',
      afterPause: 'Note what specifically keeps them happy — a benchmark for the role on offer.',
      exitLine: 'Fair enough — may I call at a quieter time, or would a text be better? Either way, your preference will be respected.',
    },
    {
      objection: 'I\'m too busy',
      keyLine: null,
      softener: 'That\'s reasonable',
      labels: ['Looks like your schedule is full right now'],
      mirror: '…too busy?',
      afterPause: 'Get the best callback window and note it — call exactly when they said.',
      exitLine: 'Understood. When is a better time today or tomorrow? Either way, your preference will be respected.',
    },
    {
      objection: 'Who\'s the client?',
      keyLine: 'I\'m not able to disclose that at this stage — [CONFIRM: who leads the search] can answer any question you have on the follow-up call.',
      softener: 'I appreciate that',
      labels: ['Feels like you want to know what you\'d be walking into before anything else'],
      mirror: '…who\'s the client?',
      afterPause: 'Their reaction to the authority line shows how serious the interest is.',
      exitLine: 'Understood — thank you for your time, and your preference will be respected.',
    },
    {
      objection: 'What\'s this about?',
      keyLine: 'I\'m a recruiter — I\'m calling to arrange a short call to outline a role, and [CONFIRM: why them] is why I thought of you.',
      softener: 'Fair point',
      labels: ['Seems like you want the headline before deciding anything'],
      mirror: '…what\'s this about?',
      afterPause: 'Note which detail catches their attention — lead with it on the next call.',
      exitLine: 'In short: a role that fits your background. If the timing is wrong, tell me when suits and I\'ll call then — either way, your preference will be respected.',
    },
  ],
}

const MOCK_STEP11 = {
  summary: 'The candidate attended the interview and the consultant noted the round went ahead as planned. Interest level is unknown — the notes contain no rating or clear words from the candidate on it; ask directly. Availability for the next round is unknown and should be confirmed.',
  interestLevel: {
    rating: null,
    basis: 'unknown',
    candidateWords: null,
    rationale: 'The notes do not contain a rating or clear words from the candidate on interest level.',
  },
  concerns: [
    {
      concern: 'Next-round availability not yet confirmed',
      category: 'process_timing',
      basis: 'inferred',
      candidateWords: null,
      clarifyingQuestion: 'When would you be available for the next round?',
      jobOrderReference: null,
      sensitive: false,
    },
  ],
  competingProcesses: [],
  nextActions: [
    {
      action: 'Confirm the candidate\'s availability for the next round and how the interview felt overall.',
      type: 'clarify_with_candidate',
      owner: 'consultant',
      due: null,
      status: 'proposed',
      fromNotes: null,
    },
  ],
  flags: ['notes contained no candidate quotes'],
}

const MOCK_STEP20 = {
  candidatePosition: {
    rankedPriorities: [],
    mustHaves: [],
    niceToHaves: [],
    currentPackage: [],
    expectations: [],
    reasonsForMoving: [],
  },
  clientPosition: {
    offerSoFar: [{ item: 'Offer not yet made', value: null, source: 'consultant_note', confidentialTo: null, words: null }],
    rangeAndStretch: [{ item: 'Client range', value: '[CONFIRM: client range]', source: 'client_stated', confidentialTo: 'client', words: null }],
    approvers: [],
    flexibility: [],
    statedDeadlines: [],
  },
  agreedTermsChecklist: [
    { term: 'base_salary', status: 'not_discussed', candidateView: null, clientView: null, confirmedInWriting: null, nextStep: 'Confirm the client\'s stated range before any ask.' },
  ],
  riskFlags: [
    {
      risk: 'No terms confirmed in writing',
      evidence: 'The notes contain no written offer details.',
      basis: 'stated',
      severity: 'medium',
      suggestedMitigation: 'Agree the terms checklist with both sides before the offer is drafted.',
    },
  ],
  counterScenarioPlan: {
    counterOfferSignals: [],
    reflectionQuestions: ['Which of the reasons you gave for moving would a counter-offer change?'],
    ifCounterOffered: ['Revisit the candidate\'s stated reasons for moving before responding.'],
    ifOfferBelowExpectation: ['Surface the trade-offs against the candidate\'s ranked priorities.'],
    suggestedAskOrder: ['Confirm the candidate\'s priorities, then test each against the client\'s stated range.'],
    earningsIllustration: null,
    resignationPrep: null,
    doNotShare: [{ item: 'Client range and stretch', confidentialTo: 'client' }],
  },
}

/** Deterministic canned output per stepKey (mock mode / e2e). */
const MOCK_OUTPUTS: Record<string, unknown> = {
  candidate_contact: MOCK_STEP5,
  candidate_debrief: MOCK_STEP11,
  closing_negotiating: MOCK_STEP20,
}

/**
 * Server runtime AI config (from runtimeConfig — never public).
 * Fail-closed rule (design §2): a set key with a missing/empty/unparseable
 * base URL yields 'misconfigured' — the service records a failed run with
 * 'AI provider misconfigured', NEVER a silent mock fallback.
 */
export interface AiRuntimeConfig {
  aiBaseUrl?: string
  aiApiKey?: string
  aiModel?: string
}

export const DEFAULT_AI_MODEL = 'gemini-3.8-flash'

export type AiProviderSelection =
  | { kind: 'provider', provider: AiProvider, model: string }
  | { kind: 'misconfigured', model: string }

export function selectProvider(config: AiRuntimeConfig): AiProviderSelection {
  const model = config.aiModel?.trim() || DEFAULT_AI_MODEL
  const key = config.aiApiKey?.trim()
  if (!key) {
    // Mock is the safe default: no key → no external calls.
    return { kind: 'provider', provider: new MockAiProvider(), model }
  }
  const base = config.aiBaseUrl?.trim()
  try {
    if (!base) throw new Error('AI_BASE_URL is not set')
    const url = new URL(base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('AI_BASE_URL must be http(s)')
    return { kind: 'provider', provider: new OpenAiCompatProvider(base, key), model }
  }
  catch {
    return { kind: 'misconfigured', model }
  }
}

export class MockAiProvider implements AiProvider {
  readonly provider = 'mock'

  async generate(opts: AiGenerateOptions): Promise<AiGenerateResult> {
    // Deterministic small delay — a real provider call takes seconds, and
    // the claim contract (design §5: the run stays 'running' for the whole
    // provider call, so a concurrent generate's recheck sees it → 409) is
    // only observable if the run outlives the second request's lock wait.
    await new Promise(res => setTimeout(res, 300))
    const canned = MOCK_OUTPUTS[opts.stepKey]
    const text = JSON.stringify(canned ?? { note: 'No canned output for this step' })
    return { text, raw: { mock: true, stepKey: opts.stepKey } }
  }
}
