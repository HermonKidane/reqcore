/**
 * UK GDPR Art 14 tracker defaults (Session W slice 1, step 4 #5).
 * A person whose data was not collected from them directly must get the
 * privacy notice within a month of collection (or at first contact, if
 * sooner). `collectedAt` + 30 days is the due date until a notice is sent.
 */
export const PRIVACY_NOTICE_DAYS = 30

export function privacyNoticeDueFrom(collectedAt: Date): Date {
  return new Date(collectedAt.getTime() + PRIVACY_NOTICE_DAYS * 24 * 3600 * 1000)
}

export function art14Defaults(now: Date = new Date()): { collectedAt: Date, privacyNoticeDueAt: Date } {
  return { collectedAt: now, privacyNoticeDueAt: privacyNoticeDueFrom(now) }
}
