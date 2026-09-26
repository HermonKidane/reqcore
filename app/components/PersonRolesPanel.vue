<script setup lang="ts">
/**
 * PersonRolesPanel — the "Roles" tab on the person detail page.
 *
 * Active roles with End actions + an add-role form; below, the immutable
 * role-history timeline (ended rows). 'candidate' is NEVER shown here —
 * candidacy is application-derived and rendered as a chip by the parent.
 */
import { Plus, Building2, UserRound, Handshake, History } from 'lucide-vue-next'

const props = defineProps<{
  candidateId: string
}>()

const emit = defineEmits<{
  changed: []
}>()

const { handlePreviewReadOnlyError } = usePreviewReadOnly()

type Role = {
  id: string
  role: 'prospect' | 'connection' | 'client_contact'
  clientCompanyId: string | null
  companyName: string | null
  startedAt: string
  endedAt: string | null
  active: boolean
}

const { data, status: rolesFetchStatus, error: rolesFetchError, refresh } = await useFetch<Role[]>(`/api/candidates/${props.candidateId}/roles`, {
  key: `person-roles-${props.candidateId}`,
  headers: useRequestHeaders(['cookie']),
})

const roles = computed(() => data.value ?? [])
const activeRoles = computed(() => roles.value.filter((r) => r.active))
const endedRoles = computed(() => roles.value.filter((r) => !r.active))

const roleLabels: Record<Role['role'], string> = {
  prospect: 'Prospect',
  connection: 'Connection',
  client_contact: 'Client contact',
}

function roleChipClasses(role: Role['role']): string {
  switch (role) {
    case 'connection':
      return 'bg-info-50 text-info-700 dark:bg-info-950 dark:text-info-400'
    case 'prospect':
      return 'bg-warning-50 text-warning-700 dark:bg-warning-950 dark:text-warning-400'
    case 'client_contact':
      return 'bg-success-50 text-success-700 dark:bg-success-950 dark:text-success-400'
  }
}

// ─────────────────────────────────────────────
// Add-role form
// ─────────────────────────────────────────────

const showAddForm = ref(false)
const newRole = ref<'prospect' | 'connection' | 'client_contact'>('connection')
const newCompanyId = ref('')
const isSaving = ref(false)
const formError = ref<string | null>(null)

const { companies } = useClientCompanies()

async function handleAddRole() {
  formError.value = null
  isSaving.value = true
  try {
    await $fetch(`/api/candidates/${props.candidateId}/roles`, {
      method: 'POST',
      body: {
        role: newRole.value,
        ...(newRole.value === 'client_contact' && newCompanyId.value
          ? { clientCompanyId: newCompanyId.value }
          : {}),
      },
    })
    showAddForm.value = false
    newCompanyId.value = ''
    await refresh()
    emit('changed')
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    formError.value = err.data?.statusMessage ?? 'Failed to add role'
  }
  finally {
    isSaving.value = false
  }
}

// ─────────────────────────────────────────────
// End role
// ─────────────────────────────────────────────

const endingId = ref<string | null>(null)

async function handleEndRole(roleId: string) {
  endingId.value = roleId
  try {
    await $fetch(`/api/person-roles/${roleId}`, { method: 'PATCH', body: { action: 'end' } })
    await refresh()
    emit('changed')
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    // 409 = already ended (stale view) — just refresh, no toast
    if (err.data?.statusCode === 409) {
      await refresh()
      emit('changed')
      return
    }
    alert(err.data?.statusMessage ?? 'Failed to end role')
  }
  finally {
    endingId.value = null
  }
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : '—'
}
</script>

