<script setup lang="ts">
import { ArrowLeft, CheckCircle2, ChevronDown, Loader2 } from 'lucide-vue-next'
import {
  DAY_RATE_MAX,
  SALARY_MAX,
  emptyQualifiers,
  parseMoneyInput,
  type QualifierFormValues,
} from '~~/shared/candidate-qualifiers'
import { normalisePhone } from '~~/shared/phone'
import type { CvParseResult } from '~/components/candidates/CvPrefill.vue'
import type { DuplicateMatch } from '~/components/candidates/DuplicateWarning.vue'
import type { CreateCandidatePayload } from '~/composables/useCandidates'

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

// Untyped fetch alias: typed /api/... routes with siblings hit TS "excessive stack depth".
const $api = $fetch as (url: string, opts?: any) => Promise<any>

// ─────────────────────────────────────────────
// Form state
// ─────────────────────────────────────────────

const TEXT_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'linkedinUrl', 'position', 'company', 'location', 'headline', 'summary'] as const
type TextField = typeof TEXT_FIELDS[number]

const LIMITS: Record<TextField, number> = {
  firstName: 100,
  lastName: 100,
  email: 255,
  phone: 50,
  linkedinUrl: 500,
  position: 200,
  company: 200,
  location: 200,
  headline: 300,
  summary: 5000,
}
const FIELD_NAMES: Record<TextField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  linkedinUrl: 'LinkedIn URL',
  position: 'Position',
  company: 'Company',
  location: 'Location',
  headline: 'Headline',
  summary: 'Summary',
}

function emptyForm(): Record<TextField, string> {
  return { firstName: '', lastName: '', email: '', phone: '', linkedinUrl: '', position: '', company: '', location: '', headline: '', summary: '' }
}

const form = ref(emptyForm())
const qualifiers = ref<QualifierFormValues>(emptyQualifiers())
const skills = ref<string[]>([])
const jobId = ref('')

/** Fields filled from the CV that the user has not touched yet */
const fromCv = ref<Partial<Record<TextField, boolean>>>({})
/** CV file to attach to the profile after saving (PDF / .docx only) */
const cvFile = ref<File | null>(null)
/** Work history + education read from the CV, saved with the person */
const history = ref<{ experiences: Array<Record<string, unknown>>, education: Array<Record<string, unknown>> }>({ experiences: [], education: [] })

const errors = ref<Record<string, string>>({})
/** id of the existing person behind a 409, per field — for the "Open the existing person" link */
const existingIds = ref<Partial<Record<'email' | 'linkedinUrl', string>>>({})
const submitError = ref<string | null>(null)
const savingMode = ref<'open' | 'another' | null>(null)
const isSubmitting = computed(() => savingMode.value !== null)

/** Shown after a save that stays on this page */
const saved = ref<{ id: string, name: string, warnings: string[] } | null>(null)

const skillChips = ref<{ commitDraft: () => void } | null>(null)

// ─────────────────────────────────────────────
// Qualifiers card — collapsed until asked for, or until it holds a value
// ─────────────────────────────────────────────

const qualifiersOpened = ref(false)
const hasQualifierValue = computed(() => {
  const q = qualifiers.value
  return Boolean(q.sourceChannel || q.salaryCurrent || q.salaryExpected || q.dayRate || q.noticePeriod || q.rightToWork)
})
const showQualifiers = computed(() => qualifiersOpened.value || hasQualifierValue.value)

async function openQualifiers() {
  qualifiersOpened.value = true
  await nextTick()
  document.getElementById('sourceChannel')?.focus()
}

// ─────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function fieldError(key: TextField, raw: string): string {
  const value = raw.trim()
  if (key === 'firstName' && !value) return 'First name is required'
  if (key === 'lastName' && !value) return 'Last name is required'
  if (raw.length > LIMITS[key]) return `${FIELD_NAMES[key]} can be up to ${LIMITS[key].toLocaleString('en-GB')} characters`
  if (key === 'email' && value && !EMAIL_RE.test(value)) return 'Enter a full email address, like name@example.com'
  if (key === 'linkedinUrl' && value && !/linkedin\.com\//i.test(value)) return 'Must be a LinkedIn profile URL'
  return ''
}

