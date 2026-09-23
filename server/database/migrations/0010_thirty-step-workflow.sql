CREATE TYPE "public"."ai_run_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."recruitment_step_event_type" AS ENUM('created', 'started', 'completed', 'blocked', 'unblocked', 'updated', 'skipped', 'note');--> statement-breakpoint
CREATE TYPE "public"."recruitment_step_status" AS ENUM('pending', 'in_progress', 'blocked', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."recruitment_workflow_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "ai_prompt_template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"step_key" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"system_prompt" text NOT NULL,
	"user_prompt_template" text NOT NULL,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"safety_notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_run" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"step_instance_id" text,
	"prompt_template_id" text NOT NULL,
	"requested_by_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_snapshot" jsonb NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"output" jsonb,
	"status" "ai_run_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"reviewed_by_id" text,
	"reviewed_at" timestamp,
	"review_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "recruitment_process_template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_step_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"step_instance_id" text NOT NULL,
	"actor_id" text,
	"event_type" "recruitment_step_event_type" NOT NULL,
	"payload" jsonb,
	"source" text DEFAULT 'user' NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_step_instance" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"step_template_id" text NOT NULL,
	"assigned_to_id" text,
	"status" "recruitment_step_status" DEFAULT 'pending' NOT NULL,
	"due_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"completion_data" jsonb,
	"risk_level" text,
	"blocked_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_step_template" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"step_number" integer NOT NULL,
	"phase" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completion_rules" jsonb,
	"prompt_template_id" text,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_workflow" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"application_id" text,
	"template_id" text NOT NULL,
	"status" "recruitment_workflow_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ai_prompt_template" ADD CONSTRAINT "ai_prompt_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_step_instance_id_recruitment_step_instance_id_fk" FOREIGN KEY ("step_instance_id") REFERENCES "public"."recruitment_step_instance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_prompt_template_id_ai_prompt_template_id_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "public"."ai_prompt_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_reviewed_by_id_user_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_process_template" ADD CONSTRAINT "recruitment_process_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_step_event" ADD CONSTRAINT "recruitment_step_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_step_event" ADD CONSTRAINT "recruitment_step_event_step_instance_id_recruitment_step_instance_id_fk" FOREIGN KEY ("step_instance_id") REFERENCES "public"."recruitment_step_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_step_event" ADD CONSTRAINT "recruitment_step_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_step_instance" ADD CONSTRAINT "recruitment_step_instance_workflow_id_recruitment_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."recruitment_workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_step_instance" ADD CONSTRAINT "recruitment_step_instance_step_template_id_recruitment_step_template_id_fk" FOREIGN KEY ("step_template_id") REFERENCES "public"."recruitment_step_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_step_instance" ADD CONSTRAINT "recruitment_step_instance_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_step_template" ADD CONSTRAINT "recruitment_step_template_template_id_recruitment_process_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."recruitment_process_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_step_template" ADD CONSTRAINT "recruitment_step_template_prompt_template_id_ai_prompt_template_id_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "public"."ai_prompt_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_workflow" ADD CONSTRAINT "recruitment_workflow_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_workflow" ADD CONSTRAINT "recruitment_workflow_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_workflow" ADD CONSTRAINT "recruitment_workflow_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_workflow" ADD CONSTRAINT "recruitment_workflow_template_id_recruitment_process_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."recruitment_process_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_prompt_template_org_idx" ON "ai_prompt_template" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_prompt_template_step_key_idx" ON "ai_prompt_template" USING btree ("step_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_template_global_version_idx" ON "ai_prompt_template" USING btree ("step_key","version") WHERE organization_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_template_org_version_idx" ON "ai_prompt_template" USING btree ("organization_id","step_key","version") WHERE organization_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_run_org_idx" ON "ai_run" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_run_org_status_created_idx" ON "ai_run" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ai_run_step_instance_idx" ON "ai_run" USING btree ("step_instance_id");--> statement-breakpoint
CREATE INDEX "ai_run_prompt_template_idx" ON "ai_run" USING btree ("prompt_template_id");--> statement-breakpoint
CREATE INDEX "recruitment_process_template_organization_id_idx" ON "recruitment_process_template" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_process_template_org_default_idx" ON "recruitment_process_template" USING btree ("organization_id") WHERE is_default = true;--> statement-breakpoint
CREATE INDEX "recruitment_step_event_org_idx" ON "recruitment_step_event" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "recruitment_step_event_instance_idx" ON "recruitment_step_event" USING btree ("step_instance_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_step_instance_workflow_step_idx" ON "recruitment_step_instance" USING btree ("workflow_id","step_template_id");--> statement-breakpoint
CREATE INDEX "recruitment_step_instance_status_idx" ON "recruitment_step_instance" USING btree ("status");--> statement-breakpoint
CREATE INDEX "recruitment_step_instance_assigned_to_idx" ON "recruitment_step_instance" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX "recruitment_step_instance_due_at_idx" ON "recruitment_step_instance" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "recruitment_step_template_template_id_idx" ON "recruitment_step_template" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_step_template_template_step_idx" ON "recruitment_step_template" USING btree ("template_id","step_number");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_step_template_template_key_idx" ON "recruitment_step_template" USING btree ("template_id","key");--> statement-breakpoint
CREATE INDEX "recruitment_workflow_organization_id_idx" ON "recruitment_workflow" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "recruitment_workflow_job_id_idx" ON "recruitment_workflow" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "recruitment_workflow_application_id_idx" ON "recruitment_workflow" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "recruitment_workflow_org_status_idx" ON "recruitment_workflow" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_workflow_app_active_idx" ON "recruitment_workflow" USING btree ("organization_id","application_id") WHERE application_id IS NOT NULL AND status = 'active';--> statement-breakpoint