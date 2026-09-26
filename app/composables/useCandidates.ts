import type { Ref } from 'vue'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'

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
  async function createCandidate(payload: {
    firstName: string
    lastName: string
    email: string
    phone?: string
  }) {
    try {
      const created = await $fetch('/api/candidates', {
        method: 'POST',
        body: payload,
      })
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
