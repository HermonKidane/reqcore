<script setup lang="ts">
import { AlertTriangle, ExternalLink } from 'lucide-vue-next'

export interface DuplicateMatch {
  id: string
  firstName: string
  lastName: string
  company: string | null
  position: string | null
  location: string | null
  reason: 'email' | 'linkedin' | 'phone' | 'name'
  strength: 'exact' | 'likely' | 'possible'
}

/**
 * "Is this person already here?" panel above the save buttons.
 * Exact matches (same email / LinkedIn URL) are shown in red: the person
 * already exists. Likely / possible matches are amber; a likely match needs
 * the "This is a different person" tick before saving.
 * "Open" uses a new tab so the form is not lost.
 */
const props = defineProps<{
  matches: DuplicateMatch[]
  /** v-model: the "This is a different person" tick */
  modelValue: boolean
  error?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const localePath = useLocalePath()

const exact = computed(() => props.matches.filter(m => m.strength === 'exact'))
const others = computed(() => props.matches.filter(m => m.strength !== 'exact'))
const needsConfirm = computed(() => others.value.some(m => m.strength === 'likely'))

function describe(match: DuplicateMatch): string {
  const name = `${match.firstName} ${match.lastName}`.trim()
  const role = match.position && match.company
    ? `${match.position} at ${match.company}`
    : match.position || match.company || ''
  return role ? `${name} — ${role}` : name
}

function reasonText(match: DuplicateMatch): string {
  switch (match.reason) {
    case 'email': return 'same email'
    case 'linkedin': return 'same LinkedIn URL'
    case 'phone': return 'same phone number'
    default: return match.strength === 'likely' ? 'same name and company' : 'same name'
  }
}
</script>

<template>
  <div v-if="matches.length" class="space-y-3" data-testid="duplicate-warning">
    <div
      v-if="exact.length"
      role="alert"
      class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 sm:p-4"
    >
      <p class="flex items-center gap-2 text-sm font-semibold text-danger-700 dark:text-danger-300">
        <AlertTriangle class="size-4 shrink-0" aria-hidden="true" />
        This person already exists
      </p>
      <ul class="mt-2 space-y-2">
        <li v-for="match in exact" :key="match.id" class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-danger-700 dark:text-danger-300">
          <span class="min-w-0 break-words">Already here: {{ describe(match) }} ({{ reasonText(match) }})</span>
          <a
            :href="localePath(`/dashboard/candidates/${match.id}`)"
            target="_blank"
            rel="noopener"
            class="inline-flex min-h-11 sm:min-h-8 items-center gap-1 rounded-lg border border-danger-300 dark:border-danger-700 px-3 text-sm font-medium hover:bg-danger-100 dark:hover:bg-danger-900 transition-colors"
            :aria-label="`Open ${match.firstName} ${match.lastName} in a new tab`"
          >
            Open
            <ExternalLink class="size-3.5" aria-hidden="true" />
          </a>
        </li>
      </ul>
    </div>

    <div
      v-if="others.length"
      role="status"
      class="rounded-lg border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-950 p-3 sm:p-4"
    >
      <ul class="space-y-2">
        <li v-for="match in others" :key="match.id" class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-warning-800 dark:text-warning-200">
          <span class="min-w-0 break-words">Possible duplicate: {{ describe(match) }} ({{ reasonText(match) }})</span>
          <a
            :href="localePath(`/dashboard/candidates/${match.id}`)"
            target="_blank"
            rel="noopener"
            class="inline-flex min-h-11 sm:min-h-8 items-center gap-1 rounded-lg border border-warning-300 dark:border-warning-700 px-3 text-sm font-medium hover:bg-warning-100 dark:hover:bg-warning-900 transition-colors"
            :aria-label="`Open ${match.firstName} ${match.lastName} in a new tab`"
          >
            Open
            <ExternalLink class="size-3.5" aria-hidden="true" />
          </a>
        </li>
      </ul>
      <div v-if="needsConfirm" class="mt-2 border-t border-warning-200 dark:border-warning-800 pt-2">
        <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-warning-900 dark:text-warning-100">
          <input
            id="differentPerson"
            type="checkbox"
            class="size-5 rounded border-warning-400 text-brand-600 focus:ring-brand-500"
            :checked="modelValue"
            :aria-describedby="error ? 'differentPerson-error' : undefined"
            @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
          />
          This is a different person
        </label>
        <p v-if="error" id="differentPerson-error" class="text-xs text-danger-600 dark:text-danger-400">{{ error }}</p>
      </div>
    </div>
  </div>
</template>
