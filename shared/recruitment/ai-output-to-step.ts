/**
 * Session W slice 1 — "Use in step": turn an approved AI run's parsed output
 * into completion-form values the recruiter can edit and save.
 *
 * Pure and client-safe. Nothing here writes anywhere: the panel pre-fills
 * its complete form from the result and the recruiter saves through the
 * ordinary step PATCH (the server principle "review never touches
 * completion_data" stands).
 *
 * Keys that match a step's `requiredFields` fill the required inputs; the
 * rest appear as extra editable rows. Every value is a string.
 */

type Rec = Record<string, unknown>

const q = (v: unknown): string | null => {
  if (v && typeof v === 'object' && 'value' in (v as Rec)) {
    const value = (v as Rec).value
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

const lines = (items: unknown, pick: (item: Rec) => string | null): string | null => {
  if (!Array.isArray(items)) return null
  const out = items.map(i => (i && typeof i === 'object' ? pick(i as Rec) : null)).filter((s): s is string => !!s)
  return out.length ? out.map(s => `• ${s}`).join('\n') : null
}

const set = (target: Record<string, string>, key: string, value: string | null | undefined) => {
  if (value) target[key] = value
}

export function aiOutputToStepFields(stepKey: string, purpose: string, parsed: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!parsed || typeof parsed !== 'object') return out
  const p = parsed as Rec

  if (purpose === 'outcome' && stepKey === 'complete_job_order') {
    const gaps = Array.isArray(p.jobOrderGaps) ? (p.jobOrderGaps as Rec[]) : []
    const salary = gaps.find(g => g.field === 'salary_range')
    set(out, 'jobDescription', [q(p.summary), lines(p.keyTakeaways, i => q(i.text))].filter(Boolean).join('\n\n') || null)
    set(out, 'salaryRange', salary && typeof salary.quote === 'string' ? salary.quote : null)
    set(out, 'jobOrderGaps', lines(gaps.filter(g => g.status !== 'covered'), g => `${String(g.field)} (${String(g.status)})${g.howToAsk ? ` — ask: ${String(g.howToAsk)}` : ''}`))
    const sp = p.successProfile as Rec | undefined
    if (sp) {
      set(out, 'successProfile', [
        lines(sp.outcomes, i => q(i.text)),
        sp.complexity && typeof sp.complexity === 'object'
          ? `• complexity: ${Object.entries(sp.complexity as Rec).filter(([, v]) => v && v !== 'unknown').map(([k, v]) => `${k} ${String(v)}`).join(', ') || 'unknown'}`
          : null,
        lines(sp.hardParameters, i => q(i.text)),
      ].filter(Boolean).join('\n') || null)
    }
    set(out, 'claims', lines(p.claims, i => `${q(i.item) ?? ''} [${String(i.status)}]`))
    set(out, 'suggestedTag', q(p.suggestedTag) ? `${q(p.suggestedTag)}${q(p.suggestedTagReason) ? ` — ${q(p.suggestedTagReason)}` : ''}` : null)
  }

  if (purpose === 'outcome' && stepKey === 'candidate_contact') {
    set(out, 'contactOutcome', q(p.contactOutcome))
    set(out, 'callBackAt', q(p.callBackAt))
    set(out, 'noticePeriod', q(p.noticePeriod))
    set(out, 'salaryExpectation', q(p.salaryExpectation))
    set(out, 'secondPitchAt', q(p.secondPitchAt))
    const ref = p.referral as Rec | null | undefined
    if (ref && (q(ref.name) || q(ref.bestTime))) set(out, 'referral', [q(ref.name), q(ref.bestTime)].filter(Boolean).join(' · '))
    set(out, 'valuesHeard', lines(p.valuesHeard, i => q(i.text)))
    if (p.mobileMentioned === true) set(out, 'personalMobile', '[mentioned on the call — type it in]')
  }

  if (purpose === 'outcome' && stepKey === 'candidate_profile') {
    set(out, 'profileSummary', q(p.profileSummary))
    set(out, 'noticePeriod', q(p.noticePeriod))
    set(out, 'motivations', lines(p.motivations, i => q(i.value)))
    set(out, 'rolesSought', Array.isArray(p.rolesSought) && p.rolesSought.length ? (p.rolesSought as unknown[]).map(String).join('; ') : null)
    set(out, 'reasonsForLeaving', lines(p.reasonsForLeaving, i => `${q(i.role) ?? ''}: ${q(i.reason) ?? ''}`))
    set(out, 'reconciliation', lines(p.reconciliation, i => `${q(i.field) ?? ''}: CV "${q(i.cvValue) ?? '—'}" vs call "${q(i.callValue) ?? '—'}" — ${q(i.note) ?? ''}`))
  }

  if (purpose === 'outcome' && stepKey === 'candidate_debrief') {
    const il = p.interestLevel as Rec | undefined
    const interest = il
      ? `Interest: ${il.rating ?? 'unknown'}${il.basis ? ` (${String(il.basis)})` : ''}${q(il.candidateWords) ? ` — "${q(il.candidateWords)}"` : ''}`
      : null
    set(out, 'debriefNotes', [
      q(p.summary),
      lines(p.concerns, i => q(i.candidateWords) ?? q(i.concern)),
      lines(p.competingProcesses, i => `${q(i.description) ?? ''}${i.stage ? ` (${String(i.stage)})` : ''}`),
      interest,
    ].filter(Boolean).join('\n\n') || null)
  }

  return out
}

/** Proposed tasks in an approved outcome run (steps 1, 5, 11) → "Add as tasks" rows. */
export function aiOutputToTasks(stepKey: string, purpose: string, parsed: unknown): Array<{ title: string, dueAt: string | null }> {
  if (purpose !== 'outcome' || !parsed || typeof parsed !== 'object') return []
  const p = parsed as Rec
  const src = stepKey === 'complete_job_order' ? p.actionTasks : stepKey === 'candidate_debrief' ? p.nextActions : p.nextActions
  if (!Array.isArray(src)) return []
  return (src as Rec[])
    .map(i => ({ title: q(i.text) ?? q(i.action) ?? '', dueAt: q(i.dueDate) ?? q(i.due) }))
    .filter(t => t.title)
    .slice(0, 20)
}
