<script setup lang="ts">
/**
 * Settings → Account → "Connected sign-ins".
 * Lets a signed-in user connect Google / Microsoft to their existing account
 * (Better Auth `link-social`) or disconnect one (`unlink-account`).
 *
 * Server rules we rely on (Better Auth 1.4): the provider must report the email as
 * verified, it must equal the account's email, and the last sign-in method can't be
 * removed. Errors come back on this page as `?error=<code>`.
 */
import { Link2, Loader2, Check, KeyRound } from 'lucide-vue-next'

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
  if (code) error.value = linkErrorMessages[code] ?? 'Connecting that account failed. Please try again.'
  if (linked) {
    const label = PROVIDERS.find(p => p.id === linked)?.label ?? linked
    success.value = `${label} connected. You can now sign in with it.`
  }
  if (code || linked) {
    // Clean the URL so a refresh doesn't repeat the message.
    const { error: _e, linked: _l, ...rest } = route.query
    router.replace({ query: rest })
  }
  await loadAccounts()
})

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
          class="flex items-center justify-between gap-4 py-3"
          :data-testid="`method-${p.id}`"
        >
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
            </div>
          </div>

          <template v-if="linkedAccount(p.id)">
            <button
              type="button"
              :disabled="pending !== null || methodCount <= 1"
              :title="methodCount <= 1 ? 'This is your only way to sign in. Set a password first.' : undefined"
              class="inline-flex items-center gap-2 rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
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
            class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            :data-testid="`connect-${p.id}`"
            @click="connect(p.id)"
          >
            <Loader2 v-if="pending === p.id" class="size-4 animate-spin" />
            {{ pending === p.id ? 'Redirecting…' : 'Connect' }}
          </button>
        </li>
      </ul>

      <p v-if="!loading && availableProviders.length === 0" class="text-sm text-surface-500 dark:text-surface-400">
        No sign-in providers are configured on this server.
      </p>
    </div>
  </section>
</template>
