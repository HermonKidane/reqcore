<script setup lang="ts">
import { ShieldCheck, Ban, Plus, X, Loader2, FileCheck } from 'lucide-vue-next'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'
import { useClientCompanies } from '~/composables/useClientCompanies'

/**
 * Consent & contact section on the candidate page (Session W slice 1).
 *  - Consent to represent: list, record, revoke (step 6 #5; gates step 7)
 *  - Do-not-contact flag with source / date / note (step 5 #4)
 *  - Privacy-notice dates: collected, due, sent (step 4 #5, UK GDPR Art 14)
 */

interface Consent {
  id: string
  scope: 'all_clients' | 'named_clients' | 'role_types'
  clientCompanyIds: string[]
  roleTypes: string[]
  givenAt: string
  channel: string
  evidenceQuote: string
  revokedAt: string | null
  revokedReason: string | null
  recordedBy: { id: string, name: string } | null
}

const props = defineProps<{
  candidateId: string
  candidate: {
    doNotContact?: boolean
    doNotContactAt?: string | null
    doNotContactSource?: string | null
    doNotContactNote?: string | null
    collectedAt?: string | null
    privacyNoticeDueAt?: string | null
    privacyNoticeSentAt?: string | null
    consents?: Consent[]
  }
}>()

const emit = defineEmits<{ (e: 'changed'): void }>()

const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const { companies } = useClientCompanies()

const companyName = (id: string) => companies.value.find((c: any) => c.id === id)?.name ?? 'Unknown client'

const scopeLabel: Record<Consent['scope'], string> = {
  all_clients: 'Any client',
  named_clients: 'Named clients only',
  role_types: 'Named role types',
}
const channelLabel: Record<string, string> = { call: 'Call', email: 'Email', whatsapp: 'WhatsApp', in_person: 'In person', other: 'Other', sms: 'SMS', linkedin: 'LinkedIn' }

const consents = computed(() => props.candidate.consents ?? [])
const activeConsents = computed(() => consents.value.filter(c => !c.revokedAt))

const error = ref('')
const busy = ref(false)

// ── Record consent ──
const showForm = ref(false)
const form = reactive({
  scope: 'all_clients' as Consent['scope'],
  clientCompanyIds: [] as string[],
  roleTypesText: '',
  givenAt: '',
  channel: 'call',
  evidenceQuote: '',
})

function resetForm() {
  form.scope = 'all_clients'
  form.clientCompanyIds = []
  form.roleTypesText = ''
  form.givenAt = toLocalInput(new Date())
  form.channel = 'call'
  form.evidenceQuote = ''
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function openForm() {
  resetForm()
  showForm.value = true
  error.value = ''
}

async function saveConsent() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await $fetch(`/api/candidates/${props.candidateId}/consents`, {
      method: 'POST',
      body: {
        scope: form.scope,
        clientCompanyIds: form.scope === 'named_clients' ? form.clientCompanyIds : [],
        roleTypes: form.scope === 'role_types' ? form.roleTypesText.split(',').map(s => s.trim()).filter(Boolean) : [],
        givenAt: form.givenAt ? new Date(form.givenAt).toISOString() : new Date().toISOString(),
        channel: form.channel,
        evidenceQuote: form.evidenceQuote.trim(),
      },
    })
    showForm.value = false
    emit('changed')
  }
  catch (err: any) {
    if (!handlePreviewReadOnlyError(err)) error.value = err.data?.statusMessage ?? err.message ?? 'Consent not saved'
  }
  finally {
    busy.value = false
  }
}

async function revoke(consent: Consent) {
  const reason = window.prompt('Why is this consent being revoked? (optional)') ?? undefined
  if (reason === undefined && !window.confirm('Revoke this consent?')) return
  busy.value = true
  error.value = ''
  try {
    await $fetch(`/api/candidates/${props.candidateId}/consents/${consent.id}`, { method: 'PATCH', body: { revokedReason: reason || undefined } })
    emit('changed')
  }
  catch (err: any) {
    if (!handlePreviewReadOnlyError(err)) error.value = err.data?.statusMessage ?? err.message ?? 'Consent not revoked'
  }
  finally {
    busy.value = false
  }
}

