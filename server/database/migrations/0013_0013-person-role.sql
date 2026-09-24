CREATE TYPE "public"."person_role_value" AS ENUM('prospect', 'connection', 'client_contact');--> statement-breakpoint
CREATE TABLE "job_client_contact" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_role" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"role" "person_role_value" NOT NULL,
	"client_company_id" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "person_role_company_iff_client_contact" CHECK (("role" = 'client_contact') = ("client_company_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "job_client_contact" ADD CONSTRAINT "job_client_contact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_org_id_unique" ON "job" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "job_client_contact" ADD CONSTRAINT "job_client_contact_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "public"."job"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_client_contact" ADD CONSTRAINT "job_client_contact_candidate_fk" FOREIGN KEY ("organization_id","candidate_id") REFERENCES "public"."candidate"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_role" ADD CONSTRAINT "person_role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_role" ADD CONSTRAINT "person_role_candidate_fk" FOREIGN KEY ("organization_id","candidate_id") REFERENCES "public"."candidate"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_role" ADD CONSTRAINT "person_role_client_company_fk" FOREIGN KEY ("organization_id","client_company_id") REFERENCES "public"."client_company"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_client_contact_organization_id_idx" ON "job_client_contact" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "job_client_contact_job_id_idx" ON "job_client_contact" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_client_contact_job_candidate_idx" ON "job_client_contact" USING btree ("job_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_client_contact_one_primary" ON "job_client_contact" USING btree ("job_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "person_role_organization_id_idx" ON "person_role" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "person_role_candidate_id_idx" ON "person_role" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "person_role_active_idx" ON "person_role" USING btree ("candidate_id") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "person_role_active_unique_company" ON "person_role" USING btree ("candidate_id","role","client_company_id") WHERE ended_at IS NULL AND client_company_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "person_role_active_unique_nocompany" ON "person_role" USING btree ("candidate_id","role") WHERE ended_at IS NULL AND client_company_id IS NULL;--> statement-breakpoint