function setError(key: string, message: string) {
  if (message) errors.value[key] = message
  else delete errors.value[key]
}

function validateField(key: TextField) {
  setError(key, fieldError(key, form.value[key]))
}

const MONEY_FIELDS = [['salaryCurrent', SALARY_MAX], ['salaryExpected', SALARY_MAX], ['dayRate', DAY_RATE_MAX]] as const

/** Focus order for "first invalid field" */
const FOCUS_ORDER = [...TEXT_FIELDS.slice(0, 8), 'sourceChannel', 'salaryCurrent', 'salaryExpected', 'dayRate', 'noticePeriod', 'rightToWork', 'skills', 'headline', 'summary', 'differentPerson']

function validateAll(): boolean {
  const next: Record<string, string> = {}
  for (const key of TEXT_FIELDS) {
    const message = fieldError(key, form.value[key])
    if (message) next[key] = message
  }
  for (const [key, max] of MONEY_FIELDS) {
    const parsed = parseMoneyInput(qualifiers.value[key], max)
    if (parsed.error) next[key] = parsed.error
  }
  errors.value = next
  return Object.keys(next).length === 0
}

async function focusFirstInvalid() {
  await nextTick()
  const first = FOCUS_ORDER.find(id => errors.value[id])
  if (first) document.getElementById(first)?.focus()
}

// Re-check money fields as they change, so an error clears once fixed
watch(qualifiers, () => {
  for (const [key, max] of MONEY_FIELDS) {
    if (errors.value[key]) setError(key, parseMoneyInput(qualifiers.value[key], max).error ?? '')
  }
}, { deep: true })

function onEdited(key: TextField) {
  if (fromCv.value[key]) fromCv.value[key] = false
  if (errors.value[key]) validateField(key)
  if (key === 'email' || key === 'linkedinUrl') delete existingIds.value[key]
}

function onBlur(key: TextField) {
  if (key === 'phone') form.value.phone = normalisePhone(form.value.phone)
  // Required names are checked on save, not on tabbing past an empty box
  if (form.value[key].trim() || errors.value[key]) validateField(key)
  if (DUPLICATE_FIELDS.includes(key)) scheduleDuplicateCheck()
}

// ─────────────────────────────────────────────
// Duplicate check (debounced, on blur)
// ─────────────────────────────────────────────

const DUPLICATE_FIELDS: TextField[] = ['firstName', 'lastName', 'email', 'phone', 'linkedinUrl', 'company']
const duplicates = ref<DuplicateMatch[]>([])
const differentPerson = ref(false)
let duplicateTimer: ReturnType<typeof setTimeout> | null = null
let lastDuplicateKey = ''
let duplicateRun = 0
const formRun = ref(0) // bumped when the form is cleared; re-creates the CV reader

function duplicateQuery(): Record<string, string> {
  const f = form.value
  const query: Record<string, string> = {}
  const email = f.email.trim()
  if (email && !fieldError('email', f.email)) query.email = email
  const linkedinUrl = f.linkedinUrl.trim()
  if (linkedinUrl && !fieldError('linkedinUrl', f.linkedinUrl)) query.linkedinUrl = linkedinUrl
  const phone = f.phone.trim()
  if (phone.replace(/\D/g, '').length >= 9 && phone.length <= LIMITS.phone) query.phone = phone
  const firstName = f.firstName.trim()
  const lastName = f.lastName.trim()
  if (firstName && lastName && firstName.length <= LIMITS.firstName && lastName.length <= LIMITS.lastName) {
    query.firstName = firstName
    query.lastName = lastName
    const company = f.company.trim()
    if (company && company.length <= LIMITS.company) query.company = company
  }
  return query
}

