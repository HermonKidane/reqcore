/**
 * Deterministic date formatting for SSR + client.
 *
 * `new Date(x).toLocaleDateString()` with no locale takes the locale of whoever renders it: the Docker
 * container (en-US, "10/13/2026") on the server and the browser (en-GB, "13/10/2026") on the client, so
 * every date caused a hydration mismatch (Manatal Gap Check 1.0, 2026-10-14). Pinning locale and
 * timezone makes both sides produce the same string, with no <ClientOnly> and no layout shift.
 */
const FORMATS = {
  /** 13/10/2026 */
  short: new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/London' }),
  /** 13 Oct 2026 */
  medium: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }),
}

export function formatDate(value: string | number | Date | null | undefined, style: keyof typeof FORMATS = 'short'): string {
  if (value === null || value === undefined || value === '') return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return FORMATS[style].format(date)
}