// ── Do not contact ──
const showDnc = ref(false)
const dnc = reactive({ source: 'call', note: '' })

async function patchCandidate(body: Record<string, unknown>) {
  busy.value = true
  error.value = ''
  try {
    await $fetch(`/api/candidates/${props.candidateId}`, { method: 'PATCH', body })
    emit('changed')
    return true
  }
  catch (err: any) {
    if (!handlePreviewReadOnlyError(err)) error.value = err.data?.statusMessage ?? err.message ?? 'Not saved'
    return false
  }
  finally {
    busy.value = false
  }
}

async function setDoNotContact() {
  if (await patchCandidate({ doNotContact: true, doNotContactSource: dnc.source, doNotContactNote: dnc.note.trim() || undefined })) {
    showDnc.value = false
    dnc.note = ''
  }
}

async function clearDoNotContact() {
  const note = window.prompt('Why is the flag being cleared? (required — e.g. "candidate asked to be contacted again on 5 Nov")')
  if (!note || !note.trim()) return
  await patchCandidate({ doNotContact: false, doNotContactNote: note.trim() })
}

// ── Privacy notice ──
async function markNoticeSent() {
  await patchCandidate({ privacyNoticeSentAt: new Date().toISOString() })
}

const noticeOverdue = computed(() => {
  const c = props.candidate
  return !c.privacyNoticeSentAt && c.privacyNoticeDueAt && new Date(c.privacyNoticeDueAt).getTime() < Date.now()
})
</script>

