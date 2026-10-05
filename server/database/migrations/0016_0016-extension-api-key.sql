CREATE TYPE "public"."extension_capture_matched_by" AS ENUM('email', 'linkedin');--> statement-breakpoint
CREATE TYPE "public"."extension_capture_outcome" AS ENUM('created', 'updated', 'duplicate_skipped');--> statement-breakpoint
CREATE TABLE "extension_api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "extension_api_key_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "extension_capture_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"candidate_id" text,
	"outcome" "extension_capture_outcome" NOT NULL,
	"matched_by" "extension_capture_matched_by",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extension_api_key" ADD CONSTRAINT "extension_api_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_api_key" ADD CONSTRAINT "extension_api_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_capture_event" ADD CONSTRAINT "extension_capture_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_capture_event" ADD CONSTRAINT "extension_capture_event_api_key_id_extension_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."extension_api_key"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extension_api_key_org_user_idx" ON "extension_api_key" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extension_capture_event_api_key_idempotency_idx" ON "extension_capture_event" USING btree ("api_key_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "extension_capture_event_organization_id_idx" ON "extension_capture_event" USING btree ("organization_id");