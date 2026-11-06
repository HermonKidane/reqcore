<script setup lang="ts">
import { Plus, Check, Circle, X, Loader2, CloudCheck, CloudOff, CalendarClock } from 'lucide-vue-next'
import { useTasks, dueBucket, type TaskQuery, type TaskRow } from '~/composables/useTasks'

/**
 * Task list with quick-add (Session W slice 1). Used on the Tasks page, the
 * dashboard card and the candidate page (filtered by candidateId).
 */
const props = withDefaults(defineProps<{
  query?: TaskQuery
  /** Pre-filled link for quick-add */
  link?: { candidateId?: string, applicationId?: string, jobId?: string }
  /** Narrow the person picker to this company's contacts (company page) */
  pickerCompanyId?: string
  showAdd?: boolean
  compact?: boolean
  emptyText?: string
}>(), { query: () => ({}), link: () => ({}), showAdd: true, compact: false, emptyText: 'Nothing to do here.' })

// Person for quick-add: hidden when the list is already pinned to a person
const person = ref<{ id: string, name: string } | null>(null)
const showPicker = computed(() => !props.link.candidateId)

const { tasks, status, error, createTask, toggleDone, cancelTask } = useTasks(() => props.query, `tasks-${JSON.stringify(props.link)}`)

const newTitle = ref('')
const newDue = ref('')
const adding = ref(false)
const actionError = ref('')

async function add() {
  const title = newTitle.value.trim()
  if (!title || adding.value) return
  adding.value = true
  actionError.value = ''
  try {
    await createTask({
      title,
      dueAt: newDue.value ? new Date(newDue.value).toISOString() : undefined,
      allDay: !newDue.value || newDue.value.endsWith('T00:00'),
      ...props.link,
      ...(showPicker.value && person.value ? { candidateId: person.value.id } : {}),
    })
    newTitle.value = ''
    newDue.value = ''
    person.value = null
  }
  catch (err: any) {
    actionError.value = err?.data?.statusMessage ?? err?.message ?? 'Task not added'
  }
  finally {
    adding.value = false
  }
}

const busyId = ref<string | null>(null)
async function tick(t: TaskRow) {
  busyId.value = t.id
  actionError.value = ''
  try { await toggleDone(t) }
  catch (err: any) { actionError.value = err?.data?.statusMessage ?? err?.message ?? 'Not saved' }
  finally { busyId.value = null }
}
async function cancel(t: TaskRow) {
  if (!window.confirm(`Cancel "${t.title}"?`)) return
  busyId.value = t.id
  actionError.value = ''
  try { await cancelTask(t.id) }
  catch (err: any) { actionError.value = err?.data?.statusMessage ?? err?.message ?? 'Not cancelled' }
  finally { busyId.value = null }
}

const bucketClass: Record<string, string> = {
  overdue: 'text-danger-700 dark:text-danger-400',
  today: 'text-warning-700 dark:text-warning-400',
  week: 'text-surface-600 dark:text-surface-300',
  later: 'text-surface-500',
  none: 'text-surface-400',
}

function dueLabel(t: TaskRow): string {
  if (!t.dueAt) return ''
  const b = dueBucket(t.dueAt)
  const d = new Date(t.dueAt)
  const time = t.allDay ? '' : ` ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}`
  if (b === 'today') return `Today${time}`
  if (b === 'overdue') return `Overdue · ${formatDate(t.dueAt)}`
  return `${formatDate(t.dueAt)}${time}`
}

function syncState(t: TaskRow): 'synced' | 'error' | 'pending' | null {
  const s = t.syncs?.find(x => x.provider === 'microsoft')
  return s ? s.state : null
}
</script>

