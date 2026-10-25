ALTER TABLE "publishing_published_assertion" DROP CONSTRAINT "publishing_published_assertion_identity_scope";--> statement-breakpoint
ALTER TABLE "publishing_published_assertion" ADD CONSTRAINT "publishing_published_assertion_identity_scope" CHECK ("identity_scope" in ('applicability', 'generation', 'model', 'collection'));--> statement-breakpoint
CREATE TABLE "catalogue_collection" (
  "id" text PRIMARY KEY,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "summary" text NOT NULL,
  "source_policy_id" text REFERENCES "catalogue_source_policy"("id"),
  "publication_status" text,
  "synthetic" boolean DEFAULT false NOT NULL,
  CONSTRAINT "catalogue_collection_publication" CHECK ("publication_status" is null or "publication_status" in ('published', 'fixture', 'withheld')),
  CONSTRAINT "catalogue_collection_fixture_is_synthetic" CHECK ("publication_status" is null or ("publication_status" = 'fixture' and "synthetic" = true) or ("publication_status" = 'published' and "synthetic" = false) or "publication_status" = 'withheld'),
  CONSTRAINT "catalogue_collection_policy" CHECK ("publication_status" is null or "publication_status" = 'withheld' or "source_policy_id" is not null)
);--> statement-breakpoint
CREATE TABLE "catalogue_collection_member" (
  "id" text PRIMARY KEY,
  "collection_id" text NOT NULL REFERENCES "catalogue_collection"("id"),
  "model_id" text REFERENCES "catalogue_model"("id"),
  "generation_id" text REFERENCES "catalogue_generation"("id"),
  "sort_order" integer NOT NULL,
  CONSTRAINT "catalogue_collection_member_target" CHECK (("model_id" is not null and "generation_id" is null) or ("model_id" is null and "generation_id" is not null))
);--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_collection_member_order" ON "catalogue_collection_member" ("collection_id", "sort_order");--> statement-breakpoint
CREATE INDEX "catalogue_collection_member_collection_idx" ON "catalogue_collection_member" ("collection_id");
