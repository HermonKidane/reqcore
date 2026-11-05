<script setup lang="ts">
import { ListTodo } from 'lucide-vue-next'
import type { TaskQuery } from '~/composables/useTasks'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({ title: 'Tasks — MyRecruiter' })

type Tab = 'overdue' | 'today' | 'week' | 'later' | 'none' | 'done'
const tabs: Array<{ id: Tab, label: string }> = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'No date' },
  { id: 'done', label: 'Done' },
]
const activeTab = ref<Tab>('today')
const scope = ref<'mine' | 'all'>('mine')

const query = computed<TaskQuery>(() => activeTab.value === 'done'
  ? { scope: scope.value, status: 'done', due: 'any', limit: 100 }
  : { scope: scope.value, status: 'open', due: activeTab.value, limit: 200 })

const emptyText = computed(() => ({
  overdue: 'Nothing overdue.',
  today: 'Nothing due today.',
  week: 'Nothing due this week.',
  later: 'Nothing scheduled later.',
  none: 'No undated tasks.',
  done: 'Nothing done yet.',
}[activeTab.value]))
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-6">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 class="inline-flex items-center gap-2 text-2xl font-bold text-surface-900 dark:text-surface-50">
        <ListTodo class="size-6 text-brand-600" />
        Tasks
      </h1>
      <label class="inline-flex items-center gap-2 text-xs text-surface-500">
        Show
        <select v-model="scope" class="rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2 py-1.5 min-h-9 text-xs" data-testid="task-scope">
          <option value="mine">Mine</option>
          <option value="all">Everyone (admins)</option>
        </select>
      </label>
    </div>

    <div class="mb-4 -mx-4 border-b border-surface-200 dark:border-surface-800 px-4 sm:mx-0 sm:px-0">
      <div class="flex gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
        <button
          v-for="t in tabs"
          :key="t.id"
          class="cursor-pointer shrink-0 whitespace-nowrap min-h-11 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
          :class="activeTab === t.id
            ? 'border-brand-600 text-brand-600'
            : 'border-transparent text-surface-500 hover:text-surface-700 hover:border-surface-300 dark:hover:text-surface-300'"
          :data-testid="`task-tab-${t.id}`"
          @click="activeTab = t.id"
        >
          {{ t.label }}
        </button>
      </div>
    </div>

    <TaskList :query="query" :show-add="activeTab !== 'done'" :empty-text="emptyText" />

    <p class="mt-6 text-xs text-surface-400">
      Connect Microsoft in <NuxtLink :to="$localePath('/dashboard/settings/account')" class="text-brand-600 hover:underline">Settings → Account</NuxtLink> to see these in Microsoft To Do and Outlook.
    </p>
  </div>
</template>
