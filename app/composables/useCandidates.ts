import type { Ref } from 'vue'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'

/** Body of POST /api/candidates (Add Candidate 2.0) */
export interface CreateCandidatePayload {
  firstName: string
  lastName: string
  email?: string
  phone?: string
  linkedinUrl?: string
  position?: string
  company?: string
  location?: string
  headline?: string
  summary?: string
  // Qualifiers — option lists in shared/candidate-qualifiers.ts
  sourceChannel?: string
  salaryCurrency?: string
  salaryCurrent?: number
  salaryExpected?: number
  dayRate?: number
  noticePeriod?: string
  rightToWork?: string
  workPreference?: string
  /** Saved with the person, in the same transaction */
  skills?: string[]
  experiences?: Array<Record<string, unknown>>
  education?: Array<Record<string, unknown>>
}

/**
 * Composable for managing the candidates list with search, pagination, and mutations.
 * Wraps `useFetch('/api/candidates')` with a singleton key for shared state.
 */
export function useCandidates(options?: {
  search?: Ref<string | undefined> | string
  /** Filter by ACTIVE person role ('candidate' is application-derived, never a role) */
  role?: Ref<string | undefined> | string
  /** Filter by client company (active client_contact roles at that company) */
  companyId?: Ref<string | undefined> | string
}) {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()

  const query = computed(() => ({
    ...(toValue(options?.search) && { search: toValue(options?.search) }),
    ...(toValue(options?.role) && { role: toValue(options?.role) }),
    ...(toValue(options?.companyId) && { companyId: toValue(options?.companyId) }),
  }))

  const { data, status: fetchStatus, error, refresh } = useFetch('/api/candidates', {
    key: 'candidates',
    query,
    headers: useRequestHeaders(['cookie']),
  })

  const candidates = computed(() => data.value?.data ?? [])
  const total = computed(() => data.value?.total ?? 0)

  /** Create a new candidate and refresh the list */
  async function createCandidate(payload: CreateCandidatePayload) {
    try {
      // Untyped alias: the typed /api/candidates route (it has /duplicates,
      // /parse and /:id siblings) hits TS "excessive stack depth".
      const $api = $fetch as (url: string, opts?: any) => Promise<any>
      const created = await $api('/api/candidates', {
        method: 'POST',
        body: payload,
      }) as { id: string } & Record<string, unknown>
      await refresh()
      return created
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
  }

  /** Delete a candidate by ID and refresh the list */
  async function deleteCandidate(id: string) {
    try {
      await $fetch(`/api/candidates/${id}`, { method: 'DELETE' })
    } catch (error) {
      handlePreviewReadOnlyError(error)
      throw error
    }
    await refresh()
  }

  return {
    candidates,
    total,
    fetchStatus,
    error,
    refresh,
    createCandidate,
    deleteCandidate,
  }
}
