/**
 * Canonical 30-Step Recruitment Process — versioned seed data.
 *
 * Source: `info/PRD-enterprise-agency-ecosystem.md` §7 (r2r 30-step framework).
 * Steps 1–2 are job-level, 3–26 candidate/application-level, 27–30 placement-level.
 *
 * This is DATA, not UI code: it is seeded into `recruitmentProcessTemplate` +
 * `recruitmentStepTemplate` rows so the process can be versioned and customised
 * per org without code changes.
 *
 * `requiredFields` = completion-data keys that must be present (non-empty)
 * before a step instance can be marked complete.
 */

export interface CanonicalStep {
  stepNumber: number
  phase: string
  key: string
  name: string
  description: string
  requiredFields: string[]
  completionRules: Record<string, unknown>
}

export const CANONICAL_PROCESS_NAME = '30-Step Recruitment Process'

export const CANONICAL_PROCESS_VERSION = 1

export const CANONICAL_STEPS: CanonicalStep[] = [
  // ── Phase 1 — Intake and sourcing ──
  {
    stepNumber: 1,
    phase: 'Intake and sourcing',
    key: 'complete_job_order',
    name: 'Complete Job Order',
    description: 'Fully qualify the vacancy with the client: role scope, must-haves, compensation band, interview process, and decision makers.',
    requiredFields: ['jobDescription', 'salaryRange', 'clientContact'],
    completionRules: { evidence: 'completed_job_order' },
  },
  {
    stepNumber: 2,
    phase: 'Intake and sourcing',
    key: 'recruiting_plan',
    name: 'Recruiting Plan',
    description: 'Define the sourcing strategy: target companies, channels, search strings, and outreach volume targets.',
    requiredFields: ['targetCompanies', 'sourcingChannels'],
    completionRules: { evidence: 'recruiting_plan' },
  },
  {
    stepNumber: 3,
    phase: 'Intake and sourcing',
    key: 'file_search',
    name: 'File Search',
    description: 'Search the internal ATS/database for matching candidates already in the file.',
    requiredFields: ['candidatesIdentified'],
    completionRules: {},
  },
  {
    stepNumber: 4,
    phase: 'Intake and sourcing',
    key: 'name_gathering',
    name: 'Name Gathering',
    description: 'Source new names via LinkedIn, job boards, referrals, and market mapping.',
    requiredFields: ['candidatesIdentified'],
    completionRules: {},
  },
  {
    stepNumber: 5,
    phase: 'Intake and sourcing',
    key: 'candidate_contact',
    name: 'Candidate Contact / Cold Sourcing Call',
    description: 'First outreach: pitch the role, gauge interest, availability, salary expectations, and notice period.',
    requiredFields: ['contactOutcome'],
    completionRules: { aiAssist: true },
  },
  {
    stepNumber: 6,
    phase: 'Intake and sourcing',
    key: 'candidate_profile',
    name: 'Candidate Profile',
    description: 'Build the full candidate profile: CV, motivations, criteria match, and summary for presentation.',
    requiredFields: ['profileSummary'],
    completionRules: {},
  },
  // ── Phase 2 — Introduction and initial selection ──
  {
    stepNumber: 7,
    phase: 'Introduction and initial selection',
    key: 'candidate_presentation',
    name: 'Candidate Presentation to Employer',
    description: 'Present the candidate to the client with a tailored summary addressing their must-haves.',
    requiredFields: ['presentedAt'],
    completionRules: {},
  },
  {
    stepNumber: 8,
    phase: 'Introduction and initial selection',
    key: 'first_interview_setup',
    name: 'First Interview Setup',
    description: 'Arrange logistics: date, time, format, attendees, location/video link for the first interview.',
    requiredFields: ['interviewDate'],
    completionRules: {},
  },
  {
    stepNumber: 9,
    phase: 'Introduction and initial selection',
    key: 'first_interview_candidate_prep',
    name: 'First Interview Candidate Prep',
    description: 'Brief the candidate: company background, interviewer profiles, likely questions, and prep call completed.',
    requiredFields: ['prepCompleted'],
    completionRules: {},
  },
  {
    stepNumber: 10,
    phase: 'Introduction and initial selection',
    key: 'employer_interview_prep',
    name: 'Employer Interview Prep',
    description: 'Brief the employer: candidate motivations, salary expectations, areas to probe, and selling points.',
    requiredFields: ['prepCompleted'],
    completionRules: {},
  },
  {
    stepNumber: 11,
    phase: 'Introduction and initial selection',
    key: 'candidate_debrief',
    name: 'Candidate Debrief',
    description: 'Post-interview debrief with the candidate: interest level, concerns, competing processes, and next-step expectations.',
    requiredFields: ['debriefNotes'],
    completionRules: { aiAssist: true },
  },
  {
    stepNumber: 12,
    phase: 'Introduction and initial selection',
    key: 'employer_debrief',
    name: 'Employer Debrief',
    description: 'Post-interview debrief with the employer: feedback, concerns, and decision on progressing to second stage.',
    requiredFields: ['employerFeedback'],
    completionRules: {},
  },
  // ── Phase 3 — Deep evaluation ──
  {
    stepNumber: 13,
    phase: 'Deep evaluation',
    key: 'second_interview_setup',
    name: 'Second Interview Setup',
    description: 'Arrange second-round logistics: date, time, format, attendees, and any assessments or presentations required.',
    requiredFields: ['interviewDate'],
    completionRules: {},
  },
  {
    stepNumber: 14,
    phase: 'Deep evaluation',
    key: 'reference_check',
    name: 'Reference Check',
    description: 'Take structured references covering performance, reasons for leaving, rehire eligibility, and any concerns.',
    requiredFields: ['referenceNotes'],
    completionRules: {},
  },
  {
    stepNumber: 15,
    phase: 'Deep evaluation',
    key: 'second_interview_candidate_prep',
    name: 'Second Interview Candidate Prep / Trial Close',
    description: 'Deep prep for final stage plus a trial close on offer expectations, start date, and remaining doubts.',
    requiredFields: ['prepCompleted'],
    completionRules: {},
  },
  {
    stepNumber: 16,
    phase: 'Deep evaluation',
    key: 'second_interview_employer_prep',
    name: 'Second Interview Employer Prep / Trial Close',
    description: 'Align the employer on offer parameters and trial-close them on intent to hire and offer range.',
    requiredFields: ['prepCompleted'],
    completionRules: {},
  },
  {
    stepNumber: 17,
    phase: 'Deep evaluation',
    key: 'confirm_second_interview',
    name: 'Confirm Second Interview',
    description: 'Confirm both parties are locked in: calendar holds, travel/logistics, and prep materials delivered.',
    requiredFields: ['confirmedAt'],
    completionRules: {},
  },
  {
    stepNumber: 18,
    phase: 'Deep evaluation',
    key: 'candidate_debrief_closing',
    name: 'Candidate Debrief / Closing',
    description: 'Post-final interview: true interest level, other offers in play, and closing conversation on terms.',
    requiredFields: ['debriefNotes'],
    completionRules: {},
  },
  {
    stepNumber: 19,
    phase: 'Deep evaluation',
    key: 'employer_debrief_hiring_intent',
    name: 'Employer Debrief / Hiring Intent',
    description: 'Get the employer\'s decision: hire / no-hire, preferred terms, and timeline for the offer.',
    requiredFields: ['hiringDecision'],
    completionRules: {},
  },
  // ── Phase 4 — Offer and onboarding ──
  {
    stepNumber: 20,
    phase: 'Offer and onboarding',
    key: 'closing_negotiating',
    name: 'Closing / Negotiating',
    description: 'Manage both sides through negotiation: base, bonus, benefits, start date — reaching verbal agreement.',
    requiredFields: ['agreedTerms'],
    completionRules: { aiAssist: true },
  },
  {
    stepNumber: 21,
    phase: 'Offer and onboarding',
    key: 'offer_acceptance_start_date',
    name: 'Offer / Acceptance / Start Date',
    description: 'Formal offer issued, accepted in writing, and start date confirmed by both parties.',
    requiredFields: ['offerAcceptedAt', 'startDate'],
    completionRules: {},
  },
  {
    stepNumber: 22,
    phase: 'Offer and onboarding',
    key: 'resignation_prep',
    name: 'Resignation Prep',
    description: 'Coach the candidate through resignation: script, expected reactions, and staying firm.',
    requiredFields: ['resignationDate'],
    completionRules: {},
  },
  {
    stepNumber: 23,
    phase: 'Offer and onboarding',
    key: 'counter_offer_prep',
    name: 'Counter-Offer Prep',
    description: 'Prepare the candidate for a counter-offer: rehearsed responses and reminders of their original motivations.',
    requiredFields: ['prepCompleted'],
    completionRules: {},
  },
  {
    stepNumber: 24,
    phase: 'Offer and onboarding',
    key: 'relocation_prep',
    name: 'Relocation Prep (if applicable)',
    description: 'If relocation is involved: logistics, timelines, and support agreed between candidate and client.',
    requiredFields: [],
    completionRules: { conditional: true },
  },
  {
    stepNumber: 25,
    phase: 'Offer and onboarding',
    key: 'client_pre_start_follow_up',
    name: 'Client Pre-Start Follow-up',
    description: 'Check in with the client pre-start: onboarding plan ready, equipment/accounts arranged, expectations set.',
    requiredFields: ['followUpNotes'],
    completionRules: {},
  },
  {
    stepNumber: 26,
    phase: 'Offer and onboarding',
    key: 'candidate_pre_start_follow_up',
    name: 'Candidate Pre-Start Follow-up',
    description: 'Check in with the candidate pre-start: resignation went smoothly, no counter-offer risk, still committed.',
    requiredFields: ['followUpNotes'],
    completionRules: {},
  },
  // ── Phase 5 — Administration and retention ──
  {
    stepNumber: 27,
    phase: 'Administration and retention',
    key: 'start_date_confirmation',
    name: 'Start-Date Confirmation',
    description: 'Confirm the candidate actually started on the agreed date.',
    requiredFields: ['startedOnDate'],
    completionRules: {},
  },
  {
    stepNumber: 28,
    phase: 'Administration and retention',
    key: 'invoicing_billing',
    name: 'Invoicing / Billing',
    description: 'Raise the placement invoice per the fee agreement with correct terms and backup documentation.',
    requiredFields: ['invoiceIssuedAt'],
    completionRules: {},
  },
  {
    stepNumber: 29,
    phase: 'Administration and retention',
    key: 'day_one_follow_up',
    name: 'Day-One Post-Placement Follow-up',
    description: 'Day-one call with the placed candidate: settled in well, any first-day issues flagged and handled.',
    requiredFields: ['followUpNotes'],
    completionRules: {},
  },
  {
    stepNumber: 30,
    phase: 'Administration and retention',
    key: 'collection_payment_secured',
    name: 'Collection / Payment Secured',
    description: 'Fee collected in full: payment received, reconciliation done, placement closed.',
    requiredFields: ['paymentReceivedAt'],
    completionRules: {},
  },
]
