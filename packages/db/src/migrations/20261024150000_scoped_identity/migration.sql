ALTER TABLE "publishing_published_assertion" ADD COLUMN "identity_scope" text DEFAULT 'applicability' NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing_published_assertion" ADD CONSTRAINT "publishing_published_assertion_identity_scope" CHECK ("identity_scope" in ('applicability', 'generation', 'model'));--> statement-breakpoint
ALTER TABLE "publishing_published_assertion" ADD COLUMN "rights_geographies" jsonb DEFAULT '[]'::jsonb NOT NULL;