/** Runs the check now. Never throws: a failed check must not block saving. */
async function runDuplicateCheck(): Promise<void> {
  if (duplicateTimer) {
    clearTimeout(duplicateTimer)
    duplicateTimer = null
  }
  const query = duplicateQuery()
  const key = JSON.stringify(query)
  if (key === lastDuplicateKey) return
  const run = ++duplicateRun
  if (Object.keys(query).length === 0) {
    lastDuplicateKey = key
    duplicates.value = []
    return
  }
  try {
    const res = await $api('/api/candidates/duplicates', { query }) as { matches?: DuplicateMatch[] }
    if (run !== duplicateRun) return
    const matches = res.matches ?? []
    // A new set of likely matches needs a fresh tick
    const likelyBefore = duplicates.value.filter(m => m.strength === 'likely').map(m => m.id).sort().join(',')
    const likelyNow = matches.filter(m => m.strength === 'likely').map(m => m.id).sort().join(',')
    if (likelyBefore !== likelyNow) differentPerson.value = false
    duplicates.value = matches
    lastDuplicateKey = key
    if (!matches.some(m => m.strength === 'likely')) delete errors.value.differentPerson
  }
  catch {
    // Leave the last result on screen; the server still refuses true duplicates on save.
  }
}

function scheduleDuplicateCheck() {
  if (duplicateTimer) clearTimeout(duplicateTimer)
  duplicateTimer = setTimeout(() => {
    duplicateTimer = null
    void runDuplicateCheck()
  }, 400)
}

watch(differentPerson, (ticked) => {
  if (ticked) delete errors.value.differentPerson
})

// ─────────────────────────────────────────────
// Start from a CV
// ─────────────────────────────────────────────

function applyCv(result: CvParseResult) {
  const filled: TextField[] = []
  for (const key of TEXT_FIELDS) {
    let value = (result.fields?.[key] ?? '').toString().trim()
    if (!value || form.value[key].trim()) continue // never overwrite what was typed
    if (key === 'phone') value = normalisePhone(value)
    form.value[key] = value.slice(0, LIMITS[key])
    fromCv.value[key] = true
    setError(key, '')
    filled.push(key)
  }

  if (result.skills?.length) {
    const seen = new Set(skills.value.map(s => s.toLowerCase()))
    const next = [...skills.value]
    for (const raw of result.skills) {
      const name = String(raw).trim()
      if (!name || name.length > 80 || seen.has(name.toLowerCase()) || next.length >= 50) continue
      seen.add(name.toLowerCase())
      next.push(name)
    }
    skills.value = next
  }

  history.value = {
    experiences: (result.experiences ?? []).slice(0, 30),
    education: (result.education ?? []).slice(0, 20),
  }

  if (filled.some(key => DUPLICATE_FIELDS.includes(key))) scheduleDuplicateCheck()
}

const historySummary = computed(() => {
  const jobs = history.value.experiences.length
  const courses = history.value.education.length
  const parts: string[] = []
  if (jobs) parts.push(`${jobs} ${jobs === 1 ? 'job' : 'jobs'}`)
  if (courses) parts.push(`${courses} ${courses === 1 ? 'course' : 'courses'}`)
  return parts.length ? `${parts.join(' and ')} will be saved to the profile` : null
})

// ─────────────────────────────────────────────
// Add to a job (open jobs, fetched in the browser only)
// ─────────────────────────────────────────────

const openJobs = ref<Array<{ id: string, title: string }>>([])

onMounted(async () => {
  window.addEventListener('beforeunload', onBeforeUnload)
  try {
    const res = await $api('/api/jobs', { query: { status: 'open', limit: 100 } }) as { data?: Array<{ id: string, title: string }> }
    openJobs.value = (res.data ?? []).map(j => ({ id: j.id, title: j.title }))
  }
  catch {
    openJobs.value = [] // no access to jobs, or offline: the card stays hidden
  }
})

// ─────────────────────────────────────────────
// Unsaved-changes guard (browser unload only — not in-app Cancel)
// ─────────────────────────────────────────────

const isDirty = computed(() =>
  TEXT_FIELDS.some(key => form.value[key].trim() !== '')
  || skills.value.length > 0
  // every qualifier except the source, which "Save & add another" keeps on purpose
  || Object.entries(qualifiers.value).some(([key, value]) => key !== 'sourceChannel' && key !== 'salaryCurrency' && value !== '')
  || cvFile.value !== null
  || history.value.experiences.length > 0
  || history.value.education.length > 0,
)

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!isDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  if (duplicateTimer) clearTimeout(duplicateTimer)
})

// ─────────────────────────────────────────────
// Save
// ─────────────────────────────────────────────

