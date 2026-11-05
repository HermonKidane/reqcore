<script setup lang="ts">
/**
 * Settings → Account → "Connected sign-ins".
 * Lets a signed-in user connect Google / Microsoft to their existing account
 * (Better Auth `link-social`) or disconnect one (`unlink-account`).
 *
 * Server rules we rely on (Better Auth 1.4): the provider must report the email as
 * verified, it must equal the account's email, and the last sign-in method can't be
 * removed. Errors come back on this page as `?error=<code>`.
 *
 * Microsoft also offers To Do & Calendar sync: "Connect To Do & Calendar"
 * re-links with the extra scopes (`?todo=1` on return turns the sync on).
 */
import { Link2, Loader2, Check, KeyRound, RefreshCw, AlertTriangle } from 'lucide-vue-next'

type ProviderId = 'google' | 'microsoft'
interface LinkedAccount { id: string, providerId: string, accountId?: string, createdAt?: string | Date }

const route = useRoute()
const router = useRouter()
const localePath = useLocalePath()

const { data: providers } = await useFetch('/api/auth-providers', { key: 'auth-providers' })
const { data: session } = await authClient.useSession(useFetch)

const accounts = ref<LinkedAccount[]>([])
const loading = ref(true)
const pending = ref<string | null>(null)
const error = ref('')
const success = ref('')

const PROVIDERS: { id: ProviderId, label: string }[] = [
  { id: 'google', label: 'Google' },
  { id: 'microsoft', label: 'Microsoft' },
]
const availableProviders = computed(() => PROVIDERS.filter(p => providers.value?.[p.id]))
const hasPassword = computed(() => accounts.value.some(a => a.providerId === 'credential'))
const methodCount = computed(() => accounts.value.length)

const ms = useMicrosoftSync()
const msStatus = computed(() => ms.status.value)
const msSyncOn = computed(() => !!msStatus.value?.enabled && !!msStatus.value?.scopesGranted)

function linkedAccount(id: ProviderId) {
  return accounts.value.find(a => a.providerId === id) ?? null
}

async function loadAccounts() {
  loading.value = true
  const result = await authClient.listAccounts()
  if (!result.error) accounts.value = (result.data ?? []) as LinkedAccount[]
  loading.value = false
}

// Better Auth redirects link failures back here as ?error=<code>; successes as ?linked=<provider>.
const linkErrorMessages: Record<string, string> = {
  "email_doesn't_match": 'That account uses a different email address than your MyRecruiter login. Sign in to the provider with the same email and try again.',
  email_doesnt_match: 'That account uses a different email address than your MyRecruiter login. Sign in to the provider with the same email and try again.',
  unable_to_link_account: 'Your sign-in provider did not confirm your email address, so we could not connect it. Ask your IT admin to enable verified email claims.',
  account_already_linked_to_different_user: 'That account is already connected to a different MyRecruiter user.',
  state_mismatch: 'The connection attempt expired. Please try again.',
  please_restart_the_process: 'The connection attempt expired. Please try again.',
}

onMounted(async () => {
  const code = typeof route.query.error === 'string' ? route.query.error : ''
  const linked = typeof route.query.linked === 'string' ? route.query.linked : ''
  const todo = route.query.todo === '1'
  if (code) error.value = linkErrorMessages[code] ?? 'Connecting that account failed. Please try again.'
  if (linked && !todo) {
    const label = PROVIDERS.find(p => p.id === linked)?.label ?? linked
    success.value = `${label} connected. You can now sign in with it.`
  }
  if (code || linked || todo) {
    // Clean the URL so a refresh doesn't repeat the message.
    const { error: _e, linked: _l, todo: _t, ...rest } = route.query
    router.replace({ query: rest })
  }
  await loadAccounts()
  if (providers.value?.microsoft) {
    // Back from "Connect To Do & Calendar": switch the sync on
    if (todo && linked === 'microsoft' && !code) await turnOnSync()
    else await ms.refresh()
  }
})

async function turnOnSync() {
  error.value = ''
  success.value = ''
  if (await ms.enable()) success.value = 'To Do & Calendar connected. Your tasks will appear in the "MyRecruiter" list in Microsoft To Do.'
  else error.value = ms.error.value
}

async function connectTodo() {
  // Scopes already granted and no token trouble: just switch it back on
  if (msStatus.value?.scopesGranted && !msStatus.value?.lastError) return turnOnSync()
  error.value = ''
  success.value = ''
  pending.value = 'microsoft-todo'
  const result = await authClient.linkSocial({
    provider: 'microsoft',
    scopes: MICROSOFT_SYNC_SCOPES,
    callbackURL: localePath('/dashboard/settings/account?linked=microsoft&todo=1'),
    errorCallbackURL: localePath('/dashboard/settings/account'),
  })
  if (result.error) {
    error.value = result.error.message ?? 'Could not start the connection. Please try again.'
    pending.value = null
  }
}

async function syncNow() {
  error.value = ''
  success.value = ''
  if (await ms.syncNow()) {
    success.value = msStatus.value?.lastError ? '' : 'Synced with To Do & Calendar.'
  }
  else error.value = ms.error.value
}

