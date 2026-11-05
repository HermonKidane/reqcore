<script setup lang="ts">
import { Ban } from 'lucide-vue-next'

/**
 * Org-wide "do not contact" chip (Session W slice 1, step 5 #4).
 * Shown wherever a person's name appears; the flag blocks AI call prep and
 * drafts server-side — this is the visible reminder for humans.
 */
defineProps<{
  flagged: boolean | null | undefined
  /** Compact = icon + short label for list rows */
  compact?: boolean
}>()
</script>

<template>
  <span
    v-if="flagged"
    class="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-50 px-2 py-0.5 text-xs font-medium text-danger-700 dark:bg-danger-950 dark:text-danger-400"
    title="This person asked not to be contacted. No calls, messages or drafts."
    data-testid="do-not-contact-badge"
  >
    <Ban class="size-3" />
    {{ compact ? 'No contact' : 'Do not contact' }}
  </span>
</template>
