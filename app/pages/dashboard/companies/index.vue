<script setup lang="ts">
import { Building2, Plus, Search } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Companies — MyRecruiter',
  description: 'Manage your client companies',
})

const searchInput = ref('')
const debouncedSearch = ref<string | undefined>(undefined)

let debounceTimer: ReturnType<typeof setTimeout>
watch(searchInput, (val) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = val.trim() || undefined
  }, 300)
})

const {
  companies,
  total,
  fetchStatus,
  error,
  refresh,
  createCompany,
  deleteCompany,
} = useClientCompanies({ search: debouncedSearch })

const localePath = useLocalePath()

// ─────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────

const showCreateForm = ref(false)
const newName = ref('')
const newWebsite = ref('')
const isSaving = ref(false)
const formError = ref<string | null>(null)

async function handleCreate() {
  formError.value = null
  isSaving.value = true
  try {
    const created: any = await createCompany({
      name: newName.value,
      ...(newWebsite.value.trim() ? { website: newWebsite.value.trim() } : {}),
    })
    showCreateForm.value = false
    newName.value = ''
    newWebsite.value = ''
    await navigateTo(localePath(`/dashboard/companies/${created.id}`))
  }
  catch (err: any) {
    formError.value = err.data?.statusMessage ?? 'Failed to create company'
  }
  finally {
    isSaving.value = false
  }
}

// ─────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────

const showDeleteConfirm = ref<string | null>(null)
const isDeleting = ref(false)
const deleteError = ref<string | null>(null)

async function handleDelete(id: string) {
  isDeleting.value = true
  deleteError.value = null
  try {
    await deleteCompany(id)
    showDeleteConfirm.value = null
  }
  catch (err: any) {
    // 409 = company has role history (soft-delete is a future feature)
    deleteError.value = err.data?.statusMessage ?? 'Failed to delete company'
    showDeleteConfirm.value = null
  }
  finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">Companies</h1>
        <p class="text-sm text-surface-500 dark:text-surface-400 mt-1">
          Client companies your contacts work at.
        </p>
      </div>
      <button
        class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        @click="showCreateForm = !showCreateForm"
      >
        <Plus class="size-4" />
        Add Company
      </button>
    </div>

    <!-- Create form -->
    <div
      v-if="showCreateForm"
      class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4 mb-6"
    >
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex-1 min-w-48">
          <label class="block text-xs font-medium text-surface-500 mb-1">Name <span class="text-danger-500">*</span></label>
          <input
            v-model="newName"
            type="text"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 px-3 py-1.5 text-sm text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
            @keyup.enter="newName.trim() && handleCreate()"
          />
        </div>
        <div class="flex-1 min-w-48">
          <label class="block text-xs font-medium text-surface-500 mb-1">Website</label>
          <input
            v-model="newWebsite"
            type="text"
            placeholder="https://…"
            class="w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 px-3 py-1.5 text-sm text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
            @keyup.enter="handleCreate"
          />
        </div>
        <div class="flex gap-2">
          <button
            :disabled="isSaving || !newName.trim()"
            class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="handleCreate"
          >
            {{ isSaving ? 'Saving…' : 'Save' }}
          </button>
          <button
            class="rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            @click="showCreateForm = false; formError = null"
          >
            Cancel
          </button>
        </div>
      </div>
      <p v-if="formError" class="mt-2 text-xs text-danger-600 dark:text-danger-400">{{ formError }}</p>
    </div>

    <!-- Delete error toast -->
    <div
      v-if="deleteError"
      class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400 mb-6"
    >
      {{ deleteError }}
      <button class="underline ml-1" @click="deleteError = null">Dismiss</button>
    </div>

    <!-- Search -->
    <div class="relative mb-6">
      <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-surface-400" />
      <input
        v-model="searchInput"
        type="text"
        placeholder="Search companies…"
        class="w-full rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 pl-10 pr-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
      />
    </div>

    <!-- Loading state -->
    <div v-if="fetchStatus === 'pending'" class="text-center py-12 text-surface-400">
      Loading companies…
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700"
    >
      Failed to load companies. Please try again.
      <button class="underline ml-1" @click="refresh()">Retry</button>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="companies.length === 0"
      class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-12 text-center"
    >
      <Building2 class="size-10 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
      <h3 class="text-base font-semibold text-surface-700 dark:text-surface-200 mb-1">
        {{ debouncedSearch ? 'No companies found' : 'No companies yet' }}
      </h3>
      <p class="text-sm text-surface-500 dark:text-surface-400">
        {{ debouncedSearch
          ? 'Try adjusting your search terms.'
          : 'Add a client company to start linking client contacts to jobs.'
        }}
      </p>
    </div>

    <!-- Company list -->
    <div v-else class="space-y-2">
      <div
        v-for="c in companies"
        :key="c.id"
        class="flex items-center justify-between rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-4 py-3 hover:border-surface-300 dark:hover:border-surface-700 hover:shadow-sm transition-all group"
      >
        <NuxtLink
          :to="$localePath(`/dashboard/companies/${c.id}`)"
          class="min-w-0 flex-1"
        >
          <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-100 group-hover:text-brand-600 transition-colors truncate">
            {{ c.name }}
          </h3>
          <div class="flex items-center gap-3 text-xs text-surface-400">
            <span v-if="c.website">{{ c.website }}</span>
            <span>{{ c.activeContactCount }} active contact{{ c.activeContactCount === 1 ? '' : 's' }}</span>
            <span>Added {{ new Date(c.createdAt).toLocaleDateString() }}</span>
          </div>
        </NuxtLink>
        <button
          class="shrink-0 rounded-lg border border-danger-300 dark:border-danger-700 px-3 py-1 text-xs font-medium text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950 opacity-0 group-hover:opacity-100 transition-opacity"
          @click="showDeleteConfirm = c.id"
        >
          Delete
        </button>
      </div>

      <!-- Total count -->
      <p class="text-xs text-surface-400 pt-2">
        {{ total }} compan{{ total === 1 ? 'y' : 'ies' }} total
      </p>
    </div>

    <!-- Delete confirmation dialog -->
    <Teleport to="body">
      <div v-if="showDeleteConfirm" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/50" @click="showDeleteConfirm = null" />
        <div class="relative bg-white dark:bg-surface-900 rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
          <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-2">Delete Company</h3>
          <p class="text-sm text-surface-600 dark:text-surface-400 mb-4">
            Are you sure you want to delete this company?
            <template v-if="companies.find(c => c.id === showDeleteConfirm)?.activeContactCount">
              It has contact role history — the delete will be rejected.
            </template>
          </p>
          <div class="flex justify-end gap-2">
            <button
              :disabled="isDeleting"
              class="rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              @click="showDeleteConfirm = null"
            >
              Cancel
            </button>
            <button
              :disabled="isDeleting"
              class="rounded-lg bg-danger-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50 transition-colors"
              @click="handleDelete(showDeleteConfirm!)"
            >
              {{ isDeleting ? 'Deleting…' : 'Delete' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
