<script setup lang="ts">
import { Sparkles, CheckCircle2, XCircle, AlertTriangle, Loader2, ChevronDown, ChevronRight, FileText, ClipboardList, ArrowDownToLine, ListTodo } from 'lucide-vue-next'
import { useApplicationWorkflow, type WorkflowInstance, type AiRun } from '~/composables/useApplicationWorkflow'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'
import { aiOutputToStepFields, aiOutputToTasks } from '~~/shared/recruitment/ai-output-to-step'

/**
 * AI-assist card for a workflow step (design-ai-slice.md §6).
 *
 * Shown only for steps flagged `completionRules.aiAssist === true` (the lazy
 * platform-default seed makes those prompts resolvable). AI output is
 * advisory: review writes only the run state — the recruiter copies what
 * they want into completionData via the step PATCH (locked principle §0).
 *
 * Session W slice 1 adds two more ways to run it:
 *   - Prep card ('prep')            — steps 5 and 6, before a call
 *   - Draft from transcript ('outcome') — steps 1, 5, 6, 11: paste the call,
 *     confirm the caller was told, run; an APPROVED outcome run can then be
 *     "used in step": the complete form is pre-filled (client-side) and the
 *     recruiter saves it through the ordinary step action.
 */

const props = defineProps<{
  instance: WorkflowInstance
  workflowActive: boolean
  applicationId?: string
}>()

const emit = defineEmits<{
  (e: 'use-in-step', fields: Record<string, string>): void
  (e: 'add-tasks', tasks: Array<{ title: string, dueAt: string | null }>, runId: string): void
}>()

const { generateAiRun, fetchAiRuns, reviewAiRun, createCallTranscript } = useApplicationWorkflow(() => props.applicationId ?? '')
const { handlePreviewReadOnlyError } = usePreviewReadOnly()

const aiAssist = computed(() => props.instance.stepTemplate.completionRules?.aiAssist === true)
const stepKey = computed(() => props.instance.stepTemplate.key)

// Which prompts exist for this step (platform defaults, slice 1)
const ASSIST_STEPS = new Set(['candidate_contact', 'candidate_debrief', 'closing_negotiating'])
const PREP_STEPS = new Set(['candidate_contact', 'candidate_profile'])
const OUTCOME_STEPS = new Set(['complete_job_order', 'candidate_contact', 'candidate_profile', 'candidate_debrief'])
const hasAssist = computed(() => ASSIST_STEPS.has(stepKey.value))
const hasPrep = computed(() => PREP_STEPS.has(stepKey.value))
const hasOutcome = computed(() => OUTCOME_STEPS.has(stepKey.value))

const runs = ref<AiRun[]>([])
const loaded = ref(false)
const loading = ref(false)
const generating = ref<'' | 'assist' | 'prep' | 'outcome'>('')
const reviewing = ref(false)
const error = ref('')
const expandedErrorId = ref<string | null>(null)

const latest = computed(() => runs.value[0] ?? null)
const history = computed(() => runs.value.slice(0, 5))

const canAct = computed(() => props.workflowActive && !['completed', 'skipped'].includes(props.instance.status))

// ── Transcript form ('outcome') ──
const TRANSCRIPT_MAX = 60_000
const TRANSCRIPT_MIN = 50
const showTranscript = ref(false)
const transcriptText = ref('')
const consentNoted = ref(false)
const recordedAt = ref('')
const round = ref(1)
const transcriptChars = computed(() => transcriptText.value.trim().length)
const transcriptTooLong = computed(() => transcriptChars.value > TRANSCRIPT_MAX)
const transcriptReady = computed(() => consentNoted.value && transcriptChars.value >= TRANSCRIPT_MIN && !transcriptTooLong.value)

const purposeLabel: Record<string, string> = { assist: 'Draft from notes', prep: 'Prep card', outcome: 'Drafted from transcript' }

const runStatusMeta: Record<string, { label: string, badge: string }> = {
  pending: { label: 'Pending', badge: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400' },
  running: { label: 'Running', badge: 'bg-info-50 text-info-700 dark:bg-info-950 dark:text-info-400' },
  succeeded: { label: 'Awaiting your review', badge: 'bg-warning-50 text-warning-700 dark:bg-warning-950 dark:text-warning-400' },
  failed: { label: 'Failed', badge: 'bg-danger-50 text-danger-700 dark:bg-danger-950 dark:text-danger-400' },
  approved: { label: 'Approved', badge: 'bg-success-50 text-success-700 dark:bg-success-950 dark:text-success-400' },
  rejected: { label: 'Rejected', badge: 'bg-danger-50 text-danger-700 dark:bg-danger-950 dark:text-danger-400' },
}

async function refreshRuns() {
  loading.value = true
  try {
    runs.value = await fetchAiRuns(props.instance.id)
    loaded.value = true
  }
  catch {
    // Silent — the card is supplementary; a failed list load shows the generate CTA
  }
  finally {
    loading.value = false
  }
}

function mergeRun(run: AiRun) {
  runs.value = [run, ...runs.value.filter(r => r.id !== run.id)]
  loaded.value = true
}

function failed(err: any, fallback: string) {
  if (!handlePreviewReadOnlyError(err)) {
    error.value = err?.data?.statusMessage ?? err?.message ?? fallback
  }
  // 409 = a concurrent run exists / stop rule — pick the list up silently (panel convention)
  if (err?.data?.statusCode === 409) refreshRuns()
}

async function generate(purpose: 'assist' | 'prep' = 'assist') {
  if (generating.value) return
  generating.value = purpose
  error.value = ''
  try {
    const run = await generateAiRun(props.instance.id, purpose === 'assist' ? {} : { purpose })
    mergeRun(run)
    if (run.status === 'running') await refreshRuns()
  }
  catch (err: any) {
    failed(err, 'Draft not generated. Nothing was sent or saved. Try again, or complete the step without it.')
  }
  finally {
    generating.value = ''
  }
}

async function runFromTranscript() {
  if (generating.value || !transcriptReady.value) return
  generating.value = 'outcome'
  error.value = ''
  try {
    const saved = await createCallTranscript({
      text: transcriptText.value,
      consentNoted: true,
      stepInstanceId: props.instance.id,
      applicationId: props.applicationId || undefined,
      recordedAt: recordedAt.value ? new Date(recordedAt.value).toISOString() : undefined,
    })
    const run = await generateAiRun(props.instance.id, {
      purpose: 'outcome',
      transcriptId: saved.id,
      round: stepKey.value === 'candidate_debrief' ? round.value : undefined,
    })
    mergeRun(run)
    if (run.status === 'running') await refreshRuns()
    if (run.status !== 'failed') {
      showTranscript.value = false
      transcriptText.value = ''
      consentNoted.value = false
      recordedAt.value = ''
    }
  }
  catch (err: any) {
    failed(err, 'Transcript not processed. Nothing was saved to the step.')
  }
  finally {
    generating.value = ''
  }
}

async function review(decision: 'approve' | 'reject') {
  if (reviewing.value || !latest.value) return
  reviewing.value = true
  error.value = ''
  try {
    const updated = await reviewAiRun(latest.value.id, decision)
    runs.value = runs.value.map(r => (r.id === updated.id ? updated : r))
  }
  catch (err: any) {
    failed(err, 'Review failed')
  }
  finally {
    reviewing.value = false
  }
}

// ── Use in step / add as tasks (approved outcome runs only) ──
const latestFields = computed(() => {
  const run = latest.value
  if (!run || run.status !== 'approved' || run.purpose !== 'outcome' || run.output?.parsed === undefined) return {}
  return aiOutputToStepFields(stepKey.value, run.purpose, run.output.parsed)
})
const latestTasks = computed(() => {
  const run = latest.value
  if (!run || run.status !== 'approved' || run.purpose !== 'outcome' || run.output?.parsed === undefined) return []
  return aiOutputToTasks(stepKey.value, run.purpose, run.output.parsed)
})
const canUseInStep = computed(() => canAct.value && Object.keys(latestFields.value).length > 0)
const canAddTasks = computed(() => canAct.value && latestTasks.value.length > 0)

function useInStep() {
  if (!canUseInStep.value) return
  emit('use-in-step', { ...latestFields.value })
}

function addTasks() {
  if (!canAddTasks.value || !latest.value) return
  emit('add-tasks', latestTasks.value.map(t => ({ ...t })), latest.value.id)
}

function toggleError(run: AiRun) {
  expandedErrorId.value = expandedErrorId.value === run.id ? null : run.id
}

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return formatDate(iso)
}

