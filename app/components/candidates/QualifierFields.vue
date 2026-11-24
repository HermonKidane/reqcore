<script setup lang="ts">
import {
  DAY_RATE_MAX,
  NOTICE_PERIODS,
  NOTICE_PERIOD_LABELS,
  RIGHT_TO_WORK,
  RIGHT_TO_WORK_LABELS,
  SALARY_CURRENCIES,
  SALARY_MAX,
  SOURCE_CHANNELS,
  SOURCE_CHANNEL_LABELS,
  formatMoney,
  parseMoneyInput,
  type QualifierFormValues,
} from '~~/shared/candidate-qualifiers'

/**
 * The qualifier controls — source, money, notice period, right to work —
 * shared by the Add Candidate form and the profile edit form.
 * `showWorkPreference` adds the work-preference buttons (the Add form shows
 * those in its "Current role & location" card instead).
 */
const props = withDefaults(defineProps<{
  modelValue: QualifierFormValues
  errors?: Record<string, string>
  idPrefix?: string
  showWorkPreference?: boolean
}>(), {
  errors: () => ({}),
  idPrefix: '',
  showWorkPreference: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: QualifierFormValues] }>()

function set<K extends keyof QualifierFormValues>(key: K, value: string) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function onField(key: keyof QualifierFormValues, event: Event) {
  set(key, (event.target as HTMLInputElement | HTMLSelectElement).value)
}

// A stored currency outside the short list (set through the API) stays selectable.
const currencyOptions = computed(() => {
  const current = props.modelValue.salaryCurrency
  return current && !(SALARY_CURRENCIES as readonly string[]).includes(current)
    ? [...SALARY_CURRENCIES, current]
    : [...SALARY_CURRENCIES]
})

const moneyFields = [
  { key: 'salaryCurrent', label: 'Current salary', hint: 'A year, before tax', max: SALARY_MAX, placeholder: 'e.g. 60000' },
  { key: 'salaryExpected', label: 'Expected salary', hint: 'A year, before tax', max: SALARY_MAX, placeholder: 'e.g. 65000' },
  { key: 'dayRate', label: 'Day rate', hint: 'For contract work', max: DAY_RATE_MAX, placeholder: 'e.g. 450' },
] as const

function moneyHint(key: 'salaryCurrent' | 'salaryExpected' | 'dayRate', max: number, fallback: string): string {
  const parsed = parseMoneyInput(props.modelValue[key], max)
  if (parsed.value === null) return fallback
  return formatMoney(parsed.value, props.modelValue.salaryCurrency)
}

const selectClass = computed(() => `${candidateInputClass} appearance-auto`)
</script>

<template>
  <div class="space-y-4">
    <CandidatesWorkPreferencePicker
      v-if="showWorkPreference"
      :model-value="modelValue.workPreference"
      :id-prefix="idPrefix"
      @update:model-value="set('workPreference', $event)"
    />

    <div>
      <label :for="`${idPrefix}sourceChannel`" :class="candidateLabelClass">How we found them</label>
      <select
        :id="`${idPrefix}sourceChannel`"
        :value="modelValue.sourceChannel"
        :class="[selectClass, candidateBorderClass(errors.sourceChannel)]"
        :aria-describedby="errors.sourceChannel ? `${idPrefix}sourceChannel-error` : undefined"
        @change="onField('sourceChannel', $event)"
      >
        <option value="">Not set</option>
        <option v-for="value in SOURCE_CHANNELS" :key="value" :value="value">{{ SOURCE_CHANNEL_LABELS[value] }}</option>
      </select>
      <p v-if="errors.sourceChannel" :id="`${idPrefix}sourceChannel-error`" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.sourceChannel }}</p>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label :for="`${idPrefix}salaryCurrency`" :class="candidateLabelClass">Currency</label>
        <select
          :id="`${idPrefix}salaryCurrency`"
          :value="modelValue.salaryCurrency"
          :class="[selectClass, candidateBorderClass(errors.salaryCurrency)]"
          @change="onField('salaryCurrency', $event)"
        >
          <option v-for="code in currencyOptions" :key="code" :value="code">{{ code }}</option>
        </select>
      </div>

      <div v-for="field in moneyFields" :key="field.key">
        <label :for="`${idPrefix}${field.key}`" :class="candidateLabelClass">{{ field.label }}</label>
        <input
          :id="`${idPrefix}${field.key}`"
          :value="modelValue[field.key]"
          type="number"
          inputmode="numeric"
          min="0"
          :max="field.max"
          step="1"
          :placeholder="field.placeholder"
          :aria-invalid="errors[field.key] ? 'true' : undefined"
          :aria-describedby="`${idPrefix}${field.key}-${errors[field.key] ? 'error' : 'hint'}`"
          :class="[candidateInputClass, candidateBorderClass(errors[field.key])]"
          @input="onField(field.key, $event)"
        />
        <p v-if="errors[field.key]" :id="`${idPrefix}${field.key}-error`" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors[field.key] }}</p>
        <p v-else :id="`${idPrefix}${field.key}-hint`" class="mt-1 text-xs text-surface-500 dark:text-surface-400" :data-money-hint="field.key">
          {{ moneyHint(field.key, field.max, field.hint) }}
        </p>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label :for="`${idPrefix}noticePeriod`" :class="candidateLabelClass">Notice period</label>
        <select
          :id="`${idPrefix}noticePeriod`"
          :value="modelValue.noticePeriod"
          :class="[selectClass, candidateBorderClass(errors.noticePeriod)]"
          @change="onField('noticePeriod', $event)"
        >
          <option value="">Not set</option>
          <option v-for="value in NOTICE_PERIODS" :key="value" :value="value">{{ NOTICE_PERIOD_LABELS[value] }}</option>
        </select>
      </div>
      <div>
        <label :for="`${idPrefix}rightToWork`" :class="candidateLabelClass">Right to work</label>
        <select
          :id="`${idPrefix}rightToWork`"
          :value="modelValue.rightToWork"
          :class="[selectClass, candidateBorderClass(errors.rightToWork)]"
          @change="onField('rightToWork', $event)"
        >
          <option value="">Not set</option>
          <option v-for="value in RIGHT_TO_WORK" :key="value" :value="value">{{ RIGHT_TO_WORK_LABELS[value] }}</option>
        </select>
      </div>
    </div>
  </div>
</template>
