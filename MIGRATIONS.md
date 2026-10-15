# Database Migration Workflow — reqcore

## Workflow
1. Schema change in feature branch
2. `npm run db:generate` (drizzle-kit, outputs to drizzle/)
3. Review generated SQL (enums, FKs, indexes, NOT NULL)
4. Apply to sandbox first: `docker exec reqcore_sandbox_app npm run db:migrate`
5. Smoke-test sandbox.ats.myrecruiter.uk (demo@reqcore.com / demo1234)
6. Pre-deploy backup → apply to live
7. Never use `db:push` in prod. Never copy donor migration SQL (history ends at 0009).

## Expand-Only Contract
- Additive only: new tables, nullable columns, columns with DEFAULT
- Never DROP, rename, or add NOT NULL without DEFAULT
- Destructive = two-phase: add new → migrate data → drop later

## Sandbox Restore
```bash
gunzip -c ~/backups/reqcore/db-<latest>.sql.gz | docker exec -i reqcore_sandbox_db psql -U $DB_USER -d reqcore_sandbox
docker exec reqcore_sandbox_app npm run db:migrate
curl -s http://127.0.0.1:3100 | head -c 200
```

## Rollback
1. `docker compose -f docker-compose.yml -f docker-compose.prod.yml stop app`
2. `gunzip -c ~/backups/reqcore/db-<latest>.sql.gz | docker exec -i reqcore_db psql -U $DB_USER -d $DB_NAME`
3. `docker compose -f docker-compose.yml -f docker-compose.prod.yml start app`
4. Image tagging (image name is `reqcore-app`): before a prod build run `docker tag reqcore-app:latest reqcore-app:rollback-<YYYYMMDD>`; to roll the code back, `docker tag reqcore-app:rollback-<YYYYMMDD> reqcore-app:latest` then `up -d` (no `--build`)

## Key Paths
- Prod: `~/apps/reqcore/` — `docker-compose.yml` + `docker-compose.prod.yml` (loopback port, TRUSTED_PROXY_IP, pinned subnet, public OAuth client IDs; secrets in `.env`). Deploy: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` (run both backup scripts first)
- Sandbox: `~/apps/reqcore-sandbox/` (+ `docker-compose.sandbox.yml`)
- Backups: `~/backups/reqcore/`
- Migrations: `server/database/migrations/` + `drizzle.config.ts` (applied automatically at app boot by `server/plugins/migrations.ts`; `0011` also needs `docker compose … exec -T app npm run db:backfill-emails` once, idempotent)
