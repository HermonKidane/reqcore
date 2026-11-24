/**
 * Checks for the two pure helpers behind Add Candidate 2.0 (the repo has no
 * unit-test runner). Run:
 *
 *   npx tsx scripts/check-add-candidate-utils.ts
 *
 * Exits 1 on the first failing run, listing every failed case.
 */
import { normalisePhone } from '../shared/phone'
import { extractContacts, isPlausiblePhone } from '../server/utils/cvContacts'

let passed = 0
const failures: string[] = []

function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++
  }
  else {
    failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
  }
}

// ── normalisePhone ────────────────────────────────────────────────────────
const phoneCases: Array<[input: string, expected: string]> = [
  ['07700 900123', '+44 7700 900123'],
  ['07700900123', '+44 7700900123'],
  ['  07700 900123  ', '+44 7700 900123'],
  ['020 7946 0958', '+44 20 7946 0958'],
  ['(020) 7946 0958', '+44 20 7946 0958'],
  ['0161 496 0000', '+44 161 496 0000'],
  ['0300-123-4567', '+44 300 123 4567'],
  ['07700-900-123', '+44 7700 900 123'],
  ['07700  900   123', '+44 7700 900 123'],
  ['0044 7700 900123', '+44 7700 900123'],
  ['00447700900123', '+44 7700900123'],
  ['+44 (0)7700 900123', '+44 7700 900123'],
  ['+44 (0) 20 7946 0958', '+44 20 7946 0958'],
  ['+447700900123', '+44 7700900123'],
  ['+44 7700 900123', '+44 7700 900123'],
  ['+44 07700 900123', '+44 7700 900123'],
  ['+1 (415) 555-0123', '+1 415 555 0123'],
  ['+33 1 42 68 53 00', '+33 1 42 68 53 00'],
  ['+353-1-234-5678', '+353 1 234 5678'],
  // Not understood → trimmed, unchanged
  ['415 555 0123', '415 555 0123'],
  ['0800 1111', '0800 1111'],
  ['ext. 204', 'ext. 204'],
  ['call after 6pm', 'call after 6pm'],
  ['07700 900123 ext 4', '07700 900123 ext 4'],
  ['12345', '12345'],
  ['', ''],
  ['   ', ''],
]
for (const [input, expected] of phoneCases) check(`normalisePhone(${JSON.stringify(input)})`, normalisePhone(input), expected)
check('normalisePhone: other default country leaves national numbers alone', normalisePhone('07700 900123', 'US'), '07700 900123')
check('normalisePhone: a 50-character input stays within 50', normalisePhone('0' + '7'.repeat(13) + '-'.repeat(35) + '1').length <= 50, true)
check('normalisePhone: over-long input is returned unchanged', normalisePhone('07700 900123' + ' 1'.repeat(30)), '07700 900123' + ' 1'.repeat(30))
check('normalisePhone: null', normalisePhone(null), '')

// ── isPlausiblePhone ──────────────────────────────────────────────────────
const plausible: Array<[input: string, expected: boolean]> = [
  ['07700 900123', true],
  ['+44 7700 900123', true],
  ['(020) 7946 0958', true],
  ['415-555-0123', true],
  ['4155550123', true],
  ['2019 - 2023', false],
  ['2019-2023', false],
  ['2019-03-01', false],
  ['12.03.2019', false],
  ['03 2019 - 05 2021', false],
  ['90210-1234', false],
  ['1234567', false],
  ['123456', false],
  ['1234567890123456', false],
]
for (const [input, expected] of plausible) check(`isPlausiblePhone(${JSON.stringify(input)})`, isPlausiblePhone(input), expected)

