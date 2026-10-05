<script setup lang="ts">
const props = withDefaults(defineProps<{
  firstName: string
  lastName: string
  photoUrl?: string | null
  size?: 'sm' | 'md'
}>(), {
  photoUrl: undefined,
  size: 'md',
})

// Deterministic colour from the name — stable across renders and sessions
const colorPairs = [
  'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-400',
  'bg-info-100 text-info-700 dark:bg-info-950 dark:text-info-400',
  'bg-success-100 text-success-700 dark:bg-success-950 dark:text-success-400',
  'bg-warning-100 text-warning-700 dark:bg-warning-950 dark:text-warning-400',
  'bg-danger-100 text-danger-700 dark:bg-danger-950 dark:text-danger-400',
  'bg-surface-200 text-surface-700 dark:bg-surface-800 dark:text-surface-300',
]

const fullName = computed(() => `${props.firstName} ${props.lastName}`.trim())

const initials = computed(() => {
  const first = props.firstName?.charAt(0)
  const last = props.lastName?.charAt(0)
  if (!first && !last) return '?'
  return `${first ?? ''}${last ?? ''}`.toUpperCase()
})

const colorClass = computed(() => {
  const key = `${props.firstName} ${props.lastName}`
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0
  }
  return colorPairs[Math.abs(hash) % colorPairs.length]
})

const sizeClass = computed(() =>
  props.size === 'sm' ? 'size-7 text-xs' : 'size-9 text-sm',
)

// Fall back to initials when the photo fails to load (or serving isn't live yet)
const imageError = ref(false)
const showPhoto = computed(() => !!props.photoUrl && !imageError.value)
watch(() => props.photoUrl, () => { imageError.value = false })
</script>

<template>
  <span
    class="inline-flex items-center justify-center rounded-full font-medium shrink-0"
    :class="[sizeClass, showPhoto ? 'overflow-hidden' : colorClass]"
  >
    <img
      v-if="showPhoto"
      :src="photoUrl!"
      :alt="fullName"
      class="size-full rounded-full object-cover"
      @error="imageError = true"
    >
    <span v-else aria-hidden="true">{{ initials }}</span>
  </span>
</template>
