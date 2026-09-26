<script setup lang="ts">
/**
 * JobClientContacts — the "Client contacts" card on the job detail page.
 *
 * Lists the job's client contacts (primary first), lets the recruiter add
 * a contact (only people holding an ACTIVE client_contact role are
 * linkable — the API 422s otherwise), promote/demote the primary contact,
 * and remove links. Links whose holder's role has ENDED show greyed
 * (roleActive=false) as history.
 */
import { Star, Plus, X, ChevronDown } from 'lucide-vue-next'

const props = defineProps<{
  jobId: string
}>()

const { handlePreviewReadOnlyError } = usePreviewReadOnly()

type Contact = {
  id: string
  candidateId: string
  firstName: string
  lastName: string
  label: string | null
  isPrimary: boolean
  roleActive: boolean
  primaryEmail: string | null
}

const { data, refresh } = await useFetch<{ data: Contact[] }>(`/api/jobs/${props.jobId}/contacts`, {
  key: `job-contacts-${props.jobId}`,
  headers: useRequestHeaders(['cookie']),
})

const contacts = computed(() => data.value?.data ?? [])
const isOpen = ref(false)

// ─────────────────────────────────────────────
// Add-contact picker: people with an active client_contact role
// ─────────────────────────────────────────────

const showAddForm = ref(false)
const pickedCandidateId = ref('')
const pickedLabel = ref('')
const makePrimary = ref(false)
const isSaving = ref(false)
const formError = ref<string | null>(null)

interface PickerPerson {
  id: string
  firstName: string
  lastName: string
  email: string | null
}

const { data: pickerData } = await useFetch<{ data: PickerPerson[] }>('/api/candidates', {
  key: `job-contact-picker-${props.jobId}`,
  query: { role: 'client_contact', limit: 100 },
  headers: useRequestHeaders(['cookie']),
})

const linkable = computed(() => {
  const linked = new Set(contacts.value.map((c) => c.candidateId))
  return (pickerData.value?.data ?? []).filter((p) => !linked.has(p.id))
})

async function handleAddContact() {
  formError.value = null
  isSaving.value = true
  try {
    await $fetch(`/api/jobs/${props.jobId}/contacts`, {
      method: 'POST',
      body: {
        candidateId: pickedCandidateId.value,
        ...(pickedLabel.value.trim() ? { label: pickedLabel.value.trim() } : {}),
        isPrimary: makePrimary.value,
      },
    })
    showAddForm.value = false
    pickedCandidateId.value = ''
    pickedLabel.value = ''
    makePrimary.value = false
    await refresh()
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    formError.value = err.data?.statusMessage ?? 'Failed to add contact'
  }
  finally {
    isSaving.value = false
  }
}

// ─────────────────────────────────────────────
// Promote / demote / remove
// ─────────────────────────────────────────────

async function handleSetPrimary(contact: Contact, value: boolean) {
  try {
    await $fetch(`/api/jobs/${props.jobId}/contacts/${contact.id}`, {
      method: 'PATCH',
      body: { isPrimary: value },
    })
    await refresh()
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    alert(err.data?.statusMessage ?? 'Failed to update contact')
  }
}

async function handleRemove(contact: Contact) {
  try {
    await $fetch(`/api/jobs/${props.jobId}/contacts/${contact.id}`, { method: 'DELETE' })
    await refresh()
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    alert(err.data?.statusMessage ?? 'Failed to remove contact')
  }
}
</script>

