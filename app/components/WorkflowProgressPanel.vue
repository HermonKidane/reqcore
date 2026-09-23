<script setup lang="ts">
import { CheckCircle2, Circle, Loader2, Ban, MinusCircle, AlertTriangle, ChevronDown, ChevronRight, History, CalendarClock } from 'lucide-vue-next'
import { useApplicationWorkflow, type WorkflowInstance, type StepEvent } from '~/composables/useApplicationWorkflow'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'

const props = defineProps<{
  applicationId: string
}>()

const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const { workflowData, status, error, refresh, updateStep, fetchStepEvents } = useApplicationWorkflow(() => props.applicationId)

// ─────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────

const statusMeta: Record<string, { label: string, badge: string, icon: any }> = {
  pending: {
    label: 'Pending',
    badge: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400',
    icon: Circle,
  },
  in_progress: {
    label: 'In progress',
    badge: 'bg-info-50 text-info-700 dark:bg-info-950 dark:text-info-400',
    icon: Loader2,
  },
  blocked: {
    label: 'Blocked',
    badge: 'bg-danger-50 text-danger-700 dark:bg-danger-950 dark:text-danger-400',
    icon: Ban,
  },
  completed: {
    label: 'Completed',
    badge: 'bg-success-50 text-success-700 dark:bg-success-950 dark:text-success-400',
    icon: CheckCircle2,
  },
  skipped: {
    label: 'Skipped',
    badge: 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400',
    icon: MinusCircle,
  },
}

const isTerminal = (i: WorkflowInstance) => i.status === 'completed' || i.status === 'skipped'

const phases = computed(() => {
  const data = workflowData.value
  if (!data) return []
  const map = new Map<string, WorkflowInstance[]>()
  for (const instance of data.instances) {
    const phase = instance.stepTemplate.phase
    if (!map.has(phase)) map.set(phase, [])
    map.get(phase)!.push(instance)
  }
  return [...map.entries()].map(([name, instances]) => ({ name, instances }))
})

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : ''
}

// ─────────────────────────────────────────────
// Per-step actions (state machine)
// ─────────────────────────────────────────────

const busyId = ref<string | null>(null)
const actionError = ref('')

async function run(instanceId: string, body: Record<string, unknown>) {
  busyId.value = instanceId
  actionError.value = ''
  try {
    await updateStep(instanceId, body)
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    actionError.value = err.data?.statusMessage ?? err.message ?? 'Action failed'
  }
  finally {
    busyId.value = null
  }
}

// Expand/collapse + inline forms
const expandedId = ref<string | null>(null)
const formMode = ref<'' | 'complete' | 'block'>('')
const completeFields = ref<Record<string, string>>({})
const blockReason = ref('')
const dueInput = ref('')
const savingDue = ref(false)

