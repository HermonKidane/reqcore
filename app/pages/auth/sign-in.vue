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
  <form class="auth-form" @submit.prevent="handleSignIn">
    <h2 class="sr-only">Sign in to your account</h2>

    <div v-if="error" class="auth-alert" role="alert">{{ error }}</div>

    <div class="auth-field">
      <label class="auth-label" for="signin-email">Email</label>
      <input
        id="signin-email"
        v-model="email"
        type="email"
        inputmode="email"
        autocomplete="email"
        placeholder="you@company.com"
        required
        class="auth-input"
      />
    </div>

    <div class="auth-field">
      <label class="auth-label" for="signin-password">Password</label>
      <input
        id="signin-password"
        v-model="password"
        type="password"
        autocomplete="current-password"
        placeholder="Enter your password"
        required
        class="auth-input"
      />
    </div>

    <button type="submit" :disabled="isLoading" class="auth-btn auth-btn-primary">
      {{ isLoading ? 'Signing in…' : 'Sign in' }}
      <svg v-if="!isLoading" class="auth-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
    </button>

    <SocialSignIn />

    <p class="auth-muted">
      Don't have an account?
      <NuxtLink :to="$localePath('/auth/sign-up')" class="auth-link">Sign up</NuxtLink>
    </p>
  </form>
</template>
