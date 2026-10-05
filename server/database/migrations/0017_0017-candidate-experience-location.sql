CREATE TABLE "candidate_experience" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"title" text NOT NULL,
	"company" text,
	"location" text,
	"start_text" text,
	"end_text" text,
	"is_current" boolean DEFAULT false NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "candidate_experience" ADD CONSTRAINT "candidate_experience_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_experience" ADD CONSTRAINT "candidate_experience_candidate_fk" FOREIGN KEY ("organization_id","candidate_id") REFERENCES "public"."candidate"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_experience_organization_id_idx" ON "candidate_experience" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "candidate_experience_candidate_sort_idx" ON "candidate_experience" USING btree ("candidate_id","sort_order");