<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  middleware: ['guest'],
})

useSeoMeta({
  title: 'Sign In — MyRecruiter',
  description: 'Sign in to your MyRecruiter account',
  robots: 'noindex, nofollow',
})

const email = ref('')
const password = ref('')
const error = ref('')
const isLoading = ref(false)
const route = useRoute()
const config = useRuntimeConfig()
const localePath = useLocalePath()

if (route.query.live === '1') {
  email.value = config.public.liveDemoEmail
  password.value = config.public.liveDemoSecret
}

// Better Auth sends social-login failures back here as ?error=<code>.
const socialErrorMessages: Record<string, string> = {
  account_not_linked: 'An account with this email already exists. Sign in with your password first, then connect this provider from Settings.',
  provider_email_not_verified: 'Your sign-in provider did not confirm your email address, so we could not create an account. Sign up with email and password instead, or ask your IT admin to enable verified email claims.',
  email_not_found: 'Your provider did not share an email address, so we could not sign you in.',
  signup_disabled: 'Sign-up with this provider is disabled.',
  state_mismatch: 'The sign-in session expired. Please try again.',
  please_restart_the_process: 'The sign-in session expired. Please try again.',
  unable_to_get_user_info: 'We could not read your profile from the provider. Please try again.',
}
const socialError = typeof route.query.error === 'string' ? route.query.error : ''
if (socialError) {
  error.value = socialErrorMessages[socialError] ?? 'Sign-in with that provider failed. Please try again or use your password.'
}

async function handleSignIn() {
  error.value = ''

  if (!email.value || !password.value) {
    error.value = 'Email and password are required.'
    return
  }

  isLoading.value = true

  const result = await authClient.signIn.email({
    email: email.value,
    password: password.value,
  })

  if (result.error) {
    error.value = result.error.message ?? 'Invalid credentials. Please try again.'
    isLoading.value = false
    return
  }

  clearNuxtData()
  await navigateTo(localePath('/dashboard'))
}
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="handleSignIn">
    <h2 class="text-xl font-semibold text-center text-surface-900 dark:text-surface-100 mb-2">Sign in to your account</h2>

    <div v-if="error" class="rounded-md border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400">{{ error }}</div>

    <label class="flex flex-col gap-1 text-sm font-medium text-surface-700 dark:text-surface-300">
      <span>Email</span>
      <input
        v-model="email"
        type="email"
        autocomplete="email"
        required
        class="px-3 py-2 border border-surface-300 dark:border-surface-700 rounded-md text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
      />
    </label>

    <label class="flex flex-col gap-1 text-sm font-medium text-surface-700 dark:text-surface-300">
      <span>Password</span>
      <input
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
        class="px-3 py-2 border border-surface-300 dark:border-surface-700 rounded-md text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
      />
    </label>

    <button
      type="submit"
      :disabled="isLoading"
      class="mt-2 px-4 py-2.5 bg-brand-600 text-white rounded-md text-sm font-medium hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
    >
      {{ isLoading ? 'Signing in…' : 'Sign in' }}
    </button>

    <SocialSignIn />

    <p class="text-center text-sm text-surface-500 dark:text-surface-400">
      Don't have an account?
      <NuxtLink :to="$localePath('/auth/sign-up')" class="text-brand-600 dark:text-brand-400 hover:underline">Sign up</NuxtLink>
    </p>
  </form>
</template>

