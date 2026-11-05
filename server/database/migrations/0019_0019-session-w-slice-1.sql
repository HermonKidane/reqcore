CREATE TYPE "public"."task_status" AS ENUM('open', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "representation_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"scope" text NOT NULL,
	"client_company_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"role_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"given_at" timestamp NOT NULL,
	"channel" text NOT NULL,
	"evidence_quote" text NOT NULL,
	"recorded_by_id" text,
	"revoked_at" timestamp,
	"revoked_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "representation_consent_scope_check" CHECK (scope IN ('all_clients', 'named_clients', 'role_types'))
);
--> statement-breakpoint
CREATE TABLE "user_integration" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"todo_list_id" text,
	"delta_link" text,
	"last_pull_at" timestamp,
	"last_push_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_integration_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "call_transcript" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"candidate_id" text,
	"job_id" text,
	"application_id" text,
	"step_instance_id" text,
	"source" text DEFAULT 'pasted' NOT NULL,
	"text" text NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"recorded_at" timestamp,
	"duration_seconds" integer,
	"consent_noted" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"due_at" timestamp,
	"all_day" boolean DEFAULT true NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"owner_id" text NOT NULL,
	"candidate_id" text,
	"job_id" text,
	"application_id" text,
	"step_instance_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"ai_run_id" text,
	"completed_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_sync" (
	"task_id" text NOT NULL,
	"provider" text NOT NULL,
	"todo_list_id" text,
	"todo_task_id" text,
	"outlook_event_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"remote_etag" text,
	"last_synced_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_sync_pk" PRIMARY KEY("task_id","provider")
);
--> statement-breakpoint
DROP INDEX "ai_prompt_template_global_version_idx";--> statement-breakpoint
DROP INDEX "ai_prompt_template_org_version_idx";--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "do_not_contact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "do_not_contact_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "do_not_contact_source" text;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "do_not_contact_note" text;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "collected_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "privacy_notice_due_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "privacy_notice_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_prompt_template" ADD COLUMN "purpose" text DEFAULT 'assist' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_run" ADD COLUMN "purpose" text DEFAULT 'assist' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_run" ADD COLUMN "transcript_id" text;--> statement-breakpoint
ALTER TABLE "representation_consent" ADD CONSTRAINT "representation_consent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representation_consent" ADD CONSTRAINT "representation_consent_recorded_by_id_user_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "representation_consent" ADD CONSTRAINT "representation_consent_candidate_fk" FOREIGN KEY ("organization_id","candidate_id") REFERENCES "public"."candidate"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_integration" ADD CONSTRAINT "user_integration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcript" ADD CONSTRAINT "call_transcript_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcript" ADD CONSTRAINT "call_transcript_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcript" ADD CONSTRAINT "call_transcript_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcript" ADD CONSTRAINT "call_transcript_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcript" ADD CONSTRAINT "call_transcript_step_instance_id_recruitment_step_instance_id_fk" FOREIGN KEY ("step_instance_id") REFERENCES "public"."recruitment_step_instance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcript" ADD CONSTRAINT "call_transcript_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_step_instance_id_recruitment_step_instance_id_fk" FOREIGN KEY ("step_instance_id") REFERENCES "public"."recruitment_step_instance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_ai_run_id_ai_run_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_sync" ADD CONSTRAINT "task_sync_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "representation_consent_org_candidate_idx" ON "representation_consent" USING btree ("organization_id","candidate_id");--> statement-breakpoint
CREATE INDEX "call_transcript_org_idx" ON "call_transcript" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "call_transcript_candidate_idx" ON "call_transcript" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "call_transcript_step_instance_idx" ON "call_transcript" USING btree ("step_instance_id");--> statement-breakpoint
CREATE INDEX "task_org_owner_status_due_idx" ON "task" USING btree ("organization_id","owner_id","status","due_at");--> statement-breakpoint
CREATE INDEX "task_candidate_idx" ON "task" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "task_application_idx" ON "task" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "task_job_idx" ON "task" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "task_sync_todo_task_idx" ON "task_sync" USING btree ("todo_task_id");--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_transcript_id_call_transcript_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."call_transcript"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_org_do_not_contact_idx" ON "candidate" USING btree ("organization_id","do_not_contact");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_template_global_version_idx" ON "ai_prompt_template" USING btree ("step_key","purpose","version") WHERE organization_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_template_org_version_idx" ON "ai_prompt_template" USING btree ("organization_id","step_key","purpose","version") WHERE organization_id IS NOT NULL;--> statement-breakpoint
UPDATE "candidate" SET "collected_at" = "created_at" WHERE "collected_at" IS NULL;--> statement-breakpoint
UPDATE "recruitment_step_template" SET "completion_rules" = COALESCE("completion_rules", '{}'::jsonb) || '{"aiAssist": true}'::jsonb WHERE "key" IN ('complete_job_order', 'candidate_profile');
