import { eq, and, asc } from 'drizzle-orm'
import { application, recruitmentWorkflow, recruitmentStepInstance } from '../../../database/schema'
import { applicationIdParamSchema } from '../../../utils/schemas/application'
import { ensureApplicationWorkflow, completeWorkflowIfDone } from '../../../utils/recruitment/workflowService'

/**
 * GET /api/applications/:id/workflow
 * 30-Step process progress for an application.
 * Lazily creates the workflow + 30 step instances from the org's
 * default process template on first view (idempotent).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { workflow: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true, jobId: true },
  })
  if (!app) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const workflowId = await ensureApplicationWorkflow(orgId, app)

  const workflow = await db.query.recruitmentWorkflow.findFirst({
    where: and(
      eq(recruitmentWorkflow.id, workflowId),
      eq(recruitmentWorkflow.organizationId, orgId),
    ),
    with: {
      template: { columns: { id: true, name: true, version: true } },
    },
  })
  if (!workflow) {
    throw createError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  // Self-heal: converge workflow status if the last open steps were
  // completed concurrently (conditional UPDATE is a no-op otherwise).
  if (workflow.status === 'active') {
    await completeWorkflowIfDone(workflowId)
    workflow.status = await db.query.recruitmentWorkflow
      .findFirst({ where: eq(recruitmentWorkflow.id, workflowId), columns: { status: true } })
      .then(r => r?.status ?? workflow.status)
    if (workflow.status === 'completed') {
      workflow.completedAt = await db.query.recruitmentWorkflow
        .findFirst({ where: eq(recruitmentWorkflow.id, workflowId), columns: { completedAt: true } })
        .then(r => r?.completedAt ?? null)
    }
  }

  const instances = await db.query.recruitmentStepInstance.findMany({
    where: eq(recruitmentStepInstance.workflowId, workflowId),
    with: {
      stepTemplate: {
        columns: {
          id: true,
          stepNumber: true,
          phase: true,
          key: true,
          name: true,
          description: true,
          requiredFields: true,
        },
      },
      assignedTo: { columns: { id: true, name: true, email: true } },
    },
    orderBy: asc(recruitmentStepInstance.createdAt),
  })

  // Order by step number (createdAt is uniform for lazily-created batches)
  instances.sort((a, b) => a.stepTemplate.stepNumber - b.stepTemplate.stepNumber)

  const counts = { total: instances.length, completed: 0, skipped: 0, blocked: 0, in_progress: 0, pending: 0 }
  for (const i of instances) {
    counts[i.status]++
  }
  const done = counts.completed + counts.skipped
  const percent = counts.total === 0 ? 0 : Math.round((done / counts.total) * 100)

  return {
    workflow: {
      id: workflow.id,
      status: workflow.status,
      startedAt: workflow.startedAt,
      completedAt: workflow.completedAt,
      template: workflow.template,
    },
    progress: { ...counts, percent },
    instances,
  }
})
