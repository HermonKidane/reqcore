CREATE TABLE "client_company" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"website" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_company_normalized_nonempty" CHECK (normalized_name <> '')
);
--> statement-breakpoint
ALTER TABLE "client_company" ADD CONSTRAINT "client_company_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_company_organization_id_idx" ON "client_company" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_company_org_normalized_name_idx" ON "client_company" USING btree ("organization_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "client_company_org_id_unique" ON "client_company" USING btree ("organization_id","id");