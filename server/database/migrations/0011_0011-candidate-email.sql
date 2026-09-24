CREATE TABLE "candidate_email" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_detail" jsonb,
	"opt_out_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_email_normalized_nonempty" CHECK (normalized_email <> '')
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"batch_key" text NOT NULL,
	"purpose" text NOT NULL,
	"lawful_basis" text NOT NULL,
	"source_file" text NOT NULL,
	"stats" jsonb,
	"retention_review_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_email" ADD CONSTRAINT "candidate_email_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_org_id_unique" ON "candidate" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "candidate_email" ADD CONSTRAINT "candidate_email_candidate_fk" FOREIGN KEY ("organization_id","candidate_id") REFERENCES "public"."candidate"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_email_organization_id_idx" ON "candidate_email" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "candidate_email_candidate_id_idx" ON "candidate_email" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_email_org_normalized_idx" ON "candidate_email" USING btree ("organization_id","normalized_email");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_email_one_primary" ON "candidate_email" USING btree ("candidate_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "import_batch_organization_id_idx" ON "import_batch" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batch_org_batch_key_idx" ON "import_batch" USING btree ("organization_id","batch_key");--> statement-breakpoint
