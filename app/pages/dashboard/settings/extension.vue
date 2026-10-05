<script setup lang="ts">
import {
  Puzzle, Plus, Copy, Check, Trash2, Loader2, X, AlertTriangle,
} from 'lucide-vue-next'

definePageMeta({})

useSeoMeta({
  title: 'Browser Extension — MyRecruiter',
  description: 'Manage API keys for the Save-to-ATS browser extension',
})

const { allowed: canCreateCandidate } = usePermission({ candidate: ['create'] })

// ─────────────────────────────────────────────
// Key list
// ─────────────────────────────────────────────
interface ExtensionKey {
  id: string
  name: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

const keys = ref<ExtensionKey[]>([])
const isLoading = ref(true)
const listError = ref('')

async function fetchKeys() {
  isLoading.value = true
  listError.value = ''
  try {
    keys.value = await $fetch<ExtensionKey[]>('/api/extension-keys')
  }
  catch (err: any) {
    listError.value = err?.data?.statusMessage || 'Failed to load extension keys'
  }
  finally {
    isLoading.value = false
  }
}

onMounted(fetchKeys)

// ─────────────────────────────────────────────
// Create key
// ─────────────────────────────────────────────
const showCreateForm = ref(false)
const newKeyName = ref('')
const isCreating = ref(false)
const createError = ref('')
const createdKey = ref<{ id: string; name: string; keyPrefix: string; key: string } | null>(null)

async function handleCreate() {
  if (!newKeyName.value.trim()) return
  isCreating.value = true
  createError.value = ''

  try {
    createdKey.value = await $fetch<{ id: string; name: string; keyPrefix: string; createdAt: string; key: string }>('/api/extension-keys', {
      method: 'POST',
      body: { name: newKeyName.value.trim() },
    })
    showCreateForm.value = false
    newKeyName.value = ''
    await fetchKeys()
  }
  catch (err: any) {
    createError.value = err?.data?.statusMessage || 'Failed to create extension key'
  }
  finally {
    isCreating.value = false
  }
}

// ─────────────────────────────────────────────
// Copy the one-time plaintext key
// ─────────────────────────────────────────────
const copied = ref(false)

async function copyKeyToClipboard() {
  if (!createdKey.value) return
  try {
    await navigator.clipboard.writeText(createdKey.value.key)
  }
  catch {
    // Fallback for non-secure contexts
    const textArea = document.createElement('textarea')
    textArea.value = createdKey.value.key
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
  }
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

function dismissCreatedKey() {
  createdKey.value = null
}

// ─────────────────────────────────────────────
// Revoke key
// ─────────────────────────────────────────────
const keyToRevoke = ref<ExtensionKey | null>(null)
const isRevoking = ref(false)
const revokeError = ref('')

async function handleRevoke() {
  if (!keyToRevoke.value) return
  isRevoking.value = true
  revokeError.value = ''

  try {
    await $fetch(`/api/extension-keys/${keyToRevoke.value.id}`, { method: 'DELETE' })
    keyToRevoke.value = null
    await fetchKeys()
  }
  catch (err: any) {
    revokeError.value = err?.data?.statusMessage || 'Failed to revoke key'
  }
  finally {
    isRevoking.value = false
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function formatDate(value: string | null): string {
  if (!value) return 'Never'
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <!-- Page title -->
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">
        Browser extension
      </h1>
      <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
        Lets the Save-to-ATS browser extension add candidates to this organisation as you.
      </p>
    </div>

    <!-- One-time key reveal -->
    <Transition
      enter-active-class="transition-all duration-200"
      leave-active-class="transition-all duration-200"
      enter-from-class="opacity-0 -translate-y-2"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div v-if="createdKey" class="mb-6 rounded-xl border border-warning-200 dark:border-warning-900 bg-warning-50 dark:bg-warning-950/40 p-5">
        <div class="flex items-start gap-3">
          <AlertTriangle class="size-5 text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-semibold text-warning-800 dark:text-warning-300">
              Copy this key now — it won't be shown again.
            </h3>
            <div class="mt-3 flex items-center gap-2">
              <input
                :value="createdKey.key"
                readonly
                class="flex-1 min-w-0 rounded-lg border border-warning-200 dark:border-warning-800 bg-white dark:bg-surface-900 px-3 py-2 font-mono text-xs text-surface-900 dark:text-surface-100 focus:outline-none"
                @focus="($event.target as HTMLInputElement).select()"
              >
              <button
                class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700 transition-colors whitespace-nowrap"
                @click="copyKeyToClipboard"
              >
                <Check v-if="copied" class="size-3.5" />
                <Copy v-else class="size-3.5" />
                {{ copied ? 'Copied' : 'Copy' }}
              </button>
              <button
                class="p-2 rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-white dark:hover:bg-surface-800 transition-colors"
                title="Done"
                @click="dismissCreatedKey"
              >
                <X class="size-4" />
              </button>
            </div>
            <p class="mt-2 text-xs text-warning-700 dark:text-warning-400/80">
              Key “{{ createdKey.name }}” · paste it into the extension's options page.
            </p>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Create form -->
    <section v-if="canCreateCandidate" class="mb-6">
      <button
        v-if="!showCreateForm"
        class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        @click="showCreateForm = true"
      >
        <Plus class="size-4" />
        New extension key
      </button>

      <Transition
        enter-active-class="transition-all duration-200"
        leave-active-class="transition-all duration-200"
        enter-from-class="opacity-0 -translate-y-2"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div v-if="showCreateForm" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <Puzzle class="size-5 text-brand-600 dark:text-brand-400" />
              <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-100">New extension key</h3>
            </div>
            <button
              class="p-1 rounded-md text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              @click="showCreateForm = false; createError = ''"
            >
              <X class="size-4" />
            </button>
          </div>

          <div class="flex gap-3">
            <div class="flex-1">
              <label for="extension-key-name" class="sr-only">Key name</label>
              <input
                id="extension-key-name"
                v-model="newKeyName"
                type="text"
                maxlength="100"
                placeholder="e.g. Chrome on my laptop"
                class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                @keydown.enter="handleCreate"
              >
            </div>
            <button
              :disabled="isCreating || !newKeyName.trim()"
              class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              @click="handleCreate"
            >
              <Loader2 v-if="isCreating" class="size-4 animate-spin" />
              {{ isCreating ? 'Creating…' : 'Create key' }}
            </button>
          </div>

          <div v-if="createError" class="mt-3 rounded-lg bg-danger-50 dark:bg-danger-950/40 border border-danger-200 dark:border-danger-900 px-3 py-2 text-sm text-danger-700 dark:text-danger-400">
            {{ createError }}
          </div>
        </div>
      </Transition>
    </section>

    <!-- Keys table -->
    <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
      <div class="px-6 py-5 border-b border-surface-200 dark:border-surface-800">
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center size-10 rounded-lg bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400">
            <Puzzle class="size-5" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Your extension keys</h2>
            <p class="text-sm text-surface-500 dark:text-surface-400">
              {{ isLoading ? 'Loading…' : `${keys.filter(k => !k.revokedAt).length} active` }}
            </p>
          </div>
        </div>
      </div>

      <!-- Loading state -->
      <div v-if="isLoading" class="px-6 py-8 text-center text-surface-400 text-sm">
        <Loader2 class="size-5 animate-spin mx-auto mb-2" />
        Loading keys…
      </div>

      <!-- Error state -->
      <div v-else-if="listError" class="px-6 py-8 text-center">
        <AlertTriangle class="size-6 text-danger-400 mx-auto mb-2" />
        <p class="text-sm text-danger-600 dark:text-danger-400">{{ listError }}</p>
        <button class="mt-2 text-sm text-brand-600 hover:text-brand-700 underline" @click="fetchKeys">
          Retry
        </button>
      </div>

      <!-- Empty state -->
      <div v-else-if="keys.length === 0" class="px-6 py-8 text-center text-sm text-surface-400 dark:text-surface-500">
        No extension keys yet. Create one to connect the Save-to-ATS extension.
      </div>

      <!-- Keys list -->
      <div v-else class="divide-y divide-surface-100 dark:divide-surface-800">
        <div
          v-for="k in keys"
          :key="k.id"
          class="px-6 py-4 flex items-center gap-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
          :class="{ 'opacity-50': !!k.revokedAt }"
        >
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
              {{ k.name }}
            </div>
            <div class="flex items-center gap-3 text-xs text-surface-400 dark:text-surface-500 mt-0.5">
              <span class="font-mono">{{ k.keyPrefix }}…</span>
              <span>Created {{ formatDate(k.createdAt) }}</span>
              <span>Last used {{ k.lastUsedAt ? formatDate(k.lastUsedAt) : 'never' }}</span>
            </div>
          </div>

          <!-- Status badge -->
          <div class="flex-shrink-0">
            <span
              class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
              :class="k.revokedAt
                ? 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400'
                : 'bg-success-50 dark:bg-success-950/40 text-success-700 dark:text-success-400'"
            >
              {{ k.revokedAt ? 'Revoked' : 'Active' }}
            </span>
          </div>

          <!-- Revoke -->
          <div v-if="!k.revokedAt" class="flex-shrink-0">
            <button
              class="inline-flex items-center gap-1.5 rounded-lg border border-danger-200 dark:border-danger-800 bg-white dark:bg-surface-800 px-3 py-1.5 text-xs font-medium text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/40 transition-colors"
              @click="keyToRevoke = k"
            >
              <Trash2 class="size-3" />
              Revoke
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Revoke confirmation modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-150"
        leave-active-class="transition-opacity duration-100"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="keyToRevoke"
          class="fixed inset-0 z-50 flex items-center justify-center bg-surface-900/50 p-4"
          @click.self="keyToRevoke = null"
        >
          <div class="w-full max-w-md rounded-xl bg-white dark:bg-surface-900 shadow-xl border border-surface-200 dark:border-surface-800 p-6">
            <div class="flex items-center gap-3 mb-3">
              <div class="flex items-center justify-center size-10 rounded-full bg-danger-50 dark:bg-danger-950 flex-shrink-0">
                <Trash2 class="size-5 text-danger-500" />
              </div>
              <div>
                <h3 class="text-base font-semibold text-surface-900 dark:text-surface-100">
                  Revoke extension key?
                </h3>
                <p class="text-sm text-surface-500 dark:text-surface-400 truncate">
                  “{{ keyToRevoke.name }}” will stop working immediately.
                </p>
              </div>
            </div>
            <p class="text-sm text-surface-600 dark:text-surface-400 mb-5">
              The Save-to-ATS extension will no longer be able to add candidates with this key. This can't be undone, but you can create a new key.
            </p>
            <div v-if="revokeError" class="mb-4 rounded-lg bg-danger-50 dark:bg-danger-950/40 border border-danger-200 dark:border-danger-900 px-3 py-2 text-sm text-danger-700 dark:text-danger-400">
              {{ revokeError }}
            </div>
            <div class="flex gap-3 justify-end">
              <button
                class="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
                @click="keyToRevoke = null; revokeError = ''"
              >
                Cancel
              </button>
              <button
                :disabled="isRevoking"
                class="inline-flex items-center gap-2 rounded-lg bg-danger-600 px-4 py-2 text-sm font-medium text-white hover:bg-danger-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                @click="handleRevoke"
              >
                <Loader2 v-if="isRevoking" class="size-4 animate-spin" />
                {{ isRevoking ? 'Revoking…' : 'Revoke key' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
