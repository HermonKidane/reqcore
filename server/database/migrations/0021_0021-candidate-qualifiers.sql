-- 0021: candidate qualifiers (Add Candidate 2.0). Additive, nullable, no defaults.
-- Option lists live in shared/candidate-qualifiers.ts and are checked in the API.
-- Every statement is IF NOT EXISTS: a no-op where the column already exists.

ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "source_channel" text;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "salary_currency" text;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "salary_current" integer;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "salary_expected" integer;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "day_rate" integer;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "notice_period" text;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "right_to_work" text;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "work_preference" text;