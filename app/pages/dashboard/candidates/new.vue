<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { z } from 'zod'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Add Candidate — MyRecruiter',
  description: 'Add a new candidate to your talent pool',
})

const localePath = useLocalePath()
const { createCandidate } = useCandidates()

// Form state
const form = ref({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
})

const isSubmitting = ref(false)
const errors = ref<Record<string, string>>({})
const submitError = ref<string | null>(null)

const formSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.string().min(1, 'Email is required').email('Invalid email address').max(255),
  phone: z.string().max(50).optional(),
})

function validate(): boolean {
  const result = formSchema.safeParse(form.value)
  if (!result.success) {
    errors.value = {}
    for (const issue of result.error.issues) {
      const field = issue.path[0]?.toString()
      if (field) errors.value[field] = issue.message
    }
    return false
  }
  errors.value = {}
  return true
}

async function handleSubmit() {
  submitError.value = null
  if (!validate()) return

  isSubmitting.value = true
  try {
    await createCandidate({
      firstName: form.value.firstName,
      lastName: form.value.lastName,
      email: form.value.email,
      phone: form.value.phone || undefined,
    })
    await navigateTo(localePath('/dashboard/candidates'))
  } catch (err: any) {
    const message = err.data?.statusMessage ?? 'Something went wrong'
    // Show email conflict as a field-level error
    if (err.statusCode === 409 || err.data?.statusCode === 409) {
      errors.value.email = message
    } else {
      submitError.value = message
    }
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <!-- Back link -->
    <NuxtLink
      :to="$localePath('/dashboard/candidates')"
      class="inline-flex items-center gap-1 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 mb-6 transition-colors"
    >
      <ArrowLeft class="size-4" />
      Back to Candidates
    </NuxtLink>

    <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-6">Add Candidate</h1>

    <!-- Server error -->
    <div
      v-if="submitError"
      class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400 mb-4"
    >
      {{ submitError }}
    </div>

    <form class="space-y-5" @submit.prevent="handleSubmit">
      <!-- First Name -->
      <div>
        <label for="firstName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          First Name <span class="text-danger-500">*</span>
        </label>
        <input
          id="firstName"
          v-model="form.firstName"
          type="text"
          placeholder="e.g. Jane"
          class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          :class="errors.firstName ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
        />
        <p v-if="errors.firstName" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.firstName }}</p>
      </div>

      <!-- Last Name -->
      <div>
        <label for="lastName" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Last Name <span class="text-danger-500">*</span>
        </label>
        <input
          id="lastName"
          v-model="form.lastName"
          type="text"
          placeholder="e.g. Doe"
          class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          :class="errors.lastName ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
        />
        <p v-if="errors.lastName" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.lastName }}</p>
      </div>

      <!-- Email -->
      <div>
        <label for="email" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Email <span class="text-danger-500">*</span>
        </label>
        <input
          id="email"
          v-model="form.email"
          type="email"
          placeholder="e.g. jane.doe@example.com"
          class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          :class="errors.email ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
        />
        <p v-if="errors.email" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.email }}</p>
      </div>

      <!-- Phone -->
      <div>
        <label for="phone" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Phone
        </label>
        <input
          id="phone"
          v-model="form.phone"
          type="tel"
          placeholder="e.g. +1 (555) 123-4567"
          class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
        />
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          :disabled="isSubmitting"
          class="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {{ isSubmitting ? 'Adding…' : 'Add Candidate' }}
        </button>
        <NuxtLink
          :to="$localePath('/dashboard/candidates')"
          class="rounded-lg border border-surface-300 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
        >
          Cancel
        </NuxtLink>
      </div>
    </form>
  </div>
</template>
