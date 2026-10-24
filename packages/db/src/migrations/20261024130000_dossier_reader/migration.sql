ALTER TABLE "catalogue_source_policy" ADD COLUMN "permits_images" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "catalogue_model" ADD COLUMN "rebadge_of_model_id" text;--> statement-breakpoint
ALTER TABLE "catalogue_model" ADD CONSTRAINT "catalogue_model_rebadge_fk" FOREIGN KEY ("rebadge_of_model_id") REFERENCES "catalogue_model"("id");--> statement-breakpoint
ALTER TABLE "catalogue_model" ADD CONSTRAINT "catalogue_model_rebadge_not_self" CHECK ("rebadge_of_model_id" is null or "rebadge_of_model_id" <> "id");--> statement-breakpoint
ALTER TABLE "catalogue_generation" ADD COLUMN "publication_status" text;--> statement-breakpoint
ALTER TABLE "catalogue_generation" ADD COLUMN "synthetic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "catalogue_generation" ADD COLUMN "source_policy_id" text;--> statement-breakpoint
ALTER TABLE "catalogue_generation" ADD CONSTRAINT "catalogue_generation_publication" CHECK ("publication_status" is null or "publication_status" in ('published', 'fixture', 'withheld'));--> statement-breakpoint
ALTER TABLE "catalogue_generation" ADD CONSTRAINT "catalogue_generation_fixture_is_synthetic" CHECK ("publication_status" is null or ("publication_status" = 'fixture' and "synthetic" = true) or ("publication_status" = 'published' and "synthetic" = false) or "publication_status" = 'withheld');--> statement-breakpoint
ALTER TABLE "catalogue_generation" ADD CONSTRAINT "catalogue_generation_policy" CHECK ("publication_status" is null or "publication_status" = 'withheld' or "source_policy_id" is not null);--> statement-breakpoint
ALTER TABLE "catalogue_generation" ADD CONSTRAINT "catalogue_generation_source_policy_fk" FOREIGN KEY ("source_policy_id") REFERENCES "catalogue_source_policy"("id");--> statement-breakpoint
ALTER TABLE "catalogue_sourced_fact" ADD COLUMN "freshness" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "catalogue_sourced_fact" DROP CONSTRAINT "catalogue_sourced_fact_state";--> statement-breakpoint
ALTER TABLE "catalogue_sourced_fact" ADD CONSTRAINT "catalogue_sourced_fact_state" CHECK ("state" in ('known', 'unknown', 'not-applicable', 'withheld'));--> statement-breakpoint
ALTER TABLE "catalogue_sourced_fact" DROP CONSTRAINT "catalogue_sourced_fact_unknown_has_no_value";--> statement-breakpoint
ALTER TABLE "catalogue_sourced_fact" ADD CONSTRAINT "catalogue_sourced_fact_value_matches_state" CHECK (("state" = 'known' and "raw_value" is not null) or ("state" in ('unknown', 'not-applicable', 'withheld') and "raw_value" is null and "normalized_value" is null));--> statement-breakpoint
ALTER TABLE "catalogue_sourced_fact" ADD CONSTRAINT "catalogue_sourced_fact_freshness" CHECK ("freshness" in ('current', 'stale', 'not-checked'));--> statement-breakpoint
CREATE TABLE "catalogue_production_claim" (
	"id" text PRIMARY KEY,
	"applicability_id" text NOT NULL,
	"source_policy_id" text NOT NULL,
	"scope" text NOT NULL,
	"geography" text NOT NULL,
	"period" text NOT NULL,
	"count" integer NOT NULL,
	"status" text NOT NULL,
	"counted" text NOT NULL,
	"source_title" text NOT NULL,
	"source_url" text,
	"observed_on" text,
	"retrieved_on" text NOT NULL,
	"reviewed_on" text,
	"review_status" text NOT NULL,
	"publication_status" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "catalogue_production_claim_status" CHECK ("status" in ('planned', 'completed')),
	CONSTRAINT "catalogue_production_claim_count" CHECK ("count" >= 0),
	CONSTRAINT "catalogue_production_claim_counted" CHECK (lower("counted") !~ '(sale|registration|export)'),
	CONSTRAINT "catalogue_production_claim_review" CHECK ("review_status" in ('reviewed', 'unreviewed')),
	CONSTRAINT "catalogue_production_claim_publication" CHECK ("publication_status" in ('published', 'fixture', 'withheld')),
	CONSTRAINT "catalogue_production_claim_scope" CHECK (length(btrim("scope")) > 0 and length(btrim("geography")) > 0 and length(btrim("period")) > 0 and length(btrim("counted")) > 0 and length(btrim("source_title")) > 0 and length(btrim("retrieved_on")) > 0)
);--> statement-breakpoint
ALTER TABLE "catalogue_production_claim" ADD CONSTRAINT "catalogue_production_claim_applicability_fk" FOREIGN KEY ("applicability_id") REFERENCES "catalogue_applicability"("id");--> statement-breakpoint
ALTER TABLE "catalogue_production_claim" ADD CONSTRAINT "catalogue_production_claim_policy_fk" FOREIGN KEY ("source_policy_id") REFERENCES "catalogue_source_policy"("id");--> statement-breakpoint
CREATE INDEX "catalogue_production_claim_applicability_idx" ON "catalogue_production_claim" ("applicability_id");--> statement-breakpoint
CREATE TABLE "catalogue_image" (
	"id" text PRIMARY KEY,
	"applicability_id" text,
	"generation_id" text,
	"source_policy_id" text NOT NULL,
	"publication_status" text NOT NULL,
	"credit" text NOT NULL,
	"licence" text NOT NULL,
	"source_url" text,
	"alt_text" text NOT NULL,
	"asset_url" text NOT NULL,
	"review_status" text NOT NULL,
	CONSTRAINT "catalogue_image_parent" CHECK (("applicability_id" is not null and "generation_id" is null) or ("applicability_id" is null and "generation_id" is not null)),
	CONSTRAINT "catalogue_image_publication" CHECK ("publication_status" in ('published', 'fixture', 'withheld')),
	CONSTRAINT "catalogue_image_review" CHECK ("review_status" in ('reviewed', 'unreviewed')),
	CONSTRAINT "catalogue_image_text" CHECK (length(btrim("credit")) > 0 and length(btrim("licence")) > 0 and length(btrim("alt_text")) > 0 and length(btrim("asset_url")) > 0)
);--> statement-breakpoint
ALTER TABLE "catalogue_image" ADD CONSTRAINT "catalogue_image_applicability_fk" FOREIGN KEY ("applicability_id") REFERENCES "catalogue_applicability"("id");--> statement-breakpoint
ALTER TABLE "catalogue_image" ADD CONSTRAINT "catalogue_image_generation_fk" FOREIGN KEY ("generation_id") REFERENCES "catalogue_generation"("id");--> statement-breakpoint
ALTER TABLE "catalogue_image" ADD CONSTRAINT "catalogue_image_policy_fk" FOREIGN KEY ("source_policy_id") REFERENCES "catalogue_source_policy"("id");--> statement-breakpoint
CREATE TABLE "catalogue_route_redirect" (
	"id" text PRIMARY KEY,
	"model_slug" text NOT NULL,
	"generation_slug" text NOT NULL,
	"model_id" text NOT NULL,
	"generation_id" text NOT NULL,
	CONSTRAINT "catalogue_route_redirect_slugs" CHECK ("model_slug" ~ '^[a-z0-9-]+$' and "generation_slug" ~ '^[a-z0-9-]+$')
);--> statement-breakpoint
ALTER TABLE "catalogue_route_redirect" ADD CONSTRAINT "catalogue_route_redirect_pair" UNIQUE ("model_slug", "generation_slug");--> statement-breakpoint
ALTER TABLE "catalogue_route_redirect" ADD CONSTRAINT "catalogue_route_redirect_model_fk" FOREIGN KEY ("model_id") REFERENCES "catalogue_model"("id");--> statement-breakpoint
ALTER TABLE "catalogue_route_redirect" ADD CONSTRAINT "catalogue_route_redirect_generation_fk" FOREIGN KEY ("generation_id") REFERENCES "catalogue_generation"("id");--> statement-breakpoint
CREATE TABLE "catalogue_generation_alias" (
	"id" text PRIMARY KEY,
	"generation_id" text NOT NULL,
	"normalized_name" text NOT NULL
);--> statement-breakpoint
ALTER TABLE "catalogue_generation_alias" ADD CONSTRAINT "catalogue_generation_alias_pair" UNIQUE ("generation_id", "normalized_name");--> statement-breakpoint
ALTER TABLE "catalogue_generation_alias" ADD CONSTRAINT "catalogue_generation_alias_generation_fk" FOREIGN KEY ("generation_id") REFERENCES "catalogue_generation"("id");--> statement-breakpoint
CREATE INDEX "catalogue_generation_alias_name_idx" ON "catalogue_generation_alias" ("normalized_name" text_pattern_ops);
