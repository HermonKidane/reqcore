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
  linkedinUrl: '',
  position: '',
  company: '',
  location: '',
  headline: '',
  summary: '',
})

const isSubmitting = ref(false)
const errors = ref<Record<string, string>>({})
const submitError = ref<string | null>(null)

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

const formSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.preprocess(
    blankToUndefined,
    z.string().email('Invalid email address').max(255).optional(),
  ),
  phone: z.string().max(50).optional(),
  linkedinUrl: z.preprocess(
    blankToUndefined,
    z.string().max(500).regex(/linkedin\.com\//i, 'Must be a LinkedIn profile URL').optional(),
  ),
  position: z.preprocess(blankToUndefined, z.string().max(200).optional()),
  company: z.preprocess(blankToUndefined, z.string().max(200).optional()),
  location: z.preprocess(blankToUndefined, z.string().max(200).optional()),
  headline: z.preprocess(blankToUndefined, z.string().max(300).optional()),
  summary: z.preprocess(blankToUndefined, z.string().max(5000).optional()),
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
    const created: any = await createCandidate({
      firstName: form.value.firstName,
      lastName: form.value.lastName,
      email: form.value.email || undefined,
      phone: form.value.phone || undefined,
      linkedinUrl: form.value.linkedinUrl || undefined,
      position: form.value.position || undefined,
      company: form.value.company || undefined,
      location: form.value.location || undefined,
      headline: form.value.headline || undefined,
      summary: form.value.summary || undefined,
    })
    // Open the new profile (Hermon 10-13, Manatal gap C01 #7) — fall back to the list
    await navigateTo(localePath(created?.id ? `/dashboard/candidates/${created.id}` : '/dashboard/candidates'))
  } catch (err: any) {
    const message = err.data?.statusMessage ?? 'Something went wrong'
    // Show conflict as a field-level error (LinkedIn duplicates go to the URL field)
    if (err.statusCode === 409 || err.data?.statusCode === 409) {
      if (message.includes('LinkedIn')) {
        errors.value.linkedinUrl = message
      } else {
        errors.value.email = message
      }
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

    <form class="space-y-5" data-tour="candidate-form" @submit.prevent="handleSubmit">
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
          Email
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

      <!-- LinkedIn URL -->
      <div>
        <label for="linkedinUrl" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          LinkedIn URL
        </label>
        <input
          id="linkedinUrl"
          v-model="form.linkedinUrl"
          type="text"
          placeholder="e.g. linkedin.com/in/jane-doe"
          class="w-full rounded-lg border px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
          :class="errors.linkedinUrl ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
        />
        <p v-if="errors.linkedinUrl" class="mt-1 text-xs text-danger-600 dark:text-danger-400">{{ errors.linkedinUrl }}</p>
      </div>

      <!-- Position -->
      <div>
        <label for="position" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Position
        </label>
        <input
          id="position"
          v-model="form.position"
          type="text"
          placeholder="e.g. Senior Software Engineer"
          class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
        />
      </div>

      <!-- Company -->
      <div>
        <label for="company" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Company
        </label>
        <input
          id="company"
          v-model="form.company"
          type="text"
          placeholder="e.g. Acme Corp"
          class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
        />
      </div>

      <!-- Location -->
      <div>
        <label for="location" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Location
        </label>
        <input
          id="location"
          v-model="form.location"
          type="text"
          placeholder="e.g. London, UK"
          class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
        />
      </div>

      <!-- Headline -->
      <div>
        <label for="headline" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Headline
        </label>
        <input
          id="headline"
          v-model="form.headline"
          type="text"
          placeholder="e.g. Engineering leader · ex-Google"
          class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
        />
      </div>

      <!-- Summary -->
      <div>
        <label for="summary" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Summary
        </label>
        <textarea
          id="summary"
          v-model="form.summary"
          rows="4"
          placeholder="A short bio or notes about the candidate"
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