<template>
  <div data-testid="task-list">
    <form v-if="showAdd" class="mb-3 flex flex-wrap gap-2" @submit.prevent="add">
      <input
        v-model="newTitle"
        maxlength="200"
        placeholder="Add a task…"
        class="min-w-0 flex-1 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 min-h-11 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        data-testid="task-add-title"
      >
      <PersonPicker v-if="showPicker" v-model="person" :company-id="pickerCompanyId" class="w-full sm:w-56" />
      <input
        v-model="newDue"
        type="datetime-local"
        class="rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-2 min-h-11 text-xs"
        data-testid="task-add-due"
      >
      <button
        type="submit"
        :disabled="adding || !newTitle.trim()"
        class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 min-h-11 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        data-testid="task-add-submit"
      >
        <Loader2 v-if="adding" class="size-3.5 animate-spin" />
        <Plus v-else class="size-3.5" />
        Add
      </button>
    </form>

    <p v-if="actionError || error" class="mb-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700" data-testid="task-error">
      {{ actionError || 'Tasks could not be loaded.' }}
    </p>

    <p v-if="status === 'pending' && tasks.length === 0" class="text-sm text-surface-400">Loading…</p>
    <p v-else-if="tasks.length === 0" class="text-sm text-surface-400" data-testid="task-empty">{{ emptyText }}</p>

    <ul v-else class="divide-y divide-surface-100 dark:divide-surface-800">
      <li
        v-for="t in tasks"
        :key="t.id"
        class="flex items-start gap-3 py-2.5"
        :class="t.status === 'done' ? 'opacity-60' : ''"
        data-testid="task-row"
      >
        <button
          :disabled="busyId === t.id || t.status === 'cancelled'"
          class="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border"
          :class="t.status === 'done' ? 'border-success-500 bg-success-500 text-white' : 'border-surface-300 dark:border-surface-600 text-transparent hover:border-brand-500'"
          :aria-label="t.status === 'done' ? 'Mark open' : 'Mark done'"
          data-testid="task-tick"
          @click="tick(t)"
        >
          <Loader2 v-if="busyId === t.id" class="size-3 animate-spin text-surface-400" />
          <Check v-else-if="t.status === 'done'" class="size-3.5" />
          <Circle v-else class="size-3.5" />
        </button>
        <div class="min-w-0 flex-1">
          <p class="text-sm text-surface-800 dark:text-surface-200" :class="t.status === 'done' ? 'line-through' : ''">{{ t.title }}</p>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span v-if="t.dueAt" class="inline-flex items-center gap-1" :class="bucketClass[dueBucket(t.dueAt)]" data-testid="task-due">
              <CalendarClock class="size-3" />{{ dueLabel(t) }}
            </span>
            <NuxtLink v-if="t.candidate && !compact" :to="$localePath(`/dashboard/candidates/${t.candidate.id}`)" class="text-brand-600 hover:underline">
              {{ t.candidate.firstName }} {{ t.candidate.lastName }}
            </NuxtLink>
            <NuxtLink v-if="t.job && !compact" :to="$localePath(`/dashboard/jobs/${t.job.id}`)" class="text-surface-500 hover:underline truncate max-w-48">
              {{ t.job.title }}
            </NuxtLink>
            <span v-if="t.source === 'ai_run'" class="rounded-full bg-brand-50 dark:bg-brand-950 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300">from AI draft</span>
            <span v-if="t.owner && query.scope === 'all'" class="text-surface-400">{{ t.owner.name }}</span>
            <span v-if="syncState(t) === 'synced'" class="inline-flex items-center gap-1 text-success-700 dark:text-success-400" title="In Microsoft To Do"><CloudCheck class="size-3" />To Do</span>
            <span v-else-if="syncState(t) === 'error'" class="inline-flex items-center gap-1 text-danger-600" title="Sync failed — see Settings → Account"><CloudOff class="size-3" />sync error</span>
          </div>
          <p v-if="t.notes && !compact" class="mt-1 whitespace-pre-wrap text-xs text-surface-500">{{ t.notes }}</p>
        </div>
        <button
          v-if="t.status !== 'cancelled'"
          :disabled="busyId === t.id"
          class="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-surface-400 hover:bg-surface-100 hover:text-danger-600 dark:hover:bg-surface-800"
          aria-label="Cancel task"
          data-testid="task-cancel"
          @click="cancel(t)"
        >
          <X class="size-4" />
        </button>
      </li>
    </ul>
  </div>
</template>
