<script setup lang="ts">
import { ArrowLeft, Building2, Pencil, Trash2, Mail } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const companyId = route.params.id as string
const { handlePreviewReadOnlyError } = usePreviewReadOnly()

type CompanyDetail = {
  id: string
  name: string
  website: string | null
  createdAt: string
  contacts: {
    candidateId: string
    firstName: string
    lastName: string
    active: boolean
    startedAt: string
    endedAt: string | null
    primaryEmail: string | null
  }[]
}

const { data: company, status: fetchStatus, error, refresh } = await useFetch<CompanyDetail>(`/api/client-companies/${companyId}`, {
  key: `company-${companyId}`,
  headers: useRequestHeaders(['cookie']),
})

useSeoMeta({
  title: computed(() => company.value ? `${company.value.name} — MyRecruiter` : 'Company — MyRecruiter'),
})

const activeContacts = computed(() => company.value?.contacts.filter((c) => c.active) ?? [])
const pastContacts = computed(() => company.value?.contacts.filter((c) => !c.active) ?? [])

// ─────────────────────────────────────────────
// Edit name / website
// ─────────────────────────────────────────────

const isEditing = ref(false)
const editName = ref('')
const editWebsite = ref('')
const isSaving = ref(false)
const editError = ref<string | null>(null)

function startEdit() {
  if (!company.value) return
  editName.value = company.value.name
  editWebsite.value = company.value.website ?? ''
  isEditing.value = true
}

const { updateCompany, deleteCompany } = useClientCompanies({ mutationsOnly: true })
const localePath = useLocalePath()

async function handleSave() {
  editError.value = null
  isSaving.value = true
  try {
    await updateCompany(companyId, {
      name: editName.value,
      website: editWebsite.value.trim() || null,
    })
    isEditing.value = false
    await refresh()
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    editError.value = err.data?.statusMessage ?? 'Failed to save changes'
  }
  finally {
    isSaving.value = false
  }
}

// ─────────────────────────────────────────────
// Delete (blocked by role history → 409 surfaced)
// ─────────────────────────────────────────────

const showDeleteConfirm = ref(false)
const isDeleting = ref(false)

