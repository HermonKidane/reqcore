<script setup lang="ts">
import { Sparkles, CheckCircle2, XCircle, AlertTriangle, Loader2, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { useApplicationWorkflow, type WorkflowInstance, type AiRun } from '~/composables/useApplicationWorkflow'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'

/**
 * AI-assist card for a workflow step (design-ai-slice.md §6).
 *
 * Shown only for steps flagged `completionRules.aiAssist === true` (the lazy
 * platform-default seed makes those prompts resolvable). AI output is
 * advisory: review writes only the run state — the recruiter copies what
 * they want into completionData via the step PATCH (locked principle §0).
 */

const props = defineProps<{
  instance: WorkflowInstance
  workflowActive: boolean
}>()

const { generateAiRun, fetchAiRuns, reviewAiRun } = useApplicationWorkflow(() => '')
const { handlePreviewReadOnlyError } = usePreviewReadOnly()

const aiAssist = computed(() => props.instance.stepTemplate.completionRules?.aiAssist === true)

const runs = ref<AiRun[]>([])
const loaded = ref(false)
const loading = ref(false)
const generating = ref(false)
const reviewing = ref(false)
const error = ref('')
const expandedErrorId = ref<string | null>(null)

const latest = computed(() => runs.value[0] ?? null)
const history = computed(() => runs.value.slice(0, 5))

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

async function generate() {
  if (generating.value) return
  generating.value = true
  error.value = ''
  try {
    const run = await generateAiRun(props.instance.id)
    // Prepend without a full refetch; status may still settle asynchronously
    // (mock/real provider completes before the response in this slice, but
    // keep the list convergent regardless).
    runs.value = [run, ...runs.value.filter(r => r.id !== run.id)]
    loaded.value = true
    if (run.status === 'running') await refreshRuns()
  }
  catch (err: any) {
    if (!handlePreviewReadOnlyError(err)) {
      error.value = err.data?.statusMessage ?? err.message ?? 'Draft not generated. Nothing was sent or saved. Try again, or complete the step without it.'
    }
    // 409 = a concurrent run exists — pick it up silently (panel convention)
    if (err?.data?.statusCode === 409) await refreshRuns()
  }
  finally {
    generating.value = false
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
    if (!handlePreviewReadOnlyError(err)) {
      error.value = err.data?.statusMessage ?? err.message ?? 'Review failed'
    }
    if (err?.data?.statusCode === 409) await refreshRuns()
  }
  finally {
    reviewing.value = false
  }
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
  return new Date(iso).toLocaleDateString()
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
}, { immediate: false })

onMounted(() => {
  if (aiAssist.value) refreshRuns()
})
</script>

<template>
  <div v-if="aiAssist" class="rounded-lg border border-brand-200 dark:border-brand-900 bg-brand-50/40 dark:bg-brand-950/20 p-3">
    <div class="flex items-center gap-2">
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
      <button
        v-if="workflowActive && !['completed', 'skipped'].includes(instance.status)"
        :disabled="generating"
        class="ml-auto cursor-pointer rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        @click="generate"
      >
        <Loader2 v-if="generating" class="mr-1 inline size-3 animate-spin" />
        {{ generating ? 'Generating…' : (latest ? 'Regenerate' : 'Generate') }}
      </button>
    </div>

    <p v-if="error" class="mt-2 rounded-lg border border-danger-200 bg-danger-50 px-2.5 py-1.5 text-xs text-danger-700">
      {{ error }}
    </p>

    <!-- Latest run -->
    <div v-if="latest" class="mt-2 space-y-2">
      <p class="text-[11px] text-surface-500 dark:text-surface-400">
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
            class="cursor-pointer rounded-lg bg-success-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-success-700 disabled:opacity-50"
            @click="review('approve')"
          >
            <CheckCircle2 class="mr-1 inline size-3" />
            Approve
          </button>
          <button
            :disabled="reviewing"
            class="cursor-pointer rounded-lg border border-danger-300 px-2.5 py-1 text-xs font-medium text-danger-700 hover:bg-danger-50 disabled:opacity-50"
            @click="review('reject')"
          >
            <XCircle class="mr-1 inline size-3" />
            Reject
          </button>
        </div>
        <p class="text-[11px] text-surface-500 dark:text-surface-400">
          Approving marks this draft as reviewed. Nothing is sent, and nothing is saved to the record. Copy in what you want to keep.
        </p>
      </template>

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
          <span>{{ relativeTime(run.createdAt) }}</span>
        </button>
        <p v-if="run.status === 'failed' && expandedErrorId === run.id" class="mb-1 ml-4 whitespace-pre-wrap text-danger-600 dark:text-danger-400">
          {{ run.error }}
        </p>
      </div>
    </div>
  </div>
</template>
