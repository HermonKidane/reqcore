<script setup lang="ts">
import { Search, X, User } from 'lucide-vue-next'

/**
 * Pick a person (candidate or client contact; same table) for a task.
 * Searches /api/candidates by name/email; optional companyId narrows it to
 * that company's active contacts.
 */
const props = defineProps<{
  modelValue: { id: string, name: string } | null
  companyId?: string
  placeholder?: string
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: { id: string, name: string } | null): void }>()

const query = ref('')
const open = ref(false)
const results = ref<Array<{ id: string, firstName: string, lastName: string, company: string | null, position: string | null }>>([])
const loading = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0

async function search() {
  const q = query.value.trim()
  if (q.length < 2 && !props.companyId) {
    results.value = []
    return
  }
  const mine = ++seq
  loading.value = true
  try {
    const params: Record<string, string | number> = { limit: 8 }
    if (q) params.search = q
    if (props.companyId) { params.companyId = props.companyId; params.role = 'client_contact' }
    const res = await $fetch<{ data: typeof results.value }>('/api/candidates', { params })
    if (mine === seq) results.value = res.data
  }
  catch {
    if (mine === seq) results.value = []
  }
  finally {
    if (mine === seq) loading.value = false
  }
}

watch(query, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(search, 200)
})

function pick(p: { id: string, firstName: string, lastName: string }) {
  emit('update:modelValue', { id: p.id, name: `${p.firstName} ${p.lastName}`.trim() })
  query.value = ''
  results.value = []
  open.value = false
}

function clear() {
  emit('update:modelValue', null)
}

function onFocus() {
  open.value = true
  if (props.companyId && results.value.length === 0) search()
}

// Delay so a click on a result lands before the list closes
function onBlur() {
  setTimeout(() => { open.value = false }, 150)
}
</script>

<template>
  <div class="relative min-w-0">
    <div v-if="modelValue" class="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 px-2.5 py-2 min-h-11 text-sm text-brand-800 dark:text-brand-200" data-testid="person-picker-selected">
      <User class="size-3.5 shrink-0" />
      <span class="truncate">{{ modelValue.name }}</span>
      <button type="button" class="ml-1 inline-flex size-6 items-center justify-center rounded hover:bg-brand-100 dark:hover:bg-brand-900" aria-label="Remove person" @click="clear">
        <X class="size-3.5" />
      </button>
    </div>
    <template v-else>
      <div class="relative">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-surface-400" />
        <input
          v-model="query"
          type="text"
          :placeholder="placeholder ?? 'Who is it about?'"
          autocomplete="off"
          class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 pl-8 pr-2.5 py-2 min-h-11 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          data-testid="person-picker-input"
          @focus="onFocus"
          @blur="onBlur"
        >
      </div>
      <ul
        v-if="open && (results.length || loading)"
        class="absolute z-20 mt-1 max-h-64 w-full min-w-56 overflow-auto rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 py-1 shadow-lg"
        data-testid="person-picker-results"
      >
        <li v-if="loading && !results.length" class="px-3 py-2 text-xs text-surface-400">Searching…</li>
        <li v-for="p in results" :key="p.id">
          <button type="button" class="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-surface-50 dark:hover:bg-surface-800" @mousedown.prevent="pick(p)">
            <User class="mt-0.5 size-3.5 shrink-0 text-surface-400" />
            <span class="min-w-0">
              <span class="block truncate text-surface-800 dark:text-surface-200">{{ p.firstName }} {{ p.lastName }}</span>
              <span v-if="p.position || p.company" class="block truncate text-xs text-surface-400">{{ [p.position, p.company].filter(Boolean).join(' · ') }}</span>
            </span>
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>
