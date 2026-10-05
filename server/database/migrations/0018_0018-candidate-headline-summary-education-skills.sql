CREATE TABLE "candidate_education" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"school" text NOT NULL,
	"degree" text,
	"field_of_study" text,
	"start_text" text,
	"end_text" text,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_skill" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_skill_normalized_nonempty" CHECK (normalized_name <> '')
);
--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "candidate" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "candidate_education" ADD CONSTRAINT "candidate_education_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_education" ADD CONSTRAINT "candidate_education_candidate_fk" FOREIGN KEY ("organization_id","candidate_id") REFERENCES "public"."candidate"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_skill" ADD CONSTRAINT "candidate_skill_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_skill" ADD CONSTRAINT "candidate_skill_candidate_fk" FOREIGN KEY ("organization_id","candidate_id") REFERENCES "public"."candidate"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_education_organization_id_idx" ON "candidate_education" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "candidate_education_candidate_sort_idx" ON "candidate_education" USING btree ("candidate_id","sort_order");--> statement-breakpoint
CREATE INDEX "candidate_skill_organization_id_idx" ON "candidate_skill" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_skill_candidate_normalized_idx" ON "candidate_skill" USING btree ("candidate_id","normalized_name");