<script setup lang="ts">
import { friendlyAuthError } from '~/utils/email'
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
const { email, emailError, emailSuggestion, emailInput, onBlur: onEmailBlur, validate: validateEmail, applySuggestion } = useEmailField()
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const isLoading = ref(false)
const localePath = useLocalePath()

async function handleSignUp() {
  error.value = ''

  if (!name.value.trim()) {
    error.value = 'Enter your name.'
    return
  }
  if (!validateEmail()) return
  if (!password.value) {
    error.value = 'Choose a password.'
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
    error.value = friendlyAuthError(result.error.message, 'Sign-up failed. Please try again.')
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
      <input
        id="signup-email"
        ref="emailInput"
        v-model="email"
        type="email"
        inputmode="email"
        autocomplete="email"
        placeholder="you@company.com"
        required
        class="auth-input"
        :class="{ 'auth-input--invalid': emailError }"
        :aria-invalid="emailError ? 'true' : undefined"
        :aria-describedby="emailError ? 'signup-email-error' : undefined"
        @blur="onEmailBlur"
        @input="emailError = ''"
      />
      <p v-if="emailError" id="signup-email-error" class="auth-field-error" data-testid="email-error">{{ emailError }}</p>
      <p v-else-if="emailSuggestion" class="auth-field-hint" data-testid="email-suggestion">
        Did you mean <button type="button" class="auth-suggest" @click="applySuggestion">{{ emailSuggestion }}</button>?
      </p>
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