async function handleDelete() {
  isDeleting.value = true
  try {
    await deleteCompany(companyId)
    await navigateTo(localePath('/dashboard/companies'))
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    editError.value = err.data?.statusMessage ?? 'Failed to delete company'
    showDeleteConfirm.value = false
  }
  finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <!-- Back link -->
    <NuxtLink
      :to="$localePath('/dashboard/companies')"
      class="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 mb-6 transition-colors"
    >
      <ArrowLeft class="size-4" />
      Back to Companies
    </NuxtLink>

    <!-- Loading -->
    <div v-if="fetchStatus === 'pending'" class="text-center py-12 text-surface-400">
      Loading company…
    </div>

    <!-- Error / not found -->
    <div
      v-else-if="error"
      class="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700"
    >
      {{ error.statusCode === 404 ? 'Company not found.' : 'Failed to load company.' }}
      <NuxtLink :to="$localePath('/dashboard/companies')" class="underline ml-1">Back to Companies</NuxtLink>
    </div>

    <!-- Company detail -->
    <template v-else-if="company">
      <!-- VIEW MODE -->
      <div v-if="!isEditing">
        <div class="flex items-start justify-between gap-4 mb-6">
          <div class="min-w-0">
            <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50 truncate mb-1 flex items-center gap-2">
              <Building2 class="size-6 text-surface-400 shrink-0" />
              {{ company.name }}
            </h1>
            <p v-if="company.website" class="text-sm text-surface-500">
              <a :href="company.website" target="_blank" rel="noopener noreferrer" class="hover:text-brand-600 transition-colors">
                {{ company.website }}
              </a>
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              @click="startEdit"
            >
              <Pencil class="size-3.5" />
              Edit
            </button>
            <button
              class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-danger-300 dark:border-danger-700 px-3 py-1.5 text-sm font-medium text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950 transition-colors"
              @click="showDeleteConfirm = true"
            >
              <Trash2 class="size-3.5" />
              Delete
            </button>
          </div>
        </div>

        <p v-if="editError" class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400 mb-4">
          {{ editError }}
          <button class="underline ml-1" @click="editError = null">Dismiss</button>
        </p>

        <!-- Contacts -->
        <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
          <h2 class="text-sm font-semibold text-surface-700 dark:text-surface-200 mb-3">
            Contacts ({{ activeContacts.length }} active<template v-if="pastContacts.length"> · {{ pastContacts.length }} past</template>)
          </h2>

          <div v-if="company.contacts.length === 0" class="py-6 text-center">
            <p class="text-sm text-surface-500 dark:text-surface-400">No contacts at this company yet.</p>
            <p class="text-xs text-surface-400 mt-1">
              Give someone a <em>Client contact</em> role from their profile, selecting this company.
            </p>
          </div>

          <div v-else class="space-y-2">
            <NuxtLink
              v-for="c in company.contacts"
              :key="c.candidateId"
              :to="$localePath(`/dashboard/candidates/${c.candidateId}`)"
              class="flex items-center justify-between rounded-lg border border-surface-200 dark:border-surface-800 px-4 py-3 hover:border-surface-300 dark:hover:border-surface-700 transition-colors"
              :class="c.active ? 'bg-white dark:bg-surface-900' : 'bg-surface-50/60 dark:bg-surface-800/40 opacity-60'"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">
                  {{ c.firstName }} {{ c.lastName }}
                  <span v-if="!c.active" class="text-xs font-normal text-surface-400">(past contact)</span>
                </p>
                <p v-if="c.primaryEmail" class="text-xs text-surface-400 inline-flex items-center gap-1">
                  <Mail class="size-3" />
                  {{ c.primaryEmail }}
                </p>
              </div>
              <span class="text-xs text-surface-400 shrink-0">
                <template v-if="c.active">since {{ new Date(c.startedAt).toLocaleDateString() }}</template>
                <template v-else>{{ new Date(c.startedAt).toLocaleDateString() }} → {{ c.endedAt ? new Date(c.endedAt).toLocaleDateString() : '—' }}</template>
              </span>
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- EDIT MODE -->
      <div v-else>
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50 mb-6">Edit Company</h1>

        <form class="space-y-5" @submit.prevent="handleSave">
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              Name <span class="text-danger-500">*</span>
            </label>
            <input
              v-model="editName"
              type="text"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Website</label>
            <input
              v-model="editWebsite"
              type="text"
              placeholder="https://…"
              class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            />
          </div>
          <p v-if="editError" class="text-xs text-danger-600 dark:text-danger-400">{{ editError }}</p>
          <div class="flex items-center gap-3 pt-2">
            <button
              type="submit"
              :disabled="isSaving || !editName.trim()"
              class="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {{ isSaving ? 'Saving…' : 'Save Changes' }}
            </button>
            <button
              type="button"
              class="rounded-lg border border-surface-300 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              @click="isEditing = false; editError = null"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>

      <!-- Delete confirmation dialog -->
      <Teleport to="body">
        <div v-if="showDeleteConfirm" class="fixed inset-0 z-50 flex items-center justify-center">
          <div class="absolute inset-0 bg-black/50" @click="showDeleteConfirm = false" />
          <div class="relative bg-white dark:bg-surface-900 rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-2">Delete Company</h3>
            <p class="text-sm text-surface-600 dark:text-surface-400 mb-4">
              Are you sure you want to delete <strong>{{ company.name }}</strong>?
              <template v-if="company.contacts.length">
                It has contact role history — the delete will be rejected (soft-delete is coming later).
              </template>
            </p>
            <div class="flex justify-end gap-2">
              <button
                :disabled="isDeleting"
                class="rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                @click="showDeleteConfirm = false"
              >
                Cancel
              </button>
              <button
                :disabled="isDeleting"
                class="rounded-lg bg-danger-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50 transition-colors"
                @click="handleDelete"
              >
                {{ isDeleting ? 'Deleting…' : 'Delete' }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>
