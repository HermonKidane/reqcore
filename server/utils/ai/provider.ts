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

/** Deterministic canned output per stepKey (mock mode / e2e). */
const MOCK_OUTPUTS: Record<string, unknown> = {
  candidate_contact: {
    pitchScript: {
      script: 'Hi [CONFIRM: first name], I understand you deal with IT recruitment? (PAUSE) I work for a headhunting firm based in London [CONFIRM location]. I\'m calling to arrange a call with my managing consultant to outline the role. May I give you my mobile number, then you send me a text with your full name? (PAUSE) Would tomorrow at lunch 1pm or after work 6pm suit — which may I pencil in for you?',
      spokenWordCount: 72,
      estimatedSeconds: 32,
      confirmBeforeUse: ['first name', 'location'],
      doNotCallReason: null,
    },
    packageBullets: [],
    objectionRehearsal: [
      {
        objection: 'I\'m not interested',
        keyLine: null,
        softener: 'OK I hear you',
        labels: ['Seems like now is a bad time to be called at work'],
        mirror: '…not interested?',
        afterPause: 'Listen for any specific reason — it becomes 2nd-pitch material.',
        exitLine: 'No problem at all — thanks for your time. If it\'s easier, I can send a short text first so you know who\'s calling. Your preference will be respected.',
      },
      {
        objection: 'I\'m happy where I am',
        keyLine: null,
        softener: 'Makes sense',
        labels: ['Sounds like you\'re loyal to your current firm'],
        mirror: '…happy where you are?',
        afterPause: 'Note what specifically keeps them happy — benchmark for the role on offer.',
        exitLine: 'Fair enough — most people we speak with felt the same before they heard the detail. May I call at a quieter time, or would a text be better? Your preference will be respected.',
      },
      {
        objection: 'I\'m too busy',
        keyLine: null,
        softener: 'That\'s reasonable',
        labels: ['Looks like your desk is full-on right now'],
        mirror: '…too busy?',
        afterPause: 'Get the best callback window and note it — call exactly when they said.',
        exitLine: 'Understood. When is a better time today or tomorrow? I\'ll keep it under a minute. Your preference will be respected.',
      },
      {
        objection: 'Who\'s the client?',
        keyLine: 'I don\'t have the authority to disclose that — my managing consultant can answer any question you have.',
        softener: 'Yes I appreciate what you\'re saying',
        labels: ['Feels like you want to know what you\'re walking into before anything else'],
        mirror: '…who\'s the client?',
        afterPause: 'Their reaction to the authority line tells you how serious the interest is.',
        exitLine: 'Totally understand. The managing consultant can share more on the call — shall I pencil in one of the two slots? Either way, your preference will be respected.',
      },
      {
        objection: 'What\'s this about?',
        keyLine: 'I\'m a headhunter — my managing consultant has asked me to speak with you about a role, and I\'m calling to arrange a call to outline it.',
        softener: 'Great I follow',
        labels: ['Seems like you want the headline before deciding anything'],
        mirror: '…what\'s this about?',
        afterPause: 'Note which detail catches their attention — lead with it on the next call.',
        exitLine: 'In short: a role worth a short call to hear about. If the timing is wrong, tell me when suits and I\'ll call then — your preference will be respected.',
      },
    ],
  },
  candidate_debrief: {
    summary: 'The candidate attended the interview and spoke positively about the team. The consultant noted interest but no explicit rating was given. Next round availability is unknown and should be confirmed.',
    interestLevel: {
      rating: null,
      basis: 'unknown',
      candidateWords: null,
      rationale: 'The notes do not contain a rating or clear words from the candidate on interest level.',
    },
    concerns: [],
    competingProcesses: [],
    nextActions: [
      {
        action: 'Confirm the candidate\'s availability for the next round and ask how the interview felt overall.',
        type: 'clarify_with_candidate',
        owner: 'consultant',
        due: null,
        status: 'proposed',
        fromNotes: null,
      },
    ],
    flags: ['round number unclear'],
  },
  closing_negotiating: {
    candidatePosition: {
      rankedPriorities: [],
      mustHaves: [],
      niceToHaves: [],
      currentPackage: [],
      expectations: [],
      reasonsForMoving: [],
    },
    clientPosition: {
      offerSoFar: [],
      rangeAndStretch: [],
      approvers: [],
      flexibility: [],
      statedDeadlines: [],
    },
    agreedTermsChecklist: [],
    riskFlags: [],
    counterScenarioPlan: {
      counterOfferSignals: [],
      reflectionQuestions: [],
      ifCounterOffered: [],
      ifOfferBelowExpectation: [],
      suggestedAskOrder: [],
      earningsIllustration: null,
      resignationPrep: null,
      doNotShare: [],
    },
  },
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

export const DEFAULT_AI_MODEL = 'gemini-2.5-flash'

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
