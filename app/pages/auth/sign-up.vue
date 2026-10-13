<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  middleware: ['guest'],
})

useSeoMeta({
  title: 'Sign Up — MyRecruiter',
  description: 'Create your MyRecruiter account',
  robots: 'noindex, nofollow',
})

const name = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const isLoading = ref(false)
const localePath = useLocalePath()

async function handleSignUp() {
  error.value = ''

  if (!name.value || !email.value || !password.value) {
    error.value = 'All fields are required.'
    return
  }

  if (password.value.length < 8) {
    error.value = 'Password must be at least 8 characters.'
    return
  }

  if (password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match.'
    return
  }

  isLoading.value = true

  const result = await authClient.signUp.email({
    email: email.value,
    password: password.value,
    name: name.value,
  })

  if (result.error) {
    error.value = result.error.message ?? 'Sign-up failed. Please try again.'
    isLoading.value = false
    return
  }

  clearNuxtData()
  await navigateTo(localePath('/onboarding/create-org'))
}
</script>

<template>
  <form class="auth-form" @submit.prevent="handleSignUp">
    <h2 class="sr-only">Create your account</h2>

    <div v-if="error" class="auth-alert" role="alert">{{ error }}</div>

    <div class="auth-field">
      <label class="auth-label" for="signup-name">Name</label>
      <input id="signup-name" v-model="name" type="text" autocomplete="name" placeholder="Your full name" required class="auth-input" />
    </div>

    <div class="auth-field">
      <label class="auth-label" for="signup-email">Email</label>
      <input id="signup-email" v-model="email" type="email" inputmode="email" autocomplete="email" placeholder="you@company.com" required class="auth-input" />
    </div>

    <div class="auth-field">
      <label class="auth-label" for="signup-password">Password</label>
      <input id="signup-password" v-model="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" required minlength="8" class="auth-input" />
    </div>

    <div class="auth-field">
      <label class="auth-label" for="signup-confirm">Confirm password</label>
      <input id="signup-confirm" v-model="confirmPassword" type="password" autocomplete="new-password" placeholder="Repeat your password" required class="auth-input" />
    </div>

    <button type="submit" :disabled="isLoading" class="auth-btn auth-btn-primary">
      {{ isLoading ? 'Creating account…' : 'Sign up' }}
      <svg v-if="!isLoading" class="auth-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
    </button>

    <SocialSignIn label="or sign up with" />

    <p class="auth-muted">
      Already have an account?
      <NuxtLink :to="$localePath('/auth/sign-in')" class="auth-link">Sign in</NuxtLink>
    </p>
  </form>
</template>
