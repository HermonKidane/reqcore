import { z } from 'zod'

/**
 * Call transcripts (Session W slice 1). Pasted text only for now; `source`
 * 'vonage' arrives with the recording fetch in slice 2.
 *
 * `consentNoted` is the recruiter's statement that the other party was told
 * the call is recorded / transcribed — required, not defaulted.
 */
export const TRANSCRIPT_MIN_CHARS = 50
export const TRANSCRIPT_MAX_CHARS = 60_000

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

export const createCallTranscriptSchema = z.object({
  text: z.string()
    .transform(s => s.replace(/\r\n?/g, '\n').trim())
    .pipe(z.string()
      .min(TRANSCRIPT_MIN_CHARS, `A transcript needs at least ${TRANSCRIPT_MIN_CHARS} characters`)
      .max(TRANSCRIPT_MAX_CHARS, `A transcript can be at most ${TRANSCRIPT_MAX_CHARS.toLocaleString('en-GB')} characters — split a long call into two`)),
  source: z.literal('pasted').default('pasted'),
  consentNoted: z.literal(true, { message: 'Confirm the caller was told the call is recorded or transcribed' }),
  candidateId: z.preprocess(blankToUndefined, z.string().min(1).max(64).optional()),
  jobId: z.preprocess(blankToUndefined, z.string().min(1).max(64).optional()),
  applicationId: z.preprocess(blankToUndefined, z.string().min(1).max(64).optional()),
  stepInstanceId: z.preprocess(blankToUndefined, z.string().min(1).max(64).optional()),
  recordedAt: z.preprocess(blankToUndefined, z.coerce.date().max(new Date(Date.now() + 5 * 60_000), 'Recorded time cannot be in the future').optional()),
  durationSeconds: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(24 * 3600).optional()),
}).strict()

export type CreateCallTranscriptInput = z.infer<typeof createCallTranscriptSchema>

export const callTranscriptIdParamSchema = z.object({ id: z.string().min(1).max(64) })
