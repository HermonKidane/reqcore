import type { Ref } from 'vue'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'

/**
 * Composable for the client-company list (search + pagination via the
 * shared useFetch key) and company mutations.
 */
export function useClientCompanies(options?: {
  search?: Ref<string | undefined> | string
  /** Mutations-only mode: skip the list fetch entirely (e.g. detail pages that only need update/delete) */
  mutationsOnly?: boolean
}) {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()

  const query = computed(() => ({
    ...(toValue(options?.search) && { search: toValue(options?.search) }),
  }))

  const {
    data,
    status: fetchStatus,
    error,
    refresh,
  } = useFetch('/api/client-companies', {
    key: 'client-companies',
    query,
    headers: useRequestHeaders(['cookie']),
    // `immediate: false` suppresses the fetch in mutations-only mode
    ...(options?.mutationsOnly ? { immediate: false as const } : {}),
  })

  const companies = computed(() => data.value?.data ?? [])
  const total = computed(() => data.value?.total ?? 0)

  async function createCompany(payload: { name: string, website?: string }) {
    try {
      const created = await $fetch('/api/client-companies', { method: 'POST', body: payload })
      await refresh()
      return created
    }
    catch (err) {
      handlePreviewReadOnlyError(err)
      throw err
    }
  }

  async function updateCompany(id: string, payload: { name?: string, website?: string | null }) {
    try {
      const updated = await $fetch(`/api/client-companies/${id}`, { method: 'PATCH', body: payload })
      await refresh()
      return updated
    }
    catch (err) {
      handlePreviewReadOnlyError(err)
      throw err
    }
  }

  async function deleteCompany(id: string) {
    try {
      await $fetch(`/api/client-companies/${id}`, { method: 'DELETE' })
    }
    catch (err) {
      handlePreviewReadOnlyError(err)
      throw err
    }
    await refresh()
  }

  return {
    companies,
    total,
    fetchStatus,
    error,
    refresh,
    createCompany,
    updateCompany,
    deleteCompany,
  }
}