function buildPayload(): CreateCandidatePayload {
  const f = form.value
  const q = qualifiers.value
  const text = (key: TextField) => f[key].trim() || undefined
  const money = (key: 'salaryCurrent' | 'salaryExpected' | 'dayRate', max: number) => parseMoneyInput(q[key], max).value ?? undefined
  const salaryCurrent = money('salaryCurrent', SALARY_MAX)
  const salaryExpected = money('salaryExpected', SALARY_MAX)
  const dayRate = money('dayRate', DAY_RATE_MAX)
  const hasMoney = salaryCurrent !== undefined || salaryExpected !== undefined || dayRate !== undefined
  return {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    email: text('email'),
    phone: normalisePhone(f.phone) || undefined,
    linkedinUrl: text('linkedinUrl'),
    position: text('position'),
    company: text('company'),
    location: text('location'),
    headline: text('headline'),
    summary: text('summary'),
    sourceChannel: q.sourceChannel || undefined,
    salaryCurrency: hasMoney ? q.salaryCurrency || undefined : undefined,
    salaryCurrent,
    salaryExpected,
    dayRate,
    noticePeriod: q.noticePeriod || undefined,
    rightToWork: q.rightToWork || undefined,
    workPreference: q.workPreference || undefined,
    skills: skills.value.length ? skills.value : undefined,
    experiences: history.value.experiences.length ? history.value.experiences : undefined,
    education: history.value.education.length ? history.value.education : undefined,
  }
}

/** Server 400: h3 sends the zod issues as a JSON string in data.data.message */
function applyServerValidation(err: any): boolean {
  try {
    const issues = JSON.parse(err?.data?.data?.message ?? 'null')
    if (!Array.isArray(issues) || issues.length === 0) return false
    let mapped = false
    for (const issue of issues) {
      const key = String(issue?.path?.[0] ?? '')
      if (!key || errors.value[key]) continue
      errors.value[key] = (TEXT_FIELDS as readonly string[]).includes(key) && issue.code === 'too_big'
        ? `${FIELD_NAMES[key as TextField]} can be up to ${LIMITS[key as TextField].toLocaleString('en-GB')} characters`
        : String(issue?.message ?? 'Please check this field')
      mapped = true
    }
    return mapped
  }
  catch {
    return false
  }
}

function resetForm(keep: { sourceChannel: string, jobId: string }) {
  form.value = emptyForm()
  qualifiers.value = { ...emptyQualifiers(), sourceChannel: keep.sourceChannel }
  qualifiersOpened.value = false
  skills.value = []
  jobId.value = keep.jobId
  fromCv.value = {}
  cvFile.value = null
  history.value = { experiences: [], education: [] }
  errors.value = {}
  existingIds.value = {}
  duplicates.value = []
  differentPerson.value = false
  lastDuplicateKey = ''
  duplicateRun++
  formRun.value++
}

async function save(mode: 'open' | 'another') {
  if (isSubmitting.value) return
  submitError.value = null
  skillChips.value?.commitDraft()
  form.value.phone = normalisePhone(form.value.phone)

  if (!validateAll()) {
    await focusFirstInvalid()
    return
  }

  savingMode.value = mode
  try {
    // Make sure the duplicate list matches what is in the form right now
    await runDuplicateCheck()
    if (duplicates.value.some(m => m.strength === 'likely') && !differentPerson.value) {
      errors.value.differentPerson = 'Tick the box to confirm this is a different person, or open the existing one.'
      await focusFirstInvalid()
      return
    }

    const payload = buildPayload()
    const created: any = await createCandidate(payload)
    const id: string | undefined = created?.id
    const name = `${payload.firstName} ${payload.lastName}`

    // Follow-ups: the person is saved whatever happens here
    const warnings: string[] = []
    if (id && cvFile.value) {
      try {
        const body = new FormData()
        body.append('file', cvFile.value)
        body.append('type', 'resume')
        await $api(`/api/candidates/${id}/documents`, { method: 'POST', body })
      }
      catch {
        warnings.push('The CV file could not be attached. You can add it from the Documents tab on the profile.')
      }
    }
    if (id && jobId.value) {
      try {
        await $api('/api/applications', { method: 'POST', body: { candidateId: id, jobId: jobId.value } })
      }
      catch {
        warnings.push('They could not be added to the job. You can do that from the profile.')
      }
    }

    if (mode === 'open' && warnings.length === 0) {
      // Open the new profile (Hermon 10-13, Manatal gap C01 #7) — fall back to the list
      await navigateTo(localePath(id ? `/dashboard/candidates/${id}` : '/dashboard/candidates'))
      return
    }

    // Stay here: "add another", or a follow-up failed and the user should see why
    const keep = mode === 'another'
      ? { sourceChannel: qualifiers.value.sourceChannel, jobId: jobId.value }
      : { sourceChannel: '', jobId: '' }
    resetForm(keep)
    saved.value = id ? { id, name, warnings } : null
    await nextTick()
    document.getElementById('firstName')?.focus()
  }
  catch (err: any) {
    const message: string = err?.data?.statusMessage ?? 'Something went wrong. Please try again.'
    const status = err?.statusCode ?? err?.data?.statusCode
    if (status === 409) {
      // Conflict → under the right field, with a link to the existing person when the server sent one
      const info = err?.data?.data as { existingId?: string, field?: string } | undefined
      const field: 'email' | 'linkedinUrl' = info?.field === 'linkedinUrl' || message.includes('LinkedIn') ? 'linkedinUrl' : 'email'
      errors.value[field] = message
      if (info?.existingId) existingIds.value[field] = info.existingId
      else delete existingIds.value[field]
      await focusFirstInvalid()
    }
    else if (status === 400 && applyServerValidation(err)) {
      await focusFirstInvalid()
    }
    else {
      submitError.value = message === 'Validation Error' ? 'Some details could not be saved. Please check the form and try again.' : message
    }
  }
  finally {
    savingMode.value = null
  }
}

function onFormKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    void save('open')
  }
}

