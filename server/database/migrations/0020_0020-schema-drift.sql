-- 0020: schema drift repair (idempotent).
-- The LinkedIn candidate fields and the CSV import tables were added to the schema
-- (commit 0b76495 and the import pipeline) with `db:push` on the sandbox and never got
-- a migration file, so any database built only from migrations (prod) lacks them and
-- GET /api/candidates fails with "column candidate.linkedin_url does not exist".
-- Every statement is IF NOT EXISTS / guarded: a no-op where the objects already exist.

DO $$ BEGIN
  CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'mapped', 'processing', 'committed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."import_row_status" AS ENUM('ready', 'duplicate_existing', 'duplicate_in_file', 'error', 'committed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."duplicate_policy" AS ENUM('skip', 'update');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "company" text;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "position" text;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "connected_on" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_linkedin_url_idx" ON "candidate" USING btree ("linkedin_url");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_import" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"job_id" text,
	"original_filename" text NOT NULL,
	"file_size_bytes" integer,
	"columns" text[] NOT NULL,
	"mapping" jsonb,
	"new_properties" jsonb,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"ready_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_in_file_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer,
	"updated_count" integer,
	"skipped_count" integer,
	"applied_count" integer,
	"duplicate_policy" "duplicate_policy",
	"committed_at" timestamp,
	"committed_by_id" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_import_row" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"import_id" text NOT NULL,
	"row_index" integer NOT NULL,
	"raw_data" jsonb NOT NULL,
	"normalized_data" jsonb,
	"status" "import_row_status" DEFAULT 'ready' NOT NULL,
	"error_message" text,
	"candidate_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_import" ADD CONSTRAINT "candidate_import_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_import" ADD CONSTRAINT "candidate_import_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_import" ADD CONSTRAINT "candidate_import_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_import" ADD CONSTRAINT "candidate_import_committed_by_id_user_id_fk" FOREIGN KEY ("committed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_import_row" ADD CONSTRAINT "candidate_import_row_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_import_row" ADD CONSTRAINT "candidate_import_row_import_id_candidate_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."candidate_import"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_import_row" ADD CONSTRAINT "candidate_import_row_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_import_organization_id_idx" ON "candidate_import" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_import_org_status_idx" ON "candidate_import" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_import_org_created_idx" ON "candidate_import" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_import_org_job_idx" ON "candidate_import" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_import_row_import_row_idx" ON "candidate_import_row" USING btree ("import_id","row_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_import_row_import_status_idx" ON "candidate_import_row" USING btree ("import_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_import_row_org_import_idx" ON "candidate_import_row" USING btree ("organization_id","import_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_import_row_candidate_id_idx" ON "candidate_import_row" USING btree ("candidate_id");
