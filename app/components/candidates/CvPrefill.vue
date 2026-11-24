<script setup lang="ts">
import { FileText, Loader2, Upload, X } from 'lucide-vue-next'

export interface CvParseResult {
  fields: Record<'firstName' | 'lastName' | 'email' | 'phone' | 'linkedinUrl' | 'position' | 'company' | 'location' | 'headline' | 'summary', string | null>
  skills: string[]
  experiences: Array<Record<string, unknown>>
  education: Array<Record<string, unknown>>
  source: 'file' | 'text'
  filename?: string
  aiUnavailable?: boolean
}

/**
 * "Start from a CV" card. Optional: reads a PDF / Word .docx / text file, or
 * pasted text, and hands the result to the page, which fills only the
 * fields that are still empty. The page owns the held file and the work
 * history; this card just shows them.
 */
defineProps<{
  /** Name of the file that will be attached to the new profile (null = none) */
  attachedFilename: string | null
  /** e.g. "3 jobs and 2 courses will be saved to the profile" (null = nothing held) */
  historySummary: string | null
}>()

const emit = defineEmits<{
  'filled': [result: CvParseResult]
  /** A PDF / .docx the page should attach to the profile after saving */
  'attach': [file: File]
  'remove-file': []
  'discard-history': []
}>()

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MIN_TEXT = 50
const MAX_TEXT = 60_000

// Untyped fetch alias: typed /api/candidates/* routes hit TS "excessive stack depth".
const $api = $fetch as (url: string, opts?: any) => Promise<any>

const showPaste = ref(false)
const pastedText = ref('')
const chosenFile = ref<File | null>(null)
const isDragging = ref(false)
const isReading = ref(false)
const error = ref('')
const note = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const canRead = computed(() => !isReading.value && (chosenFile.value !== null || pastedText.value.trim().length >= MIN_TEXT))

/** Only PDF and .docx can be stored on the profile (the documents upload refuses plain text). */
function canAttach(file: File): boolean {
  return /\.(pdf|docx)$/i.test(file.name)
}

function pickFile(file: File | undefined | null) {
  error.value = ''
  note.value = ''
  if (!file) return
  if (/\.doc$/i.test(file.name)) {
    error.value = 'Old .doc files can\'t be read. Save it as PDF or .docx and try again.'
    return
  }
  if (file.size > MAX_FILE_BYTES) {
    error.value = 'That file is too big. The limit is 10 MB.'
    return
  }
  if (file.size === 0) {
    error.value = 'That file is empty.'
    return
  }
  chosenFile.value = file
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  pickFile(input.files?.[0])
  input.value = ''
}

function onDrop(event: DragEvent) {
  isDragging.value = false
  pickFile(event.dataTransfer?.files?.[0])
}

function clearChosen() {
  chosenFile.value = null
  error.value = ''
}

async function read() {
  if (!canRead.value) return
  error.value = ''
  note.value = ''
  isReading.value = true
  const file = chosenFile.value
  try {
    let result: CvParseResult
    if (file) {
      const body = new FormData()
      body.append('file', file)
      result = await $api('/api/candidates/parse', { method: 'POST', body }) as CvParseResult
    }
    else {
      if (pastedText.value.length > MAX_TEXT) {
        error.value = 'That text is too long. The limit is 60,000 characters.'
        return
      }
      result = await $api('/api/candidates/parse', { method: 'POST', body: { text: pastedText.value } }) as CvParseResult
    }
    if (file && canAttach(file)) emit('attach', file)
    emit('filled', result)
    note.value = result.aiUnavailable
      ? 'We found the contact details. The rest could not be read automatically, so please type it in.'
      : 'Done. Check the details below before you save.'
    chosenFile.value = null
    pastedText.value = ''
  }
  catch (err: any) {
    const message: string = err?.data?.statusMessage ?? ''
    error.value = message
      ? message.replace(/^Validation failed: (text: )?/, '')
      : 'Something went wrong reading that. You can still type the details below.'
    // An unreadable (e.g. scanned) CV is still worth keeping on the profile
    const status = err?.statusCode ?? err?.data?.statusCode
    if (file && canAttach(file) && (status === 422 || status === 502)) emit('attach', file)
  }
  finally {
    isReading.value = false
  }
}
</script>

