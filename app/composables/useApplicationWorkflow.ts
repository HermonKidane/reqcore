import type { MaybeRefOrGetter } from 'vue'

export interface WorkflowStepTemplate {
  id: string
  stepNumber: number
  phase: string
  key: string
  name: string
  description: string | null
  requiredFields: string[]
  completionRules: Record<string, unknown> | null
}

/** AI run row as returned by the ai-runs endpoints */
export interface AiRun {
  id: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'approved' | 'rejected'
  provider: string
  model: string
  output: { text: string, parsed?: unknown } | null
  error: string | null
  reviewNote: string | null
  reviewedAt: string | null
  createdAt: string
  completedAt: string | null
  promptTemplate: { name: string, version: number } | null
  promptSnapshot: {
    safetyNotes: string | null
    [key: string]: unknown
  } | null
}

export interface WorkflowInstance {
  id: string
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'skipped'
  dueAt: string | null
  startedAt: string | null
  completedAt: string | null
  completionData: Record<string, unknown> | null
  riskLevel: string | null
  blockedReason: string | null
  stepTemplate: WorkflowStepTemplate
  assignedTo: { id: string, name: string, email: string } | null
}

export interface ApplicationWorkflow {
  workflow: {
    id: string
    status: string
    startedAt: string
    completedAt: string | null
    template: { id: string, name: string, version: number } | null
  }
  progress: {
    total: number
    completed: number
    skipped: number
    blocked: number
    in_progress: number
    pending: number
    percent: number
  }
  instances: WorkflowInstance[]
}

export interface StepEvent {
  id: string
  eventType: string
  payload: Record<string, unknown> | null
  source: string
  occurredAt: string
  actor: { id: string, name: string, email: string } | null
}

/**
 * Composable for the 30-step workflow attached to an application.
 */
export function useApplicationWorkflow(id: MaybeRefOrGetter<string>) {
  const applicationId = computed(() => toValue(id))

  const { data, status, error, refresh } = useFetch<ApplicationWorkflow>(
    () => `/api/applications/${applicationId.value}/workflow`,
    {
      key: computed(() => `application-workflow-${applicationId.value}`),
      headers: useRequestHeaders(['cookie']),
    },
  )

  /** Run a state-machine action against a step instance, then refresh. */
  async function updateStep(instanceId: string, body: Record<string, unknown>) {
    await $fetch(`/api/step-instances/${instanceId}`, {
      method: 'PATCH',
      body,
    })
    await refresh()
  }

  /** Fetch the immutable event trail for a step instance. */
  async function fetchStepEvents(instanceId: string): Promise<StepEvent[]> {
    const res = await $fetch<{ events: StepEvent[] }>(`/api/step-instances/${instanceId}/events`, {
      headers: useRequestHeaders(['cookie']),
    })
    return res.events
  }

  /** Generate an AI assist run for a step instance (returns the run row). */
  async function generateAiRun(instanceId: string): Promise<AiRun> {
    return $fetch<AiRun>(`/api/step-instances/${instanceId}/ai-runs`, {
      method: 'POST',
      body: {},
      headers: useRequestHeaders(['cookie']),
    })
  }

  /** List AI runs for a step instance (newest first). */
  async function fetchAiRuns(instanceId: string): Promise<AiRun[]> {
    const res = await $fetch<{ runs: AiRun[] }>(`/api/step-instances/${instanceId}/ai-runs`, {
      headers: useRequestHeaders(['cookie']),
    })
    return res.runs
  }

  /** Approve/reject a succeeded AI run (one-shot; does not touch step data). */
  async function reviewAiRun(runId: string, decision: 'approve' | 'reject', note?: string): Promise<AiRun> {
    return $fetch<AiRun>(`/api/ai-runs/${runId}/review`, {
      method: 'POST',
      body: { decision, note },
      headers: useRequestHeaders(['cookie']),
    })
  }

  return { workflowData: data, status, error, refresh, updateStep, fetchStepEvents, generateAiRun, fetchAiRuns, reviewAiRun }
}