const buttonBase = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-surface-950 disabled:cursor-not-allowed disabled:opacity-50'
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <!-- Back link -->
    <NuxtLink
      :to="$localePath('/dashboard/candidates')"
      class="inline-flex min-h-11 items-center gap-1 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 mb-2 transition-colors"
    >
      <ArrowLeft class="size-4" />
      Back to Candidates
    </NuxtLink>

    <div class="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-100">Add Candidate</h1>
      <p class="text-sm text-surface-500 dark:text-surface-400"><span class="text-danger-500">*</span> Required</p>
    </div>

    <!-- Saved line ("Save & add another", or a follow-up that needs attention) -->
    <div
      v-if="saved"
      role="status"
      data-testid="saved-notice"
      class="mb-4 rounded-lg border p-3 text-sm"
      :class="saved.warnings.length
        ? 'border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-950 text-warning-900 dark:text-warning-100'
        : 'border-success-200 dark:border-success-800 bg-success-50 dark:bg-success-950 text-success-800 dark:text-success-200'"
    >
      <p class="flex flex-wrap items-center gap-x-2">
        <CheckCircle2 class="size-4 shrink-0" aria-hidden="true" />
        <span>{{ saved.name }} saved</span>
        <NuxtLink
          :to="$localePath(`/dashboard/candidates/${saved.id}`)"
          class="inline-flex min-h-11 sm:min-h-8 items-center font-medium underline underline-offset-2"
        >
          Open profile
        </NuxtLink>
      </p>
      <ul v-if="saved.warnings.length" class="mt-1 list-disc space-y-1 pl-5">
        <li v-for="warning in saved.warnings" :key="warning">{{ warning }}</li>
      </ul>
    </div>

    <!-- Server error -->
    <div
      v-if="submitError"
      role="alert"
      class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400 mb-4"
    >
      {{ submitError }}
    </div>

    <!-- Card 1: Start from a CV (optional — the form below works on its own) -->
    <CandidatesCvPrefill
      :key="formRun"
      class="mb-4"
      :attached-filename="cvFile?.name ?? null"
      :history-summary="historySummary"
      @filled="applyCv"
      @attach="cvFile = $event"
      @remove-file="cvFile = null"
      @discard-history="history = { experiences: [], education: [] }"
    />

    <form class="space-y-4" data-tour="candidate-form" novalidate @submit.prevent="save('open')" @keydown="onFormKeydown">
      <!-- Card 2: Identity & contact -->
      <section :class="candidateCardClass" aria-labelledby="card-identity">
        <h2 id="card-identity" class="mb-4 text-base font-semibold text-surface-900 dark:text-surface-100">Identity &amp; contact</h2>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <CandidatesTextField
            id="firstName"
            v-model="form.firstName"
            label="First Name"
            required
            placeholder="e.g. Jane"
            autocomplete="off"
            :error="errors.firstName"
            :from-cv="fromCv.firstName"
            @edited="onEdited('firstName')"
            @blur="onBlur('firstName')"
          />
          <CandidatesTextField
            id="lastName"
            v-model="form.lastName"
            label="Last Name"
            required
            placeholder="e.g. Doe"
            :error="errors.lastName"
            :from-cv="fromCv.lastName"
            @edited="onEdited('lastName')"
            @blur="onBlur('lastName')"
          />
          <CandidatesTextField
            id="email"
            v-model="form.email"
            label="Email"
            type="email"
            inputmode="email"
            placeholder="e.g. jane.doe@example.com"
            :error="errors.email"
            :from-cv="fromCv.email"
            @edited="onEdited('email')"
            @blur="onBlur('email')"
          >
            <template v-if="existingIds.email" #error-extra>
              <a
                :href="localePath(`/dashboard/candidates/${existingIds.email}`)"
                target="_blank"
                rel="noopener"
                class="ml-1 inline-flex min-h-11 sm:min-h-0 items-center font-medium underline underline-offset-2"
              >Open the existing person</a>
            </template>
          </CandidatesTextField>
          <CandidatesTextField
            id="phone"
            v-model="form.phone"
            label="Phone"
            type="tel"
            inputmode="tel"
            placeholder="e.g. 07700 900123"
            :error="errors.phone"
            :from-cv="fromCv.phone"
            @edited="onEdited('phone')"
            @blur="onBlur('phone')"
          />
          <div class="md:col-span-2">
            <CandidatesTextField
              id="linkedinUrl"
              v-model="form.linkedinUrl"
              label="LinkedIn URL"
              inputmode="url"
              placeholder="e.g. linkedin.com/in/jane-doe"
              :error="errors.linkedinUrl"
              :from-cv="fromCv.linkedinUrl"
              @edited="onEdited('linkedinUrl')"
              @blur="onBlur('linkedinUrl')"
            >
              <template v-if="existingIds.linkedinUrl" #error-extra>
                <a
                  :href="localePath(`/dashboard/candidates/${existingIds.linkedinUrl}`)"
                  target="_blank"
                  rel="noopener"
                  class="ml-1 inline-flex min-h-11 sm:min-h-0 items-center font-medium underline underline-offset-2"
                >Open the existing person</a>
              </template>
            </CandidatesTextField>
          </div>
        </div>
      </section>

      <!-- Card 3: Current role & location -->
      <section :class="candidateCardClass">
        <h2 id="card-role" class="mb-4 text-base font-semibold text-surface-900 dark:text-surface-100">Current role &amp; location</h2>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <CandidatesTextField
            id="position"
            v-model="form.position"
            label="Position"
            placeholder="e.g. Senior Software Engineer"
            :error="errors.position"
            :from-cv="fromCv.position"
            @edited="onEdited('position')"
            @blur="onBlur('position')"
          />
          <CandidatesTextField
            id="company"
            v-model="form.company"
            label="Company"
            placeholder="e.g. Acme Corp"
            :error="errors.company"
            :from-cv="fromCv.company"
            @edited="onEdited('company')"
            @blur="onBlur('company')"
          />
          <div class="md:col-span-2">
            <CandidatesTextField
              id="location"
              v-model="form.location"
              label="Location"
              placeholder="e.g. London, UK"
              :error="errors.location"
              :from-cv="fromCv.location"
              @edited="onEdited('location')"
              @blur="onBlur('location')"
            />
          </div>
          <div class="md:col-span-2">
            <CandidatesWorkPreferencePicker v-model="qualifiers.workPreference" />
          </div>
        </div>
      </section>

      <!-- Card 4: Qualifiers (collapsed until asked for) -->
      <section :class="candidateCardClass" aria-labelledby="card-qualifiers">
        <h2 id="card-qualifiers" class="text-base font-semibold text-surface-900 dark:text-surface-100">Qualifiers</h2>
        <button
          v-if="!showQualifiers"
          type="button"
          aria-expanded="false"
          aria-controls="qualifier-fields"
          class="mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-brand-700 dark:text-brand-300 hover:text-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
          @click="openQualifiers"
        >
          <ChevronDown class="size-4" aria-hidden="true" />
          Add salary, notice period and more
        </button>
        <div v-show="showQualifiers" id="qualifier-fields" class="mt-4">
          <CandidatesQualifierFields v-model="qualifiers" :errors="errors" />
        </div>
      </section>

      <!-- Card 5: Skills -->
      <section :class="candidateCardClass" aria-labelledby="card-skills">
        <h2 id="card-skills" class="mb-4 text-base font-semibold text-surface-900 dark:text-surface-100">Skills</h2>
        <CandidatesSkillChips ref="skillChips" v-model="skills" :error="errors.skills" />
      </section>

      <!-- Card 6: Pitch -->
      <section :class="candidateCardClass" aria-labelledby="card-pitch">
        <h2 id="card-pitch" class="mb-4 text-base font-semibold text-surface-900 dark:text-surface-100">Pitch</h2>
        <div class="space-y-4">
          <CandidatesTextField
            id="headline"
            v-model="form.headline"
            label="Headline"
            placeholder="e.g. Engineering leader · ex-Google"
            :error="errors.headline"
            :from-cv="fromCv.headline"
            @edited="onEdited('headline')"
            @blur="onBlur('headline')"
          />
          <CandidatesTextField
            id="summary"
            v-model="form.summary"
            label="Summary"
            multiline
            :rows="5"
            :count-max="5000"
            placeholder="A short bio or notes about the candidate"
            :error="errors.summary"
            :from-cv="fromCv.summary"
            @edited="onEdited('summary')"
            @blur="onBlur('summary')"
          />
        </div>
      </section>

      <!-- Card 7: Add to a job (only when the organisation has open jobs) -->
      <section v-if="openJobs.length" :class="candidateCardClass" aria-labelledby="card-job">
        <h2 id="card-job" class="mb-4 text-base font-semibold text-surface-900 dark:text-surface-100">Add to a job</h2>
        <label for="jobId" :class="candidateLabelClass">Job</label>
        <select id="jobId" v-model="jobId" :class="[candidateInputClass, candidateBorderClass(false), 'appearance-auto']">
          <option value="">Don't add to a job</option>
          <option v-for="job in openJobs" :key="job.id" :value="job.id">{{ job.title }}</option>
        </select>
      </section>

      <!-- Duplicate check -->
      <CandidatesDuplicateWarning v-model="differentPerson" :matches="duplicates" :error="errors.differentPerson" />

      <!-- Actions -->
      <div class="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
        <!-- Accessible name starts with "Add Candidate" (the action's long-standing name) and contains the visible text -->
        <button
          type="submit"
          :disabled="isSubmitting"
          aria-label="Add Candidate: Save & open profile"
          :class="[buttonBase, 'bg-brand-600 text-white hover:bg-brand-700']"
        >
          <Loader2 v-if="savingMode === 'open'" class="size-4 animate-spin" aria-hidden="true" />
          {{ savingMode === 'open' ? 'Saving…' : 'Save & open profile' }}
        </button>
        <button
          type="button"
          :disabled="isSubmitting"
          :class="[buttonBase, 'border border-brand-600 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950']"
          @click="save('another')"
        >
          <Loader2 v-if="savingMode === 'another'" class="size-4 animate-spin" aria-hidden="true" />
          {{ savingMode === 'another' ? 'Saving…' : 'Save & add another' }}
        </button>
        <NuxtLink
          :to="$localePath('/dashboard/candidates')"
          :class="[buttonBase, 'border border-surface-300 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800']"
        >
          Cancel
        </NuxtLink>
      </div>
      <p class="text-xs text-surface-500 dark:text-surface-400">
        Tip: press Ctrl + Enter (or ⌘ + Enter on a Mac) to save.
      </p>
    </form>
  </div>
</template>
