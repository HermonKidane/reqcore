<script setup lang="ts">
import { HelpCircle, RotateCcw, Play } from 'lucide-vue-next'
import 'driver.js/dist/driver.css'
import { toursForPath } from '~/tours'

/**
 * "Show me how" tour entry point (PRD convention).
 *
 * Mounted once in the dashboard layout; picks the tours relevant to the
 * current route from the registry. One tour → single click to start.
 * Several tours → small menu to pick. Completed tours show "Replay";
 * an in-progress (persisted) tour shows "Resume tour" first.
 */

const route = useRoute()
const { startTour, pendingTourId } = useTour()

const availableTours = computed(() => toursForPath(route.path))

const completedIds = ref<string[]>([])
const pendingId = ref<string | null>(null)

// localStorage is client-only; refresh labels lazily after mount.
onMounted(() => {
  completedIds.value = readCompletedTourIds()
  pendingId.value = pendingTourId()
})

const isOpen = ref(false)

async function launch(tourId: string, resume: boolean) {
  isOpen.value = false
  await startTour(tourId, { resume })
  completedIds.value = readCompletedTourIds()
  pendingId.value = pendingTourId()
}

// Expose for tests: the launcher renders nothing where no tour applies.
defineExpose({ availableTours })
</script>

<template>
  <div v-if="availableTours.length" class="tour-launcher fixed bottom-5 right-5 z-40 print:hidden">
    <!-- Single-tour page: one button -->
    <div v-if="availableTours.length === 1" class="relative">
      <button
        v-if="pendingId === availableTours[0].id"
        class="inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-brand-700 transition-colors cursor-pointer border-0"
        data-tour-launcher="resume"
        @click="launch(availableTours[0].id, true)"
      >
        <Play class="size-4" />
        Resume tour
      </button>
      <button
        v-else
        class="inline-flex items-center gap-2 rounded-full bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-200 shadow-lg hover:border-brand-400 dark:hover:border-brand-600 transition-colors cursor-pointer"
        data-tour-launcher="start"
        @click="launch(availableTours[0].id, false)"
      >
        <component :is="completedIds.includes(availableTours[0].id) ? RotateCcw : HelpCircle" class="size-4 text-brand-600 dark:text-brand-400" />
        {{ completedIds.includes(availableTours[0].id) ? 'Replay tour' : 'Show me how' }}
      </button>
    </div>

    <!-- Multi-tour page: menu -->
    <div v-else class="relative">
      <button
        class="inline-flex items-center gap-2 rounded-full bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-200 shadow-lg hover:border-brand-400 dark:hover:border-brand-600 transition-colors cursor-pointer"
        data-tour-launcher="menu"
        :aria-expanded="isOpen"
        @click="isOpen = !isOpen"
      >
        <HelpCircle class="size-4 text-brand-600 dark:text-brand-400" />
        Show me how
      </button>
      <div
        v-if="isOpen"
        class="absolute bottom-12 right-0 w-72 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl p-2"
      >
        <button
          v-for="t in availableTours"
          :key="t.id"
          class="w-full text-left rounded-lg px-3 py-2 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors cursor-pointer border-0 bg-transparent"
          @click="launch(t.id, pendingId === t.id)"
        >
          <span class="block text-sm font-medium text-surface-900 dark:text-surface-100">
            {{ pendingId === t.id ? 'Resume: ' : '' }}{{ t.label }}
          </span>
          <span class="block text-xs text-surface-500 dark:text-surface-400 mt-0.5">{{ t.description }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style>
/* Brand-theme the driver.js chrome (global — driver renders on <body>).
   @reference pulls the Tailwind v4 theme tokens into this SFC block. */
@reference "~/assets/css/main.css";
.driver-popover.mr-tour-popover {
  @apply rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl max-w-xs;
}
.driver-popover.mr-tour-popover .driver-popover-title {
  @apply text-base font-semibold text-surface-900 dark:text-surface-50;
}
.driver-popover.mr-tour-popover .driver-popover-description {
  @apply text-sm text-surface-600 dark:text-surface-300 leading-relaxed;
}
.driver-popover.mr-tour-popover .driver-popover-progress-text {
  @apply text-xs text-surface-400;
}
.driver-popover.mr-tour-popover .driver-popover-close-btn {
  @apply text-surface-400 hover:text-surface-600 dark:hover:text-surface-200;
}
.driver-popover.mr-tour-popover .driver-popover-arrow {
  @apply fill-white dark:fill-surface-900 stroke-surface-200 dark:stroke-surface-700;
}
.driver-popover.mr-tour-popover .driver-popover-next-btn,
.driver-popover.mr-tour-popover .driver-popover-prev-btn {
  @apply rounded-lg px-3 py-1.5 text-sm font-medium border-0 cursor-pointer;
}
.driver-popover.mr-tour-popover .driver-popover-next-btn {
  @apply bg-brand-600 text-white hover:bg-brand-700;
}
.driver-popover.mr-tour-popover .driver-popover-prev-btn {
  @apply bg-transparent text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800;
}
.driver-popover.mr-tour-popover .driver-popover-footer {
  @apply gap-2;
}
.driver-active .driver-overlay {
  @apply opacity-40;
}
</style>