<template>
  <section :class="candidateCardClass" aria-labelledby="cv-prefill-title" data-testid="cv-prefill">
    <h2 id="cv-prefill-title" class="text-base font-semibold text-surface-900 dark:text-surface-100">Start from a CV</h2>
    <p class="mt-1 text-sm text-surface-600 dark:text-surface-400">
      Optional. Add a CV and we'll fill in what we can. You can also skip this and type the details below.
    </p>

    <div
      class="mt-4 rounded-lg border-2 border-dashed p-4 text-center transition-colors"
      :class="isDragging
        ? 'border-brand-500 bg-brand-50 dark:bg-brand-950'
        : 'border-surface-300 dark:border-surface-700'"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="onDrop"
    >
      <template v-if="chosenFile">
        <p class="flex items-center justify-center gap-2 text-sm text-surface-700 dark:text-surface-200">
          <FileText class="size-4 shrink-0" aria-hidden="true" />
          <span class="min-w-0 break-all">{{ chosenFile.name }}</span>
          <button
            type="button"
            class="inline-flex min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 shrink-0 items-center justify-center rounded-full text-surface-500 hover:text-danger-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-label="Choose a different file"
            @click="clearChosen"
          >
            <X class="size-4" aria-hidden="true" />
          </button>
        </p>
      </template>
      <template v-else>
        <Upload class="mx-auto size-6 text-surface-400" aria-hidden="true" />
        <p class="mt-2 text-sm text-surface-600 dark:text-surface-400">
          <span class="hidden sm:inline">Drop a file here, or </span>
          <button
            type="button"
            class="inline-flex min-h-11 items-center rounded-lg px-2 font-medium text-brand-700 dark:text-brand-300 underline underline-offset-2 hover:text-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
            @click="fileInput?.click()"
          >
            Choose a file
          </button>
        </p>
        <p class="text-xs text-surface-500 dark:text-surface-400">PDF, Word (.docx) or text file, up to 10 MB</p>
      </template>
      <input
        ref="fileInput"
        type="file"
        class="sr-only"
        tabindex="-1"
        aria-label="CV file"
        accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        data-testid="cv-file-input"
        @change="onFileChange"
      />
    </div>

    <div class="mt-3">
      <button
        type="button"
        class="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 dark:text-brand-300 underline underline-offset-2 hover:text-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-lg"
        :aria-expanded="showPaste"
        aria-controls="cv-paste-area"
        @click="showPaste = !showPaste"
      >
        {{ showPaste ? 'Hide the text box' : 'Paste text instead' }}
      </button>
      <div v-show="showPaste" id="cv-paste-area" class="mt-2">
        <label for="cvText" :class="candidateLabelClass">CV text</label>
        <textarea
          id="cvText"
          v-model="pastedText"
          rows="6"
          :disabled="chosenFile !== null"
          placeholder="Paste the text of a CV, or the About section of a LinkedIn profile"
          aria-describedby="cvText-hint"
          :class="[candidateInputClass, candidateBorderClass(false), 'disabled:opacity-50']"
        />
        <p id="cvText-hint" class="mt-1 text-xs text-surface-500 dark:text-surface-400">
          {{ chosenFile ? 'Remove the file above to use pasted text.' : `At least ${MIN_TEXT} characters.` }}
        </p>
      </div>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        :disabled="!canRead"
        class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-surface-900"
        @click="read"
      >
        <Loader2 v-if="isReading" class="size-4 animate-spin" aria-hidden="true" />
        Fill the form
      </button>
      <p v-if="isReading" class="text-sm text-surface-600 dark:text-surface-400" role="status">Reading the CV…</p>
    </div>

    <p v-if="error" class="mt-3 rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400" role="alert" data-testid="cv-error">
      {{ error }}
    </p>
    <p v-else-if="note" class="mt-3 text-sm text-success-700 dark:text-success-400" role="status" data-testid="cv-note">{{ note }}</p>

    <ul v-if="attachedFilename || historySummary" class="mt-3 space-y-1 text-sm text-surface-700 dark:text-surface-200">
      <li v-if="attachedFilename" class="flex flex-wrap items-center gap-x-2">
        <FileText class="size-4 shrink-0 text-surface-400" aria-hidden="true" />
        <span class="min-w-0 break-all">{{ attachedFilename }} will be attached to the profile</span>
        <button
          type="button"
          class="inline-flex min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 items-center justify-center rounded-full text-surface-500 hover:text-danger-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="Don't attach this file"
          @click="emit('remove-file')"
        >
          <X class="size-4" aria-hidden="true" />
        </button>
      </li>
      <li v-if="historySummary" class="flex flex-wrap items-center gap-x-3">
        <span>{{ historySummary }}</span>
        <button
          type="button"
          class="inline-flex min-h-11 sm:min-h-8 items-center text-sm font-medium text-brand-700 dark:text-brand-300 underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-lg"
          @click="emit('discard-history')"
        >
          Don't save these
        </button>
      </li>
    </ul>

    <p class="mt-3 text-xs text-surface-500 dark:text-surface-400">
      Email and phone are read on our server and are not sent to the AI.
    </p>
  </section>
</template>