<template>
  <div class="space-y-5" data-testid="consent-panel">
    <p v-if="error" class="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">
      {{ error }}
    </p>

    <!-- Do not contact -->
    <section class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="inline-flex items-center gap-2 text-sm font-semibold text-surface-800 dark:text-surface-200">
            <Ban class="size-4 text-danger-600" />
            Do not contact
          </h3>
          <p v-if="candidate.doNotContact" class="mt-1 text-sm text-danger-700 dark:text-danger-400" data-testid="dnc-status">
            Flagged{{ candidate.doNotContactAt ? ` on ${formatDate(candidate.doNotContactAt)}` : '' }}{{ candidate.doNotContactSource ? ` · ${channelLabel[candidate.doNotContactSource] ?? candidate.doNotContactSource}` : '' }}.
            Blocks call prep, drafts and messages for everyone in the team.
          </p>
          <p v-else class="mt-1 text-sm text-surface-500">
            Not flagged. If this person asks not to be contacted, record it here — it applies to the whole team at once.
          </p>
          <p v-if="candidate.doNotContactNote" class="mt-1 text-xs text-surface-500">
            Note: {{ candidate.doNotContactNote }}
          </p>
        </div>
        <div class="shrink-0">
          <button
            v-if="candidate.doNotContact"
            :disabled="busy"
            class="rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 min-h-9 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50"
            data-testid="dnc-clear"
            @click="clearDoNotContact"
          >
            Clear flag
          </button>
          <button
            v-else
            :disabled="busy"
            class="rounded-lg border border-danger-300 px-3 py-1.5 min-h-9 text-xs font-medium text-danger-700 hover:bg-danger-50 disabled:opacity-50"
            data-testid="dnc-open"
            @click="showDnc = !showDnc"
          >
            Mark do not contact
          </button>
        </div>
      </div>
      <div v-if="showDnc && !candidate.doNotContact" class="mt-3 grid gap-3 sm:grid-cols-[160px_1fr_auto]">
        <label class="text-xs">
          <span class="mb-1 block font-medium text-surface-500">How they asked</span>
          <select v-model="dnc.source" class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-2 text-sm" data-testid="dnc-source">
            <option value="call">On a call</option>
            <option value="email">By email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
            <option value="linkedin">LinkedIn</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label class="text-xs">
          <span class="mb-1 block font-medium text-surface-500">Their words (optional)</span>
          <input v-model="dnc.note" maxlength="1000" class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-2 text-sm" data-testid="dnc-note">
        </label>
        <button :disabled="busy" class="self-end rounded-lg bg-danger-600 px-3 py-2 min-h-9 text-xs font-medium text-white hover:bg-danger-700 disabled:opacity-50" data-testid="dnc-save" @click="setDoNotContact">
          <Loader2 v-if="busy" class="mr-1 inline size-3 animate-spin" />
          Save flag
        </button>
      </div>
    </section>

    <!-- Consent to represent -->
    <section class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 class="inline-flex items-center gap-2 text-sm font-semibold text-surface-800 dark:text-surface-200">
          <ShieldCheck class="size-4 text-success-600" />
          Consent to be put forward
          <span class="rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-xs font-medium text-surface-600 dark:text-surface-300">{{ activeConsents.length }} active</span>
        </h3>
        <button
          :disabled="busy"
          class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 min-h-9 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          data-testid="consent-open"
          @click="showForm ? (showForm = false) : openForm()"
        >
          <Plus class="size-3.5" />
          Record consent
        </button>
      </div>
      <p class="mb-3 text-xs text-surface-500">
        A candidate cannot be presented to a client (step 7) unless an active consent covers that client. Record what they said, when and how.
      </p>

      <div v-if="showForm" class="mb-4 grid gap-3 rounded-lg border border-brand-200 dark:border-brand-900 bg-brand-50/40 dark:bg-brand-950/20 p-3 sm:grid-cols-2" data-testid="consent-form">
        <label class="text-xs">
          <span class="mb-1 block font-medium text-surface-500">Scope</span>
          <select v-model="form.scope" class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-2 text-sm" data-testid="consent-scope">
            <option value="all_clients">Any client</option>
            <option value="named_clients">Named clients only</option>
            <option value="role_types">Named role types</option>
          </select>
        </label>
        <label class="text-xs">
          <span class="mb-1 block font-medium text-surface-500">How it was given</span>
          <select v-model="form.channel" class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-2 text-sm" data-testid="consent-channel">
            <option value="call">On a call</option>
            <option value="email">By email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="in_person">In person</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label v-if="form.scope === 'named_clients'" class="text-xs sm:col-span-2">
          <span class="mb-1 block font-medium text-surface-500">Clients (hold Ctrl/Cmd to pick several)</span>
          <select v-model="form.clientCompanyIds" multiple size="5" class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-2 text-sm" data-testid="consent-clients">
            <option v-for="c in companies" :key="(c as any).id" :value="(c as any).id">{{ (c as any).name }}</option>
          </select>
        </label>
        <label v-if="form.scope === 'role_types'" class="text-xs sm:col-span-2">
          <span class="mb-1 block font-medium text-surface-500">Role types, comma-separated (max 10)</span>
          <input v-model="form.roleTypesText" maxlength="700" placeholder="e.g. senior consultant, team lead" class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-2 text-sm" data-testid="consent-role-types">
        </label>
        <label class="text-xs">
          <span class="mb-1 block font-medium text-surface-500">Given on</span>
          <input v-model="form.givenAt" type="datetime-local" class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-2 text-sm" data-testid="consent-given-at">
        </label>
        <label class="text-xs sm:col-span-2">
          <span class="mb-1 block font-medium text-surface-500">Their words <span class="text-danger-500">*</span></span>
          <textarea v-model="form.evidenceQuote" rows="2" maxlength="1000" placeholder="e.g. &quot;Yes, happy for you to put me forward to anyone in the Leeds market.&quot;" class="w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-2 text-sm" data-testid="consent-quote" />
        </label>
        <div class="flex gap-2 sm:col-span-2">
          <button :disabled="busy || !form.evidenceQuote.trim()" class="rounded-lg bg-brand-600 px-3 py-2 min-h-9 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50" data-testid="consent-save" @click="saveConsent">
            <Loader2 v-if="busy" class="mr-1 inline size-3 animate-spin" />
            Save consent
          </button>
          <button class="rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-2 min-h-9 text-xs font-medium text-surface-600 dark:text-surface-300" @click="showForm = false">
            Cancel
          </button>
        </div>
      </div>

      <ul v-if="consents.length" class="divide-y divide-surface-100 dark:divide-surface-800">
        <li v-for="c in consents" :key="c.id" class="flex flex-wrap items-start justify-between gap-2 py-2.5" :class="c.revokedAt ? 'opacity-60' : ''" data-testid="consent-row">
          <div class="min-w-0 text-sm">
            <p class="font-medium text-surface-800 dark:text-surface-200">
              {{ scopeLabel[c.scope] }}
              <template v-if="c.scope === 'named_clients'"> · {{ c.clientCompanyIds.map(companyName).join(', ') }}</template>
              <template v-else-if="c.scope === 'role_types'"> · {{ c.roleTypes.join(', ') }}</template>
              <span v-if="c.revokedAt" class="ml-1 rounded-full bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[10px] font-medium text-surface-500">revoked {{ formatDate(c.revokedAt) }}</span>
            </p>
            <p class="text-xs text-surface-500">
              {{ formatDate(c.givenAt) }} · {{ channelLabel[c.channel] ?? c.channel }}<template v-if="c.recordedBy"> · recorded by {{ c.recordedBy.name }}</template>
            </p>
            <p class="mt-0.5 text-xs italic text-surface-600 dark:text-surface-400">"{{ c.evidenceQuote }}"</p>
            <p v-if="c.revokedReason" class="text-xs text-surface-500">Revoked: {{ c.revokedReason }}</p>
          </div>
          <button
            v-if="!c.revokedAt"
            :disabled="busy"
            class="inline-flex items-center gap-1 rounded-lg border border-surface-300 dark:border-surface-600 px-2.5 py-1.5 min-h-9 text-xs text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50"
            data-testid="consent-revoke"
            @click="revoke(c)"
          >
            <X class="size-3" />
            Revoke
          </button>
        </li>
      </ul>
      <p v-else class="text-sm text-surface-400">No consent on file yet.</p>
    </section>

    <!-- Privacy notice (Art 14) -->
    <section class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4">
      <h3 class="inline-flex items-center gap-2 text-sm font-semibold text-surface-800 dark:text-surface-200">
        <FileCheck class="size-4 text-brand-600" />
        Privacy notice
      </h3>
      <dl class="mt-2 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt class="text-xs font-medium text-surface-400">Data collected</dt>
          <dd class="text-surface-800 dark:text-surface-200">{{ candidate.collectedAt ? formatDate(candidate.collectedAt) : '—' }}</dd>
        </div>
        <div>
          <dt class="text-xs font-medium text-surface-400">Notice due</dt>
          <dd :class="noticeOverdue ? 'text-danger-700 dark:text-danger-400 font-medium' : 'text-surface-800 dark:text-surface-200'" data-testid="notice-due">
            {{ candidate.privacyNoticeSentAt ? '—' : (candidate.privacyNoticeDueAt ? formatDate(candidate.privacyNoticeDueAt) : '—') }}<template v-if="noticeOverdue"> (overdue)</template>
          </dd>
        </div>
        <div>
          <dt class="text-xs font-medium text-surface-400">Notice sent</dt>
          <dd class="text-surface-800 dark:text-surface-200">
            <template v-if="candidate.privacyNoticeSentAt">{{ formatDate(candidate.privacyNoticeSentAt) }}</template>
            <button v-else :disabled="busy" class="rounded-lg border border-surface-300 dark:border-surface-600 px-2.5 py-1 min-h-9 text-xs font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50" data-testid="notice-sent" @click="markNoticeSent">
              Mark sent today
            </button>
          </dd>
        </div>
      </dl>
      <p class="mt-2 text-xs text-surface-500">
        Someone whose details were not collected from them directly must get the privacy notice within a month, or at first contact if sooner.
      </p>
    </section>
  </div>
</template>