/** Pretty-print output: parsed JSON first (design §6). */
function outputText(run: AiRun): string {
  if (!run.output) return ''
  if (run.output.parsed !== undefined) return JSON.stringify(run.output.parsed, null, 2)
  return run.output.text
}

watch(() => props.instance.id, () => {
  runs.value = []
  loaded.value = false
  showTranscript.value = false
}, { immediate: false })

onMounted(() => {
  if (aiAssist.value) refreshRuns()
})
</script>

<template>
  <div v-if="aiAssist" class="rounded-lg border border-brand-200 dark:border-brand-900 bg-brand-50/40 dark:bg-brand-950/20 p-3" data-testid="ai-assist-card">
    <div class="flex flex-wrap items-center gap-2">
      <Sparkles class="size-3.5 text-brand-500" />
      <span class="text-xs font-semibold text-brand-700 dark:text-brand-300">AI assist</span>
      <span
        v-if="latest"
        class="rounded-full px-2 py-0.5 text-[10px] font-medium"
        :class="runStatusMeta[latest.status]?.badge"
      >
        {{ runStatusMeta[latest.status]?.label ?? latest.status }}
      </span>
      <span v-if="latest?.provider === 'mock'" class="rounded-full bg-surface-200 px-2 py-0.5 text-[10px] font-medium text-surface-600 dark:bg-surface-700 dark:text-surface-300">
        mock
      </span>
      <div v-if="canAct" class="ml-auto flex flex-wrap gap-1.5">
        <button
          v-if="hasPrep"
          :disabled="!!generating"
          class="cursor-pointer rounded-lg border border-brand-300 dark:border-brand-700 px-2.5 py-1.5 min-h-9 text-xs font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/40 disabled:opacity-50"
          data-testid="ai-prep"
          @click="generate('prep')"
        >
          <Loader2 v-if="generating === 'prep'" class="mr-1 inline size-3 animate-spin" />
          <ClipboardList v-else class="mr-1 inline size-3" />
          Prep card
        </button>
        <button
          v-if="hasOutcome"
          :disabled="!!generating"
          class="cursor-pointer rounded-lg border border-brand-300 dark:border-brand-700 px-2.5 py-1.5 min-h-9 text-xs font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/40 disabled:opacity-50"
          :class="showTranscript ? 'bg-brand-100 dark:bg-brand-900/40' : ''"
          data-testid="ai-transcript-toggle"
          @click="showTranscript = !showTranscript"
        >
          <FileText class="mr-1 inline size-3" />
          Draft from transcript
        </button>
        <button
          v-if="hasAssist"
          :disabled="!!generating"
          class="cursor-pointer rounded-lg bg-brand-600 px-2.5 py-1.5 min-h-9 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          @click="generate('assist')"
        >
          <Loader2 v-if="generating === 'assist'" class="mr-1 inline size-3 animate-spin" />
          {{ generating === 'assist' ? 'Generating…' : (latest ? 'Regenerate' : 'Generate') }}
        </button>
      </div>
    </div>

    <!-- Transcript form -->
    <div v-if="showTranscript && canAct" class="mt-2 space-y-2 rounded-lg border border-brand-200 dark:border-brand-800 bg-white dark:bg-surface-900 p-2.5" data-testid="ai-transcript-form">
      <label class="block text-xs font-medium text-surface-600 dark:text-surface-300">
        Paste the call transcript
      </label>
      <textarea
        v-model="transcriptText"
        rows="6"
        :maxlength="TRANSCRIPT_MAX + 1000"
        placeholder="Paste the transcript here. Phone numbers and emails are removed before the AI reads it."
        class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        data-testid="ai-transcript-text"
      />
      <p class="text-[11px]" :class="transcriptTooLong ? 'text-danger-600' : 'text-surface-400'">
        {{ transcriptChars.toLocaleString('en-GB') }} / {{ TRANSCRIPT_MAX.toLocaleString('en-GB') }} characters<template v-if="transcriptTooLong"> — too long; split the call in two</template><template v-else-if="transcriptChars > 0 && transcriptChars < TRANSCRIPT_MIN"> — a little more is needed</template>
      </p>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label class="inline-flex items-center gap-2 text-xs text-surface-600 dark:text-surface-300">
          <input v-model="consentNoted" type="checkbox" class="size-4 rounded border-surface-300" data-testid="ai-transcript-consent">
          The caller was told the call is recorded or transcribed
        </label>
        <label class="inline-flex items-center gap-2 text-xs text-surface-500">
          Recorded
          <input v-model="recordedAt" type="datetime-local" class="rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2 py-1 text-xs">
        </label>
        <label v-if="stepKey === 'candidate_debrief'" class="inline-flex items-center gap-2 text-xs text-surface-500">
          Round
          <input v-model.number="round" type="number" min="1" max="9" class="w-14 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2 py-1 text-xs">
        </label>
      </div>
      <div class="flex gap-2 pt-1">
        <button
          :disabled="!transcriptReady || !!generating"
          class="cursor-pointer rounded-lg bg-brand-600 px-3 py-1.5 min-h-9 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          data-testid="ai-transcript-run"
          @click="runFromTranscript"
        >
          <Loader2 v-if="generating === 'outcome'" class="mr-1 inline size-3 animate-spin" />
          {{ generating === 'outcome' ? 'Reading the call…' : 'Draft from transcript' }}
        </button>
        <button
          class="cursor-pointer rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 min-h-9 text-xs font-medium text-surface-600 dark:text-surface-300"
          @click="showTranscript = false"
        >
          Cancel
        </button>
      </div>
    </div>

    <p v-if="error" class="mt-2 rounded-lg border border-danger-200 bg-danger-50 px-2.5 py-1.5 text-xs text-danger-700" data-testid="ai-error">
      {{ error }}
    </p>

    <!-- Latest run -->
    <div v-if="latest" class="mt-2 space-y-2">
      <p class="text-[11px] text-surface-500 dark:text-surface-400">
        <span v-if="latest.purpose && latest.purpose !== 'assist'" class="mr-1 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{{ purposeLabel[latest.purpose] }}</span>
        {{ latest.promptTemplate?.name ?? 'AI run' }} · v{{ latest.promptTemplate?.version ?? '?' }}
        · {{ latest.provider }}/{{ latest.model }}
      </p>

      <pre
        v-if="latest.status === 'succeeded' || latest.status === 'approved' || latest.status === 'rejected'"
        class="max-h-64 overflow-auto rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-2.5 text-[11px] whitespace-pre-wrap text-surface-700 dark:text-surface-300"
      >{{ outputText(latest) }}</pre>

      <template v-if="latest.status === 'succeeded'">
        <p v-if="latest.promptSnapshot?.safetyNotes" class="flex gap-1.5 rounded-lg border border-warning-200 bg-warning-50 px-2.5 py-1.5 text-[11px] text-warning-800 dark:border-warning-900 dark:bg-warning-950/40 dark:text-warning-300">
          <AlertTriangle class="mt-0.5 size-3 shrink-0" />
          <span class="whitespace-pre-wrap">{{ latest.promptSnapshot.safetyNotes }}</span>
        </p>
        <div class="flex gap-2">
          <button
            :disabled="reviewing"
            class="cursor-pointer rounded-lg bg-success-600 px-2.5 py-1.5 min-h-9 text-xs font-medium text-white hover:bg-success-700 disabled:opacity-50"
            @click="review('approve')"
          >
            <CheckCircle2 class="mr-1 inline size-3" />
            Approve
          </button>
          <button
            :disabled="reviewing"
            class="cursor-pointer rounded-lg border border-danger-300 px-2.5 py-1.5 min-h-9 text-xs font-medium text-danger-700 hover:bg-danger-50 disabled:opacity-50"
            @click="review('reject')"
          >
            <XCircle class="mr-1 inline size-3" />
            Reject
          </button>
        </div>
        <p class="text-[11px] text-surface-500 dark:text-surface-400">
          Approving marks this draft as reviewed. Nothing is sent, and nothing is saved to the record.
          <template v-if="latest.purpose === 'outcome'">After approving you can put it into the step and edit before saving.</template>
          <template v-else>Copy in what you want to keep.</template>
        </p>
      </template>

      <!-- Approved outcome run: use in step / add as tasks -->
      <div v-if="latest.status === 'approved' && latest.purpose === 'outcome' && (canUseInStep || canAddTasks)" class="flex flex-wrap gap-2">
        <button
          v-if="canUseInStep"
          class="cursor-pointer rounded-lg bg-brand-600 px-2.5 py-1.5 min-h-9 text-xs font-medium text-white hover:bg-brand-700"
          data-testid="ai-use-in-step"
          @click="useInStep"
        >
          <ArrowDownToLine class="mr-1 inline size-3" />
          Use in step
        </button>
        <button
          v-if="canAddTasks"
          class="cursor-pointer rounded-lg border border-brand-300 dark:border-brand-700 px-2.5 py-1.5 min-h-9 text-xs font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/40"
          data-testid="ai-add-tasks"
          @click="addTasks"
        >
          <ListTodo class="mr-1 inline size-3" />
          Add as tasks ({{ latestTasks.length }})
        </button>
      </div>

      <p v-if="latest.reviewNote" class="text-[11px] text-surface-500 dark:text-surface-400">
        Review note: {{ latest.reviewNote }}
      </p>
    </div>
    <p v-else-if="loading" class="mt-2 text-xs text-surface-400">
      Loading AI history…
    </p>

    <!-- History: last 5 runs, failed runs expandable to the error -->
    <div v-if="history.length > 1" class="mt-2 border-t border-surface-200 dark:border-surface-700 pt-2">
      <p class="mb-1 text-[11px] font-medium text-surface-500 dark:text-surface-400">History</p>
      <div v-for="run in history" :key="run.id" class="text-[11px]">
        <button
          class="flex w-full cursor-pointer items-center gap-1.5 py-0.5 text-left text-surface-500 dark:text-surface-400"
          @click="run.status === 'failed' ? toggleError(run) : undefined"
        >
          <component
            :is="run.status === 'failed' ? (expandedErrorId === run.id ? ChevronDown : ChevronRight) : 'span'"
            v-if="run.status === 'failed'"
            class="size-3 shrink-0"
          />
          <span
            class="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            :class="runStatusMeta[run.status]?.badge"
          >
            {{ runStatusMeta[run.status]?.label ?? run.status }}
          </span>
          <span v-if="run.purpose && run.purpose !== 'assist'">{{ purposeLabel[run.purpose] }} ·</span>
          <span>{{ relativeTime(run.createdAt) }}</span>
        </button>
        <p v-if="run.status === 'failed' && expandedErrorId === run.id" class="mb-1 ml-4 whitespace-pre-wrap text-danger-600 dark:text-danger-400">
          {{ run.error }}
        </p>
      </div>
    </div>
  </div>
</template>