<template>
  <div class="shrink-0 border-b border-surface-200/80 bg-white dark:border-surface-800/60 dark:bg-surface-900">
    <button
      class="flex w-full cursor-pointer items-center justify-between px-5 py-2 text-sm font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/60 transition-colors"
      @click="isOpen = !isOpen"
    >
      <span class="flex items-center gap-2">
        Client contacts
        <span
          v-if="contacts.length"
          class="inline-flex min-w-[20px] items-center justify-center rounded-md bg-surface-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-surface-500 dark:bg-surface-800/80 dark:text-surface-400"
        >
          {{ contacts.length }}
        </span>
      </span>
      <ChevronDown class="size-4 transition-transform" :class="isOpen ? 'rotate-180' : ''" />
    </button>

    <div v-if="isOpen" class="border-t border-surface-200/80 dark:border-surface-800/60 px-5 py-3">
      <!-- Empty state -->
      <p v-if="contacts.length === 0 && !showAddForm" class="text-xs text-surface-400 mb-2">
        No client contacts linked to this job yet.
      </p>

      <!-- Contact rows -->
      <div v-else-if="contacts.length > 0" class="flex flex-wrap items-center gap-2 mb-3">
        <div
          v-for="c in contacts"
          :key="c.id"
          class="group inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs"
          :class="c.roleActive
            ? 'border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/60'
            : 'border-surface-200/60 dark:border-surface-800 border-dashed opacity-60'"
          :title="c.roleActive ? undefined : 'Client-contact role has ended (historical)'"
        >
          <button
            class="rounded p-0.5"
            :class="[
              c.roleActive ? 'cursor-pointer' : 'cursor-not-allowed',
              c.isPrimary ? 'text-warning-500' : c.roleActive ? 'text-surface-300 dark:text-surface-600 hover:text-warning-400' : 'text-surface-300 dark:text-surface-600',
            ]"
            :title="!c.roleActive
              ? 'Client-contact role has ended (historical)'
              : c.isPrimary ? 'Primary contact — click to demote' : 'Make primary'"
            :disabled="!c.roleActive"
            @click="handleSetPrimary(c, !c.isPrimary)"
          >
            <Star class="size-3.5" :fill="c.isPrimary ? 'currentColor' : 'none'" />
          </button>
          <NuxtLink
            :to="$localePath(`/dashboard/candidates/${c.candidateId}`)"
            class="font-medium text-surface-700 dark:text-surface-200 hover:text-brand-600 transition-colors"
          >
            {{ c.firstName }} {{ c.lastName }}
          </NuxtLink>
          <span v-if="c.label" class="text-surface-400">· {{ c.label }}</span>
          <button
            class="cursor-pointer rounded p-0.5 text-surface-300 dark:text-surface-600 hover:text-danger-500 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Remove link"
            @click="handleRemove(c)"
          >
            <X class="size-3.5" />
          </button>
        </div>
      </div>

      <!-- Add-contact form -->
      <div v-if="showAddForm" class="flex flex-wrap items-end gap-2 mb-2">
        <select
          v-model="pickedCandidateId"
          class="rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-xs text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="" disabled>Select a contact</option>
          <option v-for="p in linkable" :key="p.id" :value="p.id">
            {{ p.firstName }} {{ p.lastName }}<template v-if="p.email"> — {{ p.email }}</template>
          </option>
        </select>
        <input
          v-model="pickedLabel"
          type="text"
          placeholder="Label (e.g. Hiring manager)"
          class="rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-xs text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <label class="inline-flex items-center gap-1 text-xs text-surface-500">
          <input v-model="makePrimary" type="checkbox" class="rounded border-surface-300" />
          Primary
        </label>
        <div class="flex gap-2">
          <button
            :disabled="isSaving || !pickedCandidateId"
            class="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="handleAddContact"
          >
            {{ isSaving ? 'Saving…' : 'Add' }}
          </button>
          <button
            class="rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            @click="showAddForm = false; formError = null"
          >
            Cancel
          </button>
        </div>
      </div>
      <p v-if="formError" class="text-xs text-danger-600 dark:text-danger-400 mb-2">{{ formError }}</p>

      <button
        v-if="!showAddForm"
        class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-surface-300 dark:border-surface-600 px-2.5 py-1 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
        @click="showAddForm = true"
      >
        <Plus class="size-3" />
        Add contact
      </button>
      <p v-else-if="linkable.length === 0" class="text-xs text-surface-400">
        No linkable contacts — people need an active
        <em>Client contact</em> role first (set it on their profile).
      </p>
    </div>
  </div>
</template>
