# k6 load baseline (sandbox)

Second layer of the two-layer testing rule (Hermon 2026-10-14): run `e2e/load/baseline.js` through the SSH tunnel
before anything folds into `main`, and compare with the latest row here. Add a row per run that matters (a new
baseline after a confirmed change, or a regression you want on record). Thresholds in the script = 1.5 × the
current baseline p95 — raise or lower them when you add a row.

Scenario: 60 candidates + 3 jobs in a throwaway org; each virtual user loops jobs list → candidates list →
candidate search → one job → dashboard HTML, 1 s think time, own X-Real-IP per user; 10 / 25 / 50 / 100 users
held 60 s each. Sandbox = one Node process in Docker on VM1, hit directly on port 3100 (nginx + rate limiter
bypassed). Figures are p95 response time per level.

| Date | reqcore commit | 10 users | 25 users | 50 users | 100 users | Errors | Total req/s | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-10-11 | `3447b30` | 0.15 s | 0.4 s | 0.8 s | 1.8 s | 0 | ~115 ceiling | ad-hoc `loadtest.mjs`, not committed |
| 2026-10-14 | `59f8bd6` | 0.10 s | 0.21 s | 0.75 s | 1.58 s | 0 of 20 795 | 75 (with think time) | first committed baseline; k6 v2.3.0 on the iMac |

Reading it: ~25 recruiters hammering the app non-stop still see every page under a quarter of a second; 100
non-stop users ≈ several hundred real recruiters, and the slowest pages reach 1.6 s. One Node process is the
ceiling — scale by adding app containers before tuning code.
