<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { SKILL_MAX_LENGTH, SKILLS_MAX } from '~~/shared/candidate-qualifiers'

/**
 * Skills as chips. Type and press Enter or comma to add; Backspace on an
 * empty box removes the last one. No repeats (ignoring capitals), at most
 * 50 skills, each up to 80 characters.
 */
const props = withDefaults(defineProps<{
  modelValue: string[]
  id?: string
  error?: string
}>(), { id: 'skills', error: '' })

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const draft = ref('')
const localError = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

const shownError = computed(() => localError.value || props.error)

/** Add one or more skills (split on commas / new lines). Returns false when something was refused. */
function addMany(raw: string): boolean {
  const next = [...props.modelValue]
  const seen = new Set(next.map(s => s.toLowerCase()))
  let ok = true
  localError.value = ''
  for (const piece of raw.split(/[,\n]/)) {
    const name = piece.trim().replace(/\s+/g, ' ')
    if (!name) continue
    if (name.length > SKILL_MAX_LENGTH) {
      localError.value = `A skill can be up to ${SKILL_MAX_LENGTH} characters`
      ok = false
      continue
    }
    if (seen.has(name.toLowerCase())) continue
    if (next.length >= SKILLS_MAX) {
      localError.value = `You can add up to ${SKILLS_MAX} skills`
      ok = false
      break
    }
    seen.add(name.toLowerCase())
    next.push(name)
  }
  if (next.length !== props.modelValue.length) emit('update:modelValue', next)
  return ok
}

function commitDraft() {
  if (!draft.value.trim()) {
    draft.value = ''
    return
  }
  if (addMany(draft.value)) draft.value = ''
}

function remove(index: number) {
  localError.value = ''
  emit('update:modelValue', props.modelValue.filter((_, i) => i !== index))
  inputEl.value?.focus()
}

function onKeydown(event: KeyboardEvent) {
  // Cmd/Ctrl+Enter belongs to the form (save) — keep the typed skill first
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    commitDraft()
    return
  }
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault()
    commitDraft()
  }
  else if (event.key === 'Backspace' && draft.value === '' && props.modelValue.length) {
    remove(props.modelValue.length - 1)
  }
}

function onPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text') ?? ''
  if (/[,\n]/.test(text)) {
    event.preventDefault()
    addMany(draft.value + text)
    draft.value = ''
  }
}

defineExpose({ commitDraft })
</script>

<template>
  <div>
    <label :for="id" :class="candidateLabelClass">Add a skill</label>
    <ul v-if="modelValue.length" class="mb-2 flex flex-wrap gap-1.5" :aria-label="`${modelValue.length} skills added`" data-testid="skill-chips">
      <li
        v-for="(skill, index) in modelValue"
        :key="skill.toLowerCase()"
        class="inline-flex max-w-full items-center rounded-full bg-surface-100 dark:bg-surface-800 pl-3 text-sm font-medium text-surface-700 dark:text-surface-300"
      >
        <span class="min-w-0 break-words py-1">{{ skill }}</span>
        <button
          type="button"
          class="inline-flex min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 shrink-0 items-center justify-center rounded-full text-surface-500 hover:text-danger-600 dark:hover:text-danger-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
          :aria-label="`Remove skill ${skill}`"
          @click="remove(index)"
        >
          <X class="size-4" aria-hidden="true" />
        </button>
      </li>
    </ul>
    <input
      :id="id"
      ref="inputEl"
      v-model="draft"
      type="text"
      autocomplete="off"
      placeholder="e.g. Stakeholder management"
      :aria-describedby="`${id}-${shownError ? 'error' : 'hint'}`"
      :aria-invalid="shownError ? 'true' : undefined"
      :class="[candidateInputClass, candidateBorderClass(shownError)]"
      @keydown="onKeydown"
      @paste="onPaste"
      @blur="commitDraft"
    />
    <p v-if="shownError" :id="`${id}-error`" class="mt-1 text-xs text-danger-600 dark:text-danger-400" role="alert">{{ shownError }}</p>
    <p v-else :id="`${id}-hint`" class="mt-1 text-xs text-surface-500 dark:text-surface-400">
      Type a skill and press Enter or comma. {{ modelValue.length }} of {{ SKILLS_MAX }} added.
    </p>
  </div>
</template>
