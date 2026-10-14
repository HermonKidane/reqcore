/**
 * k6 load baseline — the second layer of the two-layer testing rule (Hermon 2026-10-14):
 * every change runs the Playwright gate AND this script against sandbox before it folds into main,
 * and the numbers are compared with e2e/load/BASELINE.md.
 *
 * How it works
 *  - setup(): signs up a throwaway user, creates an org, seeds 60 candidates + 3 jobs through the API.
 *  - Each virtual user (VU) then loops: jobs list → candidates page → candidate search → one job → dashboard HTML.
 *  - Levels 10 / 25 / 50 / 100 VUs run one after the other, 60 s each, each tagged with `level` so the
 *    summary shows p95 per level (same shape as the 2026-10-11 figures).
 *  - Every VU sends its own X-Real-IP, so the per-IP rate limiter (300 reads/min) treats VUs as separate
 *    recruiters. The app only trusts that header when the request arrives from the Docker gateway, which is
 *    what an SSH tunnel to the published port looks like — so run it THROUGH THE TUNNEL, not via nginx.
 *
 * Run (iMac):
 *   ssh -N -L 13100:127.0.0.1:3100 sandbox      (separate terminal, leave it open)
 *   k6 run e2e/load/baseline.js                   (full, ~5 min)
 *   k6 run -e PROFILE=smoke e2e/load/baseline.js  (2 VUs, 20 s — checks auth + seeding only)
 * Env: BASE_URL (default http://127.0.0.1:13100) · ORIGIN (default https://sandbox.ats.myrecruiter.uk,
 * must be one of the app's trusted origins) · PROFILE=smoke|full.
 *
 * The throwaway org (name "k6 <timestamp>") is synthetic data and is left in place; delete it from the
 * sandbox DB when convenient. Never point this at production.
 */
import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:13100'
const ORIGIN = __ENV.ORIGIN || 'https://sandbox.ats.myrecruiter.uk'
const PROFILE = __ENV.PROFILE || 'full'
const SEED_CANDIDATES = 60
const SEED_JOBS = 3
// Test-only password for the throwaway account this script creates (same class as the e2e fixture's).
const PASSWORD = 'K6LoadTest123!'

if (/ats\.myrecruiter\.uk/.test(BASE) && !/sandbox/.test(BASE)) {
  throw new Error('Refusing to load-test production')
}

const LEVELS = PROFILE === 'smoke' ? [2] : [10, 25, 50, 100]
const HOLD = PROFILE === 'smoke' ? '20s' : '60s'
const holdSeconds = parseInt(HOLD, 10)

const scenarios = {}
const thresholds = {
  // Hard rails: no server errors, no rate-limit hits (a 429 means the per-VU IP trick stopped working)
  'http_req_failed': ['rate<0.01'],
  'checks': ['rate>0.99'],
}
LEVELS.forEach((vus, i) => {
  scenarios[`level_${vus}`] = {
    executor: 'constant-vus',
    vus,
    duration: HOLD,
    startTime: `${i * (holdSeconds + 10)}s`, // 10 s gap so levels don't overlap
    gracefulStop: '5s',
    tags: { level: String(vus) },
  }
  // Regression rails = 1.5 × the 2026-10-11 p95 figures (0.15 / 0.4 / 0.8 / 1.8 s). Update with BASELINE.md.
  const rail = { 2: 1000, 10: 225, 25: 600, 50: 1200, 100: 2700 }[vus]
  thresholds[`http_req_duration{level:${vus}}`] = [`p(95)<${rail}`]
})

export const options = { scenarios, thresholds, summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'] }

const jsonHeaders = (cookie, extra = {}) => ({
  headers: { 'Content-Type': 'application/json', 'Origin': ORIGIN, 'Cookie': cookie, ...extra },
})

function cookieFrom(res) {
  // Better Auth sets the session cookie on sign-up; keep every Set-Cookie pair as one Cookie header.
  const jar = res.cookies || {}
  return Object.keys(jar).map((name) => `${name}=${jar[name][0].value}`).join('; ')
}

export function setup() {
  const stamp = Date.now()
  const email = `qa-k6-${stamp}@example.com`

  const signUp = http.post(`${BASE}/api/auth/sign-up/email`, JSON.stringify({
    name: `k6 ${stamp}`, email, password: PASSWORD,
  }), { headers: { 'Content-Type': 'application/json', 'Origin': ORIGIN } })
  if (signUp.status !== 200) throw new Error(`sign-up failed: ${signUp.status} ${signUp.body}`)
  const cookie = cookieFrom(signUp)
  if (!cookie) throw new Error('sign-up returned no session cookie')

  const org = http.post(`${BASE}/api/auth/organization/create`, JSON.stringify({
    name: `k6 ${stamp}`, slug: `k6-${stamp}`,
  }), jsonHeaders(cookie))
  if (org.status !== 200) throw new Error(`org create failed: ${org.status} ${org.body}`)

  const jobIds = []
  for (let i = 0; i < SEED_JOBS; i++) {
    const res = http.post(`${BASE}/api/jobs`, JSON.stringify({
      title: `k6 Job ${i + 1} ${stamp}`, location: 'London', type: 'full_time',
      description: 'Synthetic job for the k6 load baseline.',
    }), jsonHeaders(cookie))
    if (res.status !== 201) throw new Error(`job seed failed: ${res.status} ${res.body}`)
    jobIds.push(res.json('id'))
  }

  const batch = []
  for (let i = 0; i < SEED_CANDIDATES; i++) {
    batch.push(['POST', `${BASE}/api/candidates`, JSON.stringify({
      firstName: 'K6', lastName: `Candidate ${String(i + 1).padStart(3, '0')}`,
      email: `qa-k6-${stamp}-${i + 1}@example.com`, position: 'Recruitment Consultant', location: 'London',
    }), jsonHeaders(cookie)])
  }
  const created = http.batch(batch)
  const ok = created.filter((r) => r.status === 201).length
  if (ok < SEED_CANDIDATES) throw new Error(`candidate seed: only ${ok}/${SEED_CANDIDATES} created (first failure: ${created.find((r) => r.status !== 201)?.body})`)

  return { cookie, jobIds }
}

export default function (data) {
  // One synthetic client IP per VU so the per-IP limiter sees separate users
  const ip = `10.99.${Math.floor(__VU / 256)}.${__VU % 256}`
  const params = jsonHeaders(data.cookie, { 'X-Real-IP': ip, 'X-Forwarded-For': ip })
  const job = data.jobIds[__ITER % data.jobIds.length]

  const r1 = http.get(`${BASE}/api/jobs?limit=20`, Object.assign({ tags: { name: 'GET /api/jobs' } }, params))
  const r2 = http.get(`${BASE}/api/candidates?limit=20`, Object.assign({ tags: { name: 'GET /api/candidates' } }, params))
  const r3 = http.get(`${BASE}/api/candidates?search=candidate%2000&limit=20`, Object.assign({ tags: { name: 'GET /api/candidates?search' } }, params))
  const r4 = http.get(`${BASE}/api/jobs/${job}`, Object.assign({ tags: { name: 'GET /api/jobs/:id' } }, params))
  const r5 = http.get(`${BASE}/dashboard`, Object.assign({ tags: { name: 'GET /dashboard (SSR)' } }, params))

  check(r1, { 'jobs 200': (r) => r.status === 200 })
  check(r2, { 'candidates 200': (r) => r.status === 200 })
  check(r3, { 'search 200': (r) => r.status === 200 })
  check(r4, { 'job 200': (r) => r.status === 200 })
  check(r5, { 'dashboard 200': (r) => r.status === 200 })

  sleep(1)
}
