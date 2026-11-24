<script setup lang="ts">
/**
 * One labelled text input (or textarea) for the Add Candidate form:
 * label, optional "*", error linked with aria-describedby, and the
 * "From CV — check" hint shown until the user edits the field.
 */
const props = withDefaults(defineProps<{
  id: string
  label: string
  modelValue: string
  type?: string
  placeholder?: string
  required?: boolean
  error?: string
  fromCv?: boolean
  autocomplete?: string
  inputmode?: 'text' | 'tel' | 'email' | 'url' | 'numeric'
  multiline?: boolean
  rows?: number
  /** Shows "n / max" under a textarea */
  countMax?: number
}>(), {
  type: 'text',
  placeholder: '',
  required: false,
  error: '',
  fromCv: false,
  autocomplete: 'off',
  inputmode: undefined,
  multiline: false,
  rows: 4,
  countMax: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'edited': []
  'blur': []
}>()

const describedBy = computed(() => {
  const ids: string[] = []
  if (props.error) ids.push(`${props.id}-error`)
  if (props.fromCv) ids.push(`${props.id}-cv`)
  if (props.countMax) ids.push(`${props.id}-count`)
  return ids.length ? ids.join(' ') : undefined
})

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement).value)
  emit('edited')
}
</script>

<template>
  <div>
    <label :for="id" :class="candidateLabelClass">
      {{ label }} <span v-if="required" class="text-danger-500" aria-hidden="true">*</span>
    </label>
    <textarea
      v-if="multiline"
      :id="id"
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      :class="[candidateInputClass, candidateBorderClass(error)]"
      @input="onInput"
      @blur="emit('blur')"
    />
    <input
      v-else
      :id="id"
      :value="modelValue"
      :type="type"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      :aria-required="required ? 'true' : undefined"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      :class="[candidateInputClass, candidateBorderClass(error)]"
      @input="onInput"
      @blur="emit('blur')"
    />
    <div class="mt-1 flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5">
      <div class="min-w-0">
        <p v-if="error" :id="`${id}-error`" class="text-xs text-danger-600 dark:text-danger-400">
          {{ error }}
          <slot name="error-extra" />
        </p>
        <p v-else-if="fromCv" :id="`${id}-cv`" class="text-xs text-brand-700 dark:text-brand-300">
          From CV — check
        </p>
      </div>
      <p
        v-if="countMax"
        :id="`${id}-count`"
        class="ml-auto text-xs tabular-nums"
        :class="modelValue.length > countMax ? 'text-danger-600 dark:text-danger-400' : 'text-surface-500 dark:text-surface-400'"
      >
        {{ modelValue.length.toLocaleString('en-GB') }} / {{ countMax.toLocaleString('en-GB') }}
      </p>
    </div>
  </div>
</template>
