CREATE TABLE "publishing_import_batch" (
	"id" text PRIMARY KEY,
	"idempotency_key" text NOT NULL CONSTRAINT "publishing_import_batch_idempotency" UNIQUE,
	"provider_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "publishing_import_batch_status" CHECK ("status" in ('staged', 'held', 'published'))
);
--> statement-breakpoint
CREATE TABLE "publishing_projection_generation" (
	"id" text PRIMARY KEY,
	"generation" integer NOT NULL CONSTRAINT "publishing_projection_generation_number" UNIQUE,
	"published_at" timestamp with time zone NOT NULL,
	"batch_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publishing_projection_pointer" (
	"id" integer PRIMARY KEY,
	"generation_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "publishing_projection_pointer_singleton" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE "publishing_published_assertion" (
	"id" text PRIMARY KEY,
	"generation_id" text NOT NULL,
	"provider_key" text NOT NULL,
	"external_id" text NOT NULL,
	"canonical_subject_id" text NOT NULL,
	"display_name" text NOT NULL,
	"aliases" jsonb NOT NULL,
	"sales_market" text NOT NULL,
	"model_year_label" text,
	"facts" jsonb NOT NULL,
	"media" jsonb NOT NULL,
	"attribution" text NOT NULL,
	"source_policy_id" text NOT NULL,
	"factual_reviewer_ref" text NOT NULL,
	"rights_reviewer_ref" text NOT NULL,
	"observed_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "publishing_published_provider_external" UNIQUE("generation_id","provider_key","external_id"),
	CONSTRAINT "publishing_published_generation_subject" UNIQUE("generation_id","canonical_subject_id")
);
--> statement-breakpoint
CREATE TABLE "publishing_source_policy" (
	"id" text PRIMARY KEY,
	"provider_key" text NOT NULL,
	"fact_permission" text DEFAULT 'denied' NOT NULL,
	"image_permission" text DEFAULT 'denied' NOT NULL,
	"permitted_fields" jsonb NOT NULL,
	"permitted_geographies" jsonb NOT NULL,
	"attribution" text DEFAULT '' NOT NULL,
	"retention_seconds" integer NOT NULL,
	"derivative_restriction" text NOT NULL,
	"aggregation_restriction" text NOT NULL,
	"refresh_interval_seconds" integer NOT NULL,
	"permission_expires_at" timestamp with time zone,
	"takedown_obligation" text NOT NULL,
	"deletion_obligation" text NOT NULL,
	"contract_text" text,
	"suspended" boolean DEFAULT false NOT NULL,
	"reviewer_ref" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "publishing_source_policy_fact_permission" CHECK ("fact_permission" in ('denied', 'permitted')),
	CONSTRAINT "publishing_source_policy_image_permission" CHECK ("image_permission" in ('denied', 'permitted'))
);
--> statement-breakpoint
CREATE TABLE "publishing_staged_record" (
	"id" text PRIMARY KEY,
	"provider_key" text NOT NULL,
	"external_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"private_payload" jsonb NOT NULL,
	"provenance" text NOT NULL,
	"document" jsonb NOT NULL,
	"identity_outcome" text NOT NULL,
	"identity_subject_id" text,
	"identity_reviewer_ref" text,
	"identity_note" text DEFAULT '' NOT NULL,
	"factual_outcome" text NOT NULL,
	"factual_reviewer_ref" text,
	"rights_outcome" text NOT NULL,
	"rights_reviewer_ref" text,
	"source_policy_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "publishing_staged_provider_external" UNIQUE("provider_key","external_id"),
	CONSTRAINT "publishing_staged_provenance" CHECK ("provenance" in ('manual', 'seed', 'import', 'fixture')),
	CONSTRAINT "publishing_staged_identity" CHECK ("identity_outcome" in ('pending', 'certain', 'uncertain')),
	CONSTRAINT "publishing_staged_factual" CHECK ("factual_outcome" in ('pending', 'passed', 'failed')),
	CONSTRAINT "publishing_staged_rights" CHECK ("rights_outcome" in ('pending', 'passed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "todo" (
	"id" serial PRIMARY KEY,
	"text" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "publishing_published_subject" ON "publishing_published_assertion" ("canonical_subject_id");--> statement-breakpoint
ALTER TABLE "publishing_projection_generation" ADD CONSTRAINT "publishing_projection_generation_NzmK7D1Zoh8C_fkey" FOREIGN KEY ("batch_id") REFERENCES "publishing_import_batch"("id");--> statement-breakpoint
ALTER TABLE "publishing_projection_pointer" ADD CONSTRAINT "publishing_projection_pointer_354IyNVl0bmN_fkey" FOREIGN KEY ("generation_id") REFERENCES "publishing_projection_generation"("id");--> statement-breakpoint
ALTER TABLE "publishing_published_assertion" ADD CONSTRAINT "publishing_published_assertion_CdhNO8AUIp3J_fkey" FOREIGN KEY ("generation_id") REFERENCES "publishing_projection_generation"("id");--> statement-breakpoint
ALTER TABLE "publishing_published_assertion" ADD CONSTRAINT "publishing_published_assertion_O0Xg0F0tDjrt_fkey" FOREIGN KEY ("source_policy_id") REFERENCES "publishing_source_policy"("id");--> statement-breakpoint
ALTER TABLE "publishing_staged_record" ADD CONSTRAINT "publishing_staged_record_834LYj0YyPHa_fkey" FOREIGN KEY ("batch_id") REFERENCES "publishing_import_batch"("id");--> statement-breakpoint
ALTER TABLE "publishing_staged_record" ADD CONSTRAINT "publishing_staged_record_9x2pF8rSQsF4_fkey" FOREIGN KEY ("source_policy_id") REFERENCES "publishing_source_policy"("id");