function toggleExpand(instance: WorkflowInstance) {
  if (expandedId.value === instance.id) {
    expandedId.value = null
    formMode.value = ''
    return
  }
  expandedId.value = instance.id
  formMode.value = ''
  blockReason.value = ''
  dueInput.value = instance.dueAt ? toLocalInputValue(instance.dueAt) : ''
  // Pre-fill required fields from existing completion data
  const fields: Record<string, string> = {}
  for (const key of instance.stepTemplate.requiredFields) {
    const existing = instance.completionData?.[key]
    fields[key] = existing === undefined || existing === null ? '' : String(existing)
  }
  completeFields.value = fields
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function openForm(mode: 'complete' | 'block') {
  formMode.value = formMode.value === mode ? '' : mode
}

function readableKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

async function submitComplete(instance: WorkflowInstance) {
  const completionData: Record<string, string> = {}
  for (const [key, value] of Object.entries(completeFields.value)) {
    if (value.trim() !== '') completionData[key] = value.trim()
  }
  await run(instance.id, { action: 'complete', completionData })
  if (!actionError.value) formMode.value = ''
}

async function submitBlock(instance: WorkflowInstance) {
  if (!blockReason.value.trim()) {
    actionError.value = 'A blocker reason is required'
    return
  }
  await run(instance.id, { action: 'block', reason: blockReason.value.trim() })
  if (!actionError.value) {
    formMode.value = ''
    blockReason.value = ''
  }
}

async function submitDue(instance: WorkflowInstance) {
  savingDue.value = true
  try {
    await run(instance.id, { action: 'update', dueAt: dueInput.value ? new Date(dueInput.value).toISOString() : null })
  }
  finally {
    savingDue.value = false
  }
}

// ─────────────────────────────────────────────
// Event trail
// ─────────────────────────────────────────────

const showEvents = ref(false)
const events = ref<StepEvent[]>([])
const eventsLoading = ref(false)

async function toggleEvents(instance: WorkflowInstance) {
  if (showEvents.value && eventsInstanceId.value === instance.id) {
    showEvents.value = false
    return
  }
  eventsInstanceId.value = instance.id
  showEvents.value = true
  eventsLoading.value = true
  try {
    events.value = await fetchStepEvents(instance.id)
  }
  catch {
    events.value = []
  }
  finally {
    eventsLoading.value = false
  }
}
const eventsInstanceId = ref<string | null>(null)

function eventSummary(event: StepEvent): string {
  const p = event.payload ?? {}
  const parts: string[] = []
  if (p.fromStatus || p.toStatus) parts.push(`${p.fromStatus ?? '—'} → ${p.toStatus ?? '—'}`)
  if (p.reason) parts.push(`Reason: ${p.reason}`)
  if (p.changed) parts.push(`Changed: ${(p.changed as string[]).join(', ')}`)
  if (p.stepNumber) parts.push(`Step #${p.stepNumber}`)
  return parts.join(' · ') || event.eventType
}
</script>

<template>
  <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200">
        30-Step Process
      </h2>
      <span v-if="workflowData?.workflow.template" class="text-xs text-surface-400">
        {{ workflowData.workflow.template.name }} · v{{ workflowData.workflow.template.version }}
      </span>
    </div>

    <!-- Loading / error -->
    <div v-if="status === 'pending'" class="py-6 text-center text-sm text-surface-400">
      Loading workflow…
    </div>
    <div v-else-if="error" class="rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">
      Failed to load workflow.
    </div>

    <template v-else-if="workflowData">
      <!-- Progress bar -->
      <div class="mb-2 flex items-center gap-3">
        <div class="h-2 flex-1 overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800">
          <div
            class="h-full rounded-full bg-success-500 transition-all"
            :style="{ width: `${workflowData.progress.percent}%` }"
          />
        </div>
        <span class="text-sm font-medium text-surface-600 dark:text-surface-300">
          {{ workflowData.progress.percent }}%
        </span>
      </div>
      <div class="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-surface-500 dark:text-surface-400">
        <span>{{ workflowData.progress.completed }} completed</span>
        <span v-if="workflowData.progress.in_progress">{{ workflowData.progress.in_progress }} in progress</span>
        <span v-if="workflowData.progress.blocked" class="text-danger-600 dark:text-danger-400 font-medium">
          {{ workflowData.progress.blocked }} blocked
        </span>
        <span v-if="workflowData.progress.skipped">{{ workflowData.progress.skipped }} skipped</span>
        <span v-if="workflowData.workflow.status !== 'active'" class="font-medium capitalize">
          · Workflow {{ workflowData.workflow.status }}
        </span>
      </div>

      <p v-if="actionError" class="mb-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">
        {{ actionError }}
      </p>

      <!-- Phases -->
      <div class="space-y-3">
        <details
          v-for="phase in phases"
          :key="phase.name"
          class="group rounded-lg border border-surface-100 dark:border-surface-800"
        >
          <summary class="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 group-open:border-b group-open:border-surface-100 dark:group-open:border-surface-800">
            <ChevronRight class="size-3.5 transition-transform group-open:rotate-90" />
            {{ phase.name }}
            <span class="ml-auto font-normal normal-case">
              {{ phase.instances.filter(i => i.status === 'completed' || i.status === 'skipped').length }}/{{ phase.instances.length }}
            </span>
          </summary>

          <div class="divide-y divide-surface-100 dark:divide-surface-800">
            <div v-for="instance in phase.instances" :key="instance.id">
              <!-- Step row -->
              <button
                class="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-50 dark:hover:bg-surface-800/50"
                @click="toggleExpand(instance)"
              >
                <component
                  :is="statusMeta[instance.status]?.icon ?? Circle"
                  class="size-4 shrink-0"
                  :class="{
                    'text-success-500': instance.status === 'completed',
                    'text-info-500': instance.status === 'in_progress',
                    'text-danger-500': instance.status === 'blocked',
                    'text-surface-300 dark:text-surface-600': instance.status === 'pending' || instance.status === 'skipped',
                  }"
                />
                <span class="w-6 shrink-0 text-right text-xs text-surface-400">
                  {{ instance.stepTemplate.stepNumber }}
                </span>
                <span
                  class="truncate text-sm"
                  :class="isTerminal(instance) ? 'text-surface-400 line-through decoration-surface-300' : 'text-surface-700 dark:text-surface-200'"
                >
                  {{ instance.stepTemplate.name }}
                </span>
                <span v-if="instance.dueAt" class="ml-auto hidden shrink-0 items-center gap-1 text-xs text-surface-400 sm:inline-flex">
                  <CalendarClock class="size-3" />
                  {{ formatDate(instance.dueAt) }}
                </span>
                <span
                  class="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium sm:ml-2"
                  :class="statusMeta[instance.status]?.badge"
                >
                  {{ statusMeta[instance.status]?.label }}
                </span>
              </button>

              <!-- Expanded detail + actions -->
              <div v-if="expandedId === instance.id" class="space-y-3 px-4 pb-3 pt-1">
                <p v-if="instance.stepTemplate.description" class="text-xs text-surface-500 dark:text-surface-400">
                  {{ instance.stepTemplate.description }}
                </p>
                <p v-if="instance.blockedReason" class="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">
                  <AlertTriangle class="mr-1 inline size-3.5" />
                  {{ instance.blockedReason }}
                </p>

                <!-- Action buttons -->
                <div v-if="!isTerminal(instance) && workflowData.workflow.status === 'active'" class="flex flex-wrap gap-2">
                  <button
                    v-if="instance.status === 'pending' || instance.status === 'blocked'"
                    :disabled="busyId === instance.id"
                    class="cursor-pointer rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                    @click="run(instance.id, { action: 'start' })"
                  >
                    Start
                  </button>
                  <button
                    :disabled="busyId === instance.id"
                    class="cursor-pointer rounded-lg bg-success-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-success-700 disabled:opacity-50"
                    @click="openForm('complete')"
                  >
                    Complete
                  </button>
                  <button
                    v-if="instance.status === 'blocked'"
                    :disabled="busyId === instance.id"
                    class="cursor-pointer rounded-lg border border-surface-300 dark:border-surface-600 px-2.5 py-1 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50"
                    @click="run(instance.id, { action: 'unblock' })"
                  >
                    Unblock
                  </button>
                  <button
                    v-if="instance.status !== 'blocked'"
                    :disabled="busyId === instance.id"
                    class="cursor-pointer rounded-lg border border-danger-300 px-2.5 py-1 text-xs font-medium text-danger-700 hover:bg-danger-50 disabled:opacity-50"
                    @click="openForm('block')"
                  >
                    Block
                  </button>
                  <button
                    :disabled="busyId === instance.id"
                    class="cursor-pointer rounded-lg border border-surface-300 dark:border-surface-600 px-2.5 py-1 text-xs font-medium text-surface-500 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50"
                    @click="run(instance.id, { action: 'skip' })"
                  >
                    Skip
                  </button>
                  <button
                    class="cursor-pointer rounded-lg border border-surface-300 dark:border-surface-600 px-2.5 py-1 text-xs font-medium text-surface-500 hover:bg-surface-50 dark:hover:bg-surface-800"
                    @click="toggleEvents(instance)"
                  >
                    <History class="mr-1 inline size-3" />
                    History
                  </button>
                </div>
                <div v-else-if="workflowData.workflow.status === 'active'" class="flex gap-2">
                  <button
                    class="cursor-pointer rounded-lg border border-surface-300 dark:border-surface-600 px-2.5 py-1 text-xs font-medium text-surface-500 hover:bg-surface-50 dark:hover:bg-surface-800"
                    @click="toggleEvents(instance)"
                  >
                    <History class="mr-1 inline size-3" />
                    History
                  </button>
                </div>

                <!-- Complete form -->
                <div v-if="formMode === 'complete'" class="space-y-2 rounded-lg border border-surface-200 dark:border-surface-700 p-3">
                  <div v-for="key in instance.stepTemplate.requiredFields" :key="key">
                    <label class="mb-0.5 block text-xs font-medium text-surface-500 dark:text-surface-400">
                      {{ readableKey(key) }}
                      <span class="text-danger-500">*</span>
                    </label>
                    <input
                      v-model="completeFields[key]"
                      type="text"
                      class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                  </div>
                  <p v-if="instance.stepTemplate.requiredFields.length === 0" class="text-xs text-surface-400">
                    No required fields for this step.
                  </p>
                  <div class="flex gap-2 pt-1">
                    <button
                      :disabled="busyId === instance.id"
                      class="cursor-pointer rounded-lg bg-success-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-success-700 disabled:opacity-50"
                      @click="submitComplete(instance)"
                    >
                      {{ busyId === instance.id ? 'Saving…' : 'Mark Completed' }}
                    </button>
                    <button
                      class="cursor-pointer rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-300"
                      @click="formMode = ''"
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                <!-- Block form -->
                <div v-if="formMode === 'block'" class="space-y-2 rounded-lg border border-danger-200 p-3">
                  <label class="mb-0.5 block text-xs font-medium text-surface-500 dark:text-surface-400">
                    Blocker reason <span class="text-danger-500">*</span>
                  </label>
                  <textarea
                    v-model="blockReason"
                    rows="2"
                    class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <div class="flex gap-2 pt-1">
                    <button
                      :disabled="busyId === instance.id"
                      class="cursor-pointer rounded-lg bg-danger-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-danger-700 disabled:opacity-50"
                      @click="submitBlock(instance)"
                    >
                      Block Step
                    </button>
                    <button
                      class="cursor-pointer rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-300"
                      @click="formMode = ''"
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                <!-- Due date row -->
                <div v-if="!isTerminal(instance) && workflowData.workflow.status === 'active'" class="flex items-center gap-2">
                  <input
                    v-model="dueInput"
                    type="datetime-local"
                    class="rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                  <button
                    :disabled="savingDue || busyId === instance.id"
                    class="cursor-pointer rounded-lg border border-surface-300 dark:border-surface-600 px-2.5 py-1 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50"
                    @click="submitDue(instance)"
                  >
                    Set due
                  </button>
                </div>

                <!-- Completion data (terminal steps) -->
                <dl v-if="isTerminal(instance) && instance.completionData && Object.keys(instance.completionData).length" class="space-y-1 border-t border-surface-100 dark:border-surface-800 pt-2">
                  <div v-for="(value, key) in instance.completionData" :key="key" class="flex gap-2 text-xs">
                    <dt class="w-32 shrink-0 text-surface-400">{{ readableKey(String(key)) }}</dt>
                    <dd class="text-surface-600 dark:text-surface-300">{{ value }}</dd>
                  </div>
                </dl>

                <!-- Event trail -->
                <div v-if="showEvents && eventsInstanceId === instance.id" class="border-t border-surface-100 dark:border-surface-800 pt-2">
                  <p v-if="eventsLoading" class="text-xs text-surface-400">Loading history…</p>
                  <ul v-else class="space-y-1.5">
                    <li v-for="event in events" :key="event.id" class="text-xs text-surface-500 dark:text-surface-400">
                      <span class="font-medium text-surface-600 dark:text-surface-300">{{ event.eventType }}</span>
                      · {{ eventSummary(event) }}
                      <span class="text-surface-400">
                        · {{ event.actor?.name ?? 'System' }} · {{ formatDate(event.occurredAt) }}
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>
    </template>
  </div>
</template>
