/**
 * Prompt fragments shared by the platform v2 rows (`ai-prompts.ts`) and the
 * Session W slice 1 rows (`ai-prompts-slice1.ts`). The two strings below are
 * hash-pinned through the v2 system prompts in `e2e/regression/ai-slice.spec.ts`
 * — a change here is a content change to every prompt that embeds them.
 */

export const TCC_PREAMBLE = `WHY THESE RULES EXIST
The consultant's reputation with candidates and clients outlasts any single placement. A draft that invents a fact, pressures anyone, or leaks one side's position to the other can cost more than the fee. The rules below protect against that. These reasons explain the rules; they never override one.`

export const OUTPUT_GUARD = 'Write only field content. Add no encouragement, reassurance or commentary addressed to the consultant. Quoted wording from the notes stays exactly as written.'

/**
 * Step 11 debrief output — shared by the v1/v2 `assist` rows and the slice 1
 * `outcome` (transcript) row, which returns the same shape.
 */
export const CANDIDATE_DEBRIEF_OUTPUT_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'candidate_debrief output',
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'interestLevel', 'concerns', 'competingProcesses', 'nextActions'],
  properties: {
    summary: { type: 'string', description: '≤120 words, neutral, attributed.' },
    interestLevel: {
      type: 'object',
      additionalProperties: false,
      required: ['rating', 'basis', 'candidateWords', 'rationale'],
      properties: {
        rating: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
        basis: { type: 'string', enum: ['stated', 'inferred', 'unknown'] },
        candidateWords: { type: ['string', 'null'] },
        rationale: { type: 'string', description: 'What the rating rests on; for \'inferred\', the evidence.' },
      },
    },
    concerns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['concern', 'category', 'basis', 'candidateWords', 'clarifyingQuestion', 'sensitive'],
        properties: {
          concern: { type: 'string' },
          category: { type: 'string', enum: ['compensation', 'commission_targets', 'commute_location', 'hybrid_hours', 'role_scope_desk', 'team_manager', 'culture', 'progression_training', 'process_timing', 'notice_covenants', 'other'] },
          basis: { type: 'string', enum: ['stated', 'inferred'] },
          candidateWords: { type: ['string', 'null'] },
          clarifyingQuestion: { type: 'string', description: 'One open, non-leading question.' },
          jobOrderReference: { type: ['string', 'null'], description: 'Job-order wording relevant to this concern, internal only.' },
          sensitive: { type: 'boolean', description: 'True for frank remarks about people; never pass verbatim to the client.' },
        },
      },
    },
    competingProcesses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'stage', 'timeline', 'candidateWords', 'shareableWithClient'],
        properties: {
          description: { type: 'string', description: 'As disclosed; the other company/agency name only if the candidate gave it.' },
          stage: { type: 'string', enum: ['applied', 'interviewing', 'final_stage', 'offer', 'unknown'] },
          timeline: { type: ['string', 'null'] },
          candidateWords: { type: ['string', 'null'] },
          shareableWithClient: { type: 'string', enum: ['yes', 'no', 'unknown'] },
        },
      },
    },
    nextActions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'type', 'owner', 'due', 'status', 'fromNotes'],
        properties: {
          action: { type: 'string' },
          type: { type: 'string', enum: ['clarify_with_candidate', 'debrief_employer', 'update_client', 'prep_next_round', 'logistics', 'trial_close_question', 'references', 'other'] },
          owner: { type: 'string', enum: ['consultant', 'managing_consultant', 'candidate', 'client'] },
          due: { type: ['string', 'null'], description: 'Only if the notes give a date/time.' },
          status: { const: 'proposed' },
          fromNotes: { type: ['string', 'null'], description: 'The note text that triggered this action, or null for a gap-driven action.' },
        },
      },
    },
    flags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional: e.g. \'sensitive personal detail omitted\', \'round number unclear\', \'notes truncated\'.',
    },
  },
}