// ── extractContacts ───────────────────────────────────────────────────────
const cv = [
  'Jane Doe',
  'Senior Recruiter',
  'London SW1A 1AA · jane.doe@example.com · 07700 900123',
  'linkedin.com/in/jane-doe-12345678',
  '',
  'Experience',
  'Acme Ltd — Senior Recruiter, 2019 - 2023',
  'Globex — Recruiter, 01/2015 - 12/2018',
  'Second email: jd@work.example.org, office (020) 7946 0958',
].join('\n')
const full = extractContacts(cv)
check('cv: first email', full.email, 'jane.doe@example.com')
check('cv: first phone', full.phone, '07700 900123')
check('cv: linkedin url', full.linkedinUrl, 'linkedin.com/in/jane-doe-12345678')
check('cv: no email left in redacted text', /@/.test(full.redactedText), false)
check('cv: both emails redacted', full.redactedText.split('[email]').length - 1, 2)
check('cv: both phones redacted', full.redactedText.split('[phone]').length - 1, 2)
check('cv: date range kept', full.redactedText.includes('2019 - 2023'), true)
check('cv: month/year range kept', full.redactedText.includes('01/2015 - 12/2018'), true)
check('cv: postcode kept', full.redactedText.includes('SW1A 1AA'), true)
check('cv: linkedin url kept for the model', full.redactedText.includes('linkedin.com/in/jane-doe-12345678'), true)
check('cv: name kept', full.redactedText.startsWith('Jane Doe\n'), true)

const contactCases: Array<[name: string, text: string, expected: { email?: string, phone?: string, linkedinUrl?: string }]> = [
  ['date range is not a phone', 'Acme 2019 - 2023 and Globex 2015 - 2019', {}],
  ['compact date range is not a phone', 'Worked 2019-2023 at Acme', {}],
  ['ISO date is not a phone', 'Born 1990-04-12 in Leeds', {}],
  ['dotted date is not a phone', 'Start date 12.03.2019', {}],
  ['month ranges are not phones', 'Mar 2019 - Apr 2021, 03 2019 - 05 2021', {}],
  ['UK postcode is not a phone', '10 Downing Street, London SW1A 2AA', {}],
  ['US ZIP+4 is not a phone', 'San Francisco, CA 94105-1234', {}],
  ['short ZIP is not a phone', 'Beverly Hills 90210', {}],
  ['salary is not a phone', 'Salary 65,000 to 70,000 a year', {}],
  ['long id is not a phone', 'Passport 1234567890123456', {}],
  ['digits inside a word are not a phone', 'Ref AB12345678', {}],
  ['year list is not a phone', 'Awards: 2019 2020 2021', {}],
  ['international phone', 'Tel: +44 20 7946 0958', { phone: '+44 20 7946 0958' }],
  ['bracketed area code', 'Phone (0161) 496 0000.', { phone: '(0161) 496 0000' }],
  ['US phone with dashes', 'Cell 415-555-0123', { phone: '415-555-0123' }],
  ['phone next to a date range', 'M: 07700 900123 | 2019 - 2023', { phone: '07700 900123' }],
  ['0044 prefix', 'Call 0044 7700 900123 any time', { phone: '0044 7700 900123' }],
  ['email with plus and trailing full stop', 'Write to jane+cv@mail.example.co.uk.', { email: 'jane+cv@mail.example.co.uk' }],
  ['digits in an email are not a phone', 'jane07700900123@example.com', { email: 'jane07700900123@example.com' }],
  ['linkedin with protocol and www', 'See https://www.linkedin.com/in/jane-doe/ for more', { linkedinUrl: 'https://www.linkedin.com/in/jane-doe' }],
  ['linkedin country subdomain', 'uk.linkedin.com/in/janedoe', { linkedinUrl: 'uk.linkedin.com/in/janedoe' }],
  ['linkedin company page is ignored', 'linkedin.com/company/acme', {}],
  ['digits in a linkedin slug are not a phone', 'linkedin.com/in/jane-doe-0770090012', { linkedinUrl: 'linkedin.com/in/jane-doe-0770090012' }],
  ['empty text', '', {}],
]
for (const [name, text, expected] of contactCases) {
  const { redactedText: _redacted, ...found } = extractContacts(text)
  check(`extractContacts: ${name}`, found, expected)
}

check('redaction: phone replaced in place', extractContacts('Tel: +44 20 7946 0958 (mobile)').redactedText, 'Tel: [phone] (mobile)')
check('redaction: email replaced in place', extractContacts('Mail a.b@c.io now').redactedText, 'Mail [email] now')
check('redaction: nothing to redact leaves text alone', extractContacts('Acme 2019 - 2023, SW1A 2AA').redactedText, 'Acme 2019 - 2023, SW1A 2AA')
check('redaction: phone does not cross a line break', extractContacts('2019\n2023\n07700 900123').redactedText, '2019\n2023\n[phone]')

if (failures.length) {
  console.error(`FAILED ${failures.length} of ${passed + failures.length} checks:\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`OK — ${passed} checks passed (normalisePhone, isPlausiblePhone, extractContacts)`)
