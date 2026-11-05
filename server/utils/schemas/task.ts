import { z } from 'zod'

/**
 * Tasks (Session W slice 1, plumbing P3). Field limits follow the two-layer
 * rule: title 200, notes 4000, due within ±5 years, bulk ≤ 20.
 */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)
const FIVE_YEARS = 5 * 366 * 24 * 3600 * 1000
const dueAtRule = z.coerce.date()
  .min(new Date(Date.now() - FIVE_YEARS), 'Due date is too far in the past')
  .max(new Date(Date.now() + FIVE_YEARS), 'Due date is too far ahead')

const linkId = z.preprocess(blankToUndefined, z.string().min(1).max(64).optional())

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'A task needs a title').max(200),
  notes: z.preprocess(blankToUndefined, z.string().trim().max(4000).optional()),
  dueAt: z.preprocess(blankToUndefined, dueAtRule.optional()),
  allDay: z.boolean().default(true),
  ownerId: linkId,
  candidateId: linkId,
  jobId: linkId,
  applicationId: linkId,
  stepInstanceId: linkId,
  aiRunId: linkId,
}).strict()

export type CreateTaskInput = z.infer<typeof createTaskSchema>

export const bulkCreateTasksSchema = z.object({
  tasks: z.array(createTaskSchema).min(1).max(20),
}).strict()

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.preprocess(blankToUndefined, z.string().trim().max(4000).nullish()),
  dueAt: z.preprocess(blankToUndefined, dueAtRule.nullish()),
  allDay: z.boolean().optional(),
  ownerId: z.string().min(1).max(64).optional(),
  status: z.enum(['open', 'done']).optional(),
}).strict().refine(v => Object.keys(v).length > 0, { message: 'Nothing to update' })

export const taskQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(['open', 'done', 'cancelled']).default('open'),
  due: z.enum(['overdue', 'today', 'week', 'later', 'none', 'any']).default('any'),
  candidateId: linkId,
  applicationId: linkId,
  jobId: linkId,
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export const taskIdParamSchema = z.object({ id: z.string().min(1).max(64) })