<template>
  <div>
    <!-- Fetch error (cross-org, 500) — surface instead of a fake empty state -->
    <div
      v-if="rolesFetchStatus === 'error'"
      class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-4 text-sm text-danger-700 dark:text-danger-400"
    >
      Failed to load roles.
      <button class="underline ml-1" @click="refresh()">Retry</button>
    </div>

    <template v-else>
    <!-- Active roles -->
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-200">
        Active roles ({{ activeRoles.length }})
      </h3>
      <button
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
        @click="showAddForm = !showAddForm"
      >
        <Plus class="size-3.5" />
        Add role
      </button>
    </div>

    <!-- Add-role form -->
    <div
      v-if="showAddForm"
      class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4 mb-4"
    >
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <label class="block text-xs font-medium text-surface-500 mb-1">Role</label>
          <select
            v-model="newRole"
            class="rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-sm text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="connection">Connection</option>
            <option value="prospect">Prospect</option>
            <option value="client_contact">Client contact</option>
          </select>
        </div>
        <div v-if="newRole === 'client_contact'">
          <label class="block text-xs font-medium text-surface-500 mb-1">Company</label>
          <select
            v-model="newCompanyId"
            class="rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-sm text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="" disabled>Select a company</option>
            <option v-for="c in companies" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="flex gap-2">
          <button
            :disabled="isSaving || (newRole === 'client_contact' && !newCompanyId)"
            class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="handleAddRole"
          >
            {{ isSaving ? 'Saving…' : 'Save' }}
          </button>
          <button
            class="rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            @click="showAddForm = false; formError = null"
          >
            Cancel
          </button>
        </div>
      </div>
      <p v-if="formError" class="mt-2 text-xs text-danger-600 dark:text-danger-400">{{ formError }}</p>
      <p v-if="newRole === 'client_contact' && companies.length === 0" class="mt-2 text-xs text-surface-500">
        No client companies yet —
        <NuxtLink :to="$localePath('/dashboard/companies')" class="text-brand-600 hover:underline">create one first</NuxtLink>.
      </p>
    </div>

    <!-- Empty state -->
    <div
      v-if="activeRoles.length === 0 && !showAddForm"
      class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 text-center mb-4"
    >
      <p class="text-sm text-surface-500 dark:text-surface-400">No active roles.</p>
    </div>

    <!-- Active role rows -->
    <div v-else-if="activeRoles.length > 0" class="space-y-2 mb-6">
      <div
        v-for="r in activeRoles"
        :key="r.id"
        class="flex items-center justify-between rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-4 py-3"
      >
        <div class="flex items-center gap-3 min-w-0">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium shrink-0"
            :class="roleChipClasses(r.role)"
          >
            <Building2 v-if="r.role === 'client_contact'" class="size-3" />
            <Handshake v-else-if="r.role === 'connection'" class="size-3" />
            <UserRound v-else class="size-3" />
            {{ roleLabels[r.role] }}<template v-if="r.companyName"> · {{ r.companyName }}</template>
          </span>
          <span class="text-xs text-surface-400 truncate">
            since {{ formatDate(r.startedAt) }}
          </span>
        </div>
        <button
          :disabled="endingId === r.id"
          class="shrink-0 rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50 transition-colors"
          @click="handleEndRole(r.id)"
        >
          {{ endingId === r.id ? 'Ending…' : 'End' }}
        </button>
      </div>
    </div>

    <!-- Role-history timeline -->
    <div v-if="endedRoles.length > 0">
      <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-200 mb-3 flex items-center gap-1.5">
        <History class="size-4 text-surface-400" />
        Role history
      </h3>
      <div class="relative pl-5 space-y-3 before:absolute before:left-[5px] before:top-1 before:bottom-1 before:w-px before:bg-surface-200 dark:before:bg-surface-700">
        <div
          v-for="r in endedRoles"
          :key="r.id"
          class="relative"
        >
          <span class="absolute -left-5 top-1.5 size-2.5 rounded-full bg-surface-300 dark:bg-surface-600 ring-4 ring-surface-50 dark:ring-surface-950" />
          <p class="text-sm text-surface-600 dark:text-surface-300">
            <span class="font-medium">{{ roleLabels[r.role] }}</span><template v-if="r.companyName"> · {{ r.companyName }}</template>
          </p>
          <p class="text-xs text-surface-400">
            {{ formatDate(r.startedAt) }} → {{ formatDate(r.endedAt) }}
          </p>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>