async function turnOffSync() {
  if (!window.confirm('Turn off To Do & Calendar sync? Tasks already in To Do and Outlook stay there; new changes stop syncing.')) return
  error.value = ''
  success.value = ''
  if (await ms.disable()) success.value = 'Sync turned off. Microsoft sign-in still works.'
  else error.value = ms.error.value
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return ''
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

async function connect(provider: ProviderId) {
  error.value = ''
  success.value = ''
  pending.value = provider
  const result = await authClient.linkSocial({
    provider,
    callbackURL: localePath(`/dashboard/settings/account?linked=${provider}`),
    errorCallbackURL: localePath('/dashboard/settings/account'),
  })
  if (result.error) {
    error.value = result.error.message ?? 'Could not start the connection. Please try again.'
    pending.value = null
  }
  // On success the browser is redirected to the provider.
}

async function disconnect(provider: ProviderId) {
  const linked = linkedAccount(provider)
  if (!linked) return
  const label = PROVIDERS.find(p => p.id === provider)?.label ?? provider
  if (!window.confirm(`Disconnect ${label}? You will no longer be able to sign in with it.`)) return
  error.value = ''
  success.value = ''
  pending.value = provider
  const result = await authClient.unlinkAccount({ providerId: provider, accountId: linked.accountId })
  if (result.error) {
    error.value = result.error.message ?? `Could not disconnect ${label}.`
  }
  else {
    success.value = `${label} disconnected.`
    await loadAccounts()
    // No account = nothing to sync with; switch it off cleanly rather than
    // letting the next push fail with a "reconnect" error.
    if (provider === 'microsoft') await (msStatus.value?.enabled ? ms.disable() : ms.refresh())
  }
  pending.value = null
}

function formatDate(value: string | Date | undefined) {
  if (!value) return ''
  return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' })
}
</script>

<template>
  <section class="mt-8 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden" data-testid="connected-accounts">
    <div class="px-6 py-5 border-b border-surface-200 dark:border-surface-800">
      <div class="flex items-center gap-3">
        <div class="flex items-center justify-center size-10 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400">
          <Link2 class="size-5" />
        </div>
        <div>
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Connected sign-ins</h2>
          <p class="text-sm text-surface-500 dark:text-surface-400">Ways you can sign in to this account. Connecting a provider lets you skip the password.</p>
        </div>
      </div>
    </div>

    <div class="px-6 py-5 space-y-4">
      <div v-if="error" class="rounded-lg bg-danger-50 dark:bg-danger-950/40 border border-danger-200 dark:border-danger-900 px-4 py-3 text-sm text-danger-700 dark:text-danger-400" role="alert">
        {{ error }}
      </div>
      <div v-if="success" class="rounded-lg bg-success-50 dark:bg-success-950/40 border border-success-200 dark:border-success-900 px-4 py-3 text-sm text-success-700 dark:text-success-400 flex items-center gap-2" role="status">
        <Check class="size-4 shrink-0" />
        {{ success }}
      </div>

      <div v-if="loading" class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400">
        <Loader2 class="size-4 animate-spin" /> Loading…
      </div>

      <ul v-else class="divide-y divide-surface-200 dark:divide-surface-800" data-testid="sign-in-methods">
        <!-- Email & password -->
        <li class="flex items-center justify-between gap-4 py-3" data-testid="method-password">
          <div class="flex items-center gap-3 min-w-0">
            <span class="flex items-center justify-center size-9 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 shrink-0">
              <KeyRound class="size-4" />
            </span>
            <div class="min-w-0">
              <p class="text-sm font-medium text-surface-900 dark:text-surface-100">Email &amp; password</p>
              <p class="text-xs text-surface-500 dark:text-surface-400 truncate">{{ session?.user?.email }}</p>
            </div>
          </div>
          <span v-if="hasPassword" class="text-xs font-medium text-success-600 dark:text-success-400 flex items-center gap-1 shrink-0">
            <Check class="size-3.5" /> Active
          </span>
          <span v-else class="text-xs text-surface-400 dark:text-surface-500 shrink-0">Not set</span>
        </li>

        <!-- Social providers configured on this server -->
        <li
          v-for="p in availableProviders"
          :key="p.id"
          class="py-3"
          :data-testid="`method-${p.id}`"
        >
          <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div class="flex items-center gap-3 min-w-0">
              <span class="flex items-center justify-center size-9 rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 shrink-0">
                <svg v-if="p.id === 'google'" class="size-4" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.1 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1C3.3 21.3 7.3 24 12 24z"/><path fill="#FBBC05" d="M5.3 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>
                <svg v-else class="size-4" viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="10" height="10" fill="#F25022"/><rect x="13" y="1" width="10" height="10" fill="#7FBA00"/><rect x="1" y="13" width="10" height="10" fill="#00A4EF"/><rect x="13" y="13" width="10" height="10" fill="#FFB900"/></svg>
              </span>
              <div class="min-w-0">
                <p class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ p.label }}</p>
                <p v-if="linkedAccount(p.id)" class="text-xs text-success-600 dark:text-success-400 flex items-center gap-1">
                  <Check class="size-3.5" /> Connected<template v-if="linkedAccount(p.id)?.createdAt"> · since {{ formatDate(linkedAccount(p.id)?.createdAt) }}</template>
                </p>
                <p v-else class="text-xs text-surface-500 dark:text-surface-400">Not connected</p>
                <p v-if="linkedAccount(p.id)" class="text-xs text-surface-500 dark:text-surface-400" :data-testid="`access-${p.id}`">
                  {{ p.id === 'microsoft' && msSyncOn ? 'Sign-in + To Do & Calendar' : 'Sign-in only' }}
                </p>
              </div>
            </div>

            <template v-if="linkedAccount(p.id)">
              <button
                type="button"
                :disabled="pending !== null || methodCount <= 1"
                :title="methodCount <= 1 ? 'This is your only way to sign in. Set a password first.' : undefined"
                class="inline-flex items-center gap-2 rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-1.5 min-h-11 sm:min-h-9 text-sm font-medium text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                :data-testid="`disconnect-${p.id}`"
                @click="disconnect(p.id)"
              >
                <Loader2 v-if="pending === p.id" class="size-4 animate-spin" />
                Disconnect
              </button>
            </template>
            <button
              v-else
              type="button"
              :disabled="pending !== null"
              class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 min-h-11 sm:min-h-9 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              :data-testid="`connect-${p.id}`"
              @click="connect(p.id)"
            >
              <Loader2 v-if="pending === p.id" class="size-4 animate-spin" />
              {{ pending === p.id ? 'Redirecting…' : 'Connect' }}
            </button>
          </div>

          <!-- Microsoft To Do & Calendar sync (only for a linked Microsoft account) -->
          <div
            v-if="p.id === 'microsoft' && linkedAccount('microsoft')"
            class="mt-3 sm:ml-12 rounded-lg bg-surface-50 dark:bg-surface-800/50 px-4 py-3 space-y-2"
            data-testid="microsoft-sync"
          >
            <p class="text-sm font-medium text-surface-900 dark:text-surface-100">To Do &amp; Calendar</p>
            <p class="text-xs text-surface-500 dark:text-surface-400">
              <template v-if="msSyncOn">
                Your tasks sync to the "MyRecruiter" list in Microsoft To Do. Tasks with a time also appear in your Outlook calendar.
                <span v-if="ms.lastSyncedAt.value" data-testid="microsoft-last-sync"> Last synced {{ formatDateTime(ms.lastSyncedAt.value) }}.</span>
              </template>
              <template v-else>
                See your MyRecruiter tasks in Microsoft To Do and timed tasks in Outlook. Microsoft will ask you to allow access to your tasks and calendar.
              </template>
            </p>
            <p
              v-if="msStatus?.lastError"
              class="text-xs text-danger-700 dark:text-danger-400 flex items-start gap-1.5"
              role="alert"
              data-testid="microsoft-sync-error"
            >
              <AlertTriangle class="size-3.5 shrink-0 mt-0.5" />
              <span>{{ msStatus.lastError }}</span>
            </p>
            <div class="flex flex-wrap gap-2 pt-1">
              <template v-if="msSyncOn">
                <button
                  type="button"
                  :disabled="ms.busy.value !== null || pending !== null"
                  class="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 min-h-11 sm:min-h-9 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="microsoft-sync-now"
                  @click="syncNow"
                >
                  <Loader2 v-if="ms.busy.value === 'sync'" class="size-4 animate-spin" />
                  <RefreshCw v-else class="size-4" />
                  {{ ms.busy.value === 'sync' ? 'Syncing…' : 'Sync now' }}
                </button>
                <button
                  type="button"
                  :disabled="ms.busy.value !== null || pending !== null"
                  class="inline-flex items-center justify-center gap-2 rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-1.5 min-h-11 sm:min-h-9 text-sm font-medium text-surface-700 dark:text-surface-200 hover:bg-white dark:hover:bg-surface-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="microsoft-sync-off"
                  @click="turnOffSync"
                >
                  <Loader2 v-if="ms.busy.value === 'disable'" class="size-4 animate-spin" />
                  Turn off sync
                </button>
              </template>
              <button
                v-else
                type="button"
                :disabled="ms.busy.value !== null || pending !== null"
                class="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 min-h-11 sm:min-h-9 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="microsoft-connect-todo"
                @click="connectTodo"
              >
                <Loader2 v-if="pending === 'microsoft-todo' || ms.busy.value === 'enable'" class="size-4 animate-spin" />
                {{ pending === 'microsoft-todo' ? 'Redirecting…' : msStatus?.lastError && msStatus?.scopesGranted ? 'Reconnect To Do & Calendar' : 'Connect To Do & Calendar' }}
              </button>
            </div>
          </div>
        </li>
      </ul>

      <p v-if="!loading && availableProviders.length === 0" class="text-sm text-surface-500 dark:text-surface-400">
        No sign-in providers are configured on this server.
      </p>
    </div>
  </section>
</template>
