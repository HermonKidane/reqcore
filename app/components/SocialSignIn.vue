<script setup lang="ts">
/**
 * "Continue with Google / Microsoft" buttons. Rendered only for providers the
 * server has configured (GET /api/auth-providers). Better Auth does the redirect
 * dance; we only choose where to land afterwards.
 */
const props = defineProps<{
  /** Shown above the buttons, e.g. "or continue with" */
  label?: string
}>()

const localePath = useLocalePath()
const { data: providers } = await useFetch('/api/auth-providers', { key: 'auth-providers' })
const pending = ref<'google' | 'microsoft' | null>(null)
const error = ref('')

const anyEnabled = computed(() => !!(providers.value?.google || providers.value?.microsoft))

async function continueWith(provider: 'google' | 'microsoft') {
  error.value = ''
  pending.value = provider
  const result = await authClient.signIn.social({
    provider,
    callbackURL: localePath('/dashboard'),
    newUserCallbackURL: localePath('/onboarding/create-org'),
    errorCallbackURL: localePath('/auth/sign-in'),
  })
  if (result.error) {
    error.value = result.error.message ?? 'Could not start sign-in. Please try again.'
    pending.value = null
  }
  // On success the browser is redirected to the provider; nothing else to do here.
}
</script>

<template>
  <div v-if="anyEnabled" class="flex flex-col gap-3">
    <div class="flex items-center gap-3 text-xs uppercase tracking-wide text-surface-400 dark:text-surface-500">
      <span class="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
      <span>{{ props.label ?? 'or continue with' }}</span>
      <span class="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
    </div>

    <div v-if="error" class="rounded-md border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400">{{ error }}</div>

    <button
      v-if="providers?.google"
      type="button"
      :disabled="pending !== null"
      data-testid="social-google"
      class="flex items-center justify-center gap-2 px-4 py-2.5 border border-surface-300 dark:border-surface-700 rounded-md text-sm font-medium text-surface-800 dark:text-surface-100 bg-white dark:bg-surface-800 hover:bg-surface-50 dark:hover:bg-surface-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      @click="continueWith('google')"
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.1 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1C3.3 21.3 7.3 24 12 24z"/><path fill="#FBBC05" d="M5.3 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>
      {{ pending === 'google' ? 'Redirecting…' : 'Continue with Google' }}
    </button>

    <button
      v-if="providers?.microsoft"
      type="button"
      :disabled="pending !== null"
      data-testid="social-microsoft"
      class="flex items-center justify-center gap-2 px-4 py-2.5 border border-surface-300 dark:border-surface-700 rounded-md text-sm font-medium text-surface-800 dark:text-surface-100 bg-white dark:bg-surface-800 hover:bg-surface-50 dark:hover:bg-surface-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      @click="continueWith('microsoft')"
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="10" height="10" fill="#F25022"/><rect x="13" y="1" width="10" height="10" fill="#7FBA00"/><rect x="1" y="13" width="10" height="10" fill="#00A4EF"/><rect x="13" y="13" width="10" height="10" fill="#FFB900"/></svg>
      {{ pending === 'microsoft' ? 'Redirecting…' : 'Continue with Microsoft' }}
    </button>
  </div>
</template>
