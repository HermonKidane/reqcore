<script setup lang="ts">
import { WORK_PREFERENCES, WORK_PREFERENCE_LABELS } from '~~/shared/candidate-qualifiers'

/**
 * Work preference as four segmented buttons (Office / Hybrid / Remote /
 * Flexible). Tapping the chosen one again clears it.
 */
const props = withDefaults(defineProps<{
  modelValue: string
  idPrefix?: string
}>(), { idPrefix: '' })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const labelId = computed(() => `${props.idPrefix}workPreference-label`)

function choose(value: string) {
  emit('update:modelValue', props.modelValue === value ? '' : value)
}
</script>

<template>
  <div>
    <p :id="labelId" :class="candidateLabelClass">Work preference</p>
    <div role="group" :aria-labelledby="labelId" class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <button
        v-for="value in WORK_PREFERENCES"
        :key="value"
        type="button"
        :aria-pressed="modelValue === value"
        :data-value="value"
        class="min-h-11 sm:min-h-9 rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500"
        :class="modelValue === value
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-surface-300 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800'"
        @click="choose(value)"
      >
        {{ WORK_PREFERENCE_LABELS[value] }}
      </button>
    </div>
  </div>
</template>
