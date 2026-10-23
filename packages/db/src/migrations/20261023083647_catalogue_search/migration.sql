CREATE TABLE "catalogue_alias" (
	"id" text PRIMARY KEY,
	"applicability_id" text NOT NULL,
	"kind" text NOT NULL,
	"normalized_name" text NOT NULL,
	CONSTRAINT "catalogue_alias_kind" CHECK ("kind" in ('brand', 'model', 'generation', 'alias'))
);
--> statement-breakpoint
CREATE TABLE "catalogue_applicability" (
	"id" text PRIMARY KEY,
	"market_variant_id" text NOT NULL,
	"model_year_id" text NOT NULL,
	"sales_market_id" text NOT NULL,
	"source_policy_id" text NOT NULL,
	"publication_status" text NOT NULL,
	"synthetic" boolean NOT NULL,
	CONSTRAINT "catalogue_applicability_publication" CHECK ("publication_status" in ('published', 'fixture', 'withheld')),
	CONSTRAINT "catalogue_applicability_fixture_is_synthetic" CHECK (("publication_status" = 'fixture' and "synthetic" = true) or ("publication_status" = 'published' and "synthetic" = false) or "publication_status" = 'withheld')
);
--> statement-breakpoint
CREATE TABLE "catalogue_brand" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE "catalogue_generation" (
	"id" text PRIMARY KEY,
	"model_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalogue_market_variant" (
	"id" text PRIMARY KEY,
	"generation_id" text NOT NULL,
	"sales_market_id" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalogue_model" (
	"id" text PRIMARY KEY,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE "catalogue_model_year" (
	"id" text PRIMARY KEY,
	"label" text NOT NULL,
	"convention" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalogue_price_reference" (
	"id" text PRIMARY KEY,
	"applicability_id" text NOT NULL,
	"source_policy_id" text NOT NULL,
	"sales_market_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"minor_unit_exponent" integer NOT NULL,
	"basis" text NOT NULL,
	"tax_inclusivity" text NOT NULL,
	"observed_on" text NOT NULL,
	"review_status" text NOT NULL,
	"publication_status" text NOT NULL,
	CONSTRAINT "catalogue_price_reference_kind" CHECK ("tax_inclusivity" in ('unspecified', 'tax-inclusive', 'tax-exclusive')),
	CONSTRAINT "catalogue_price_reference_review" CHECK ("review_status" in ('reviewed', 'unreviewed')),
	CONSTRAINT "catalogue_price_reference_publication" CHECK ("publication_status" in ('published', 'fixture', 'withheld')),
	CONSTRAINT "catalogue_price_reference_exponent" CHECK ("minor_unit_exponent" >= 0 and "minor_unit_exponent" <= 6),
	CONSTRAINT "catalogue_price_reference_safe_integer" CHECK ("amount_minor" between -9007199254740991 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "catalogue_sales_market" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"country_code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalogue_source_policy" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"audience" text NOT NULL,
	"permits_public_catalogue" boolean NOT NULL,
	"rights_review" text NOT NULL,
	"attribution" text NOT NULL,
	"internal_note" text NOT NULL,
	CONSTRAINT "catalogue_source_policy_audience" CHECK ("audience" in ('public', 'private-preview')),
	CONSTRAINT "catalogue_source_policy_rights_review" CHECK ("rights_review" in ('reviewed', 'unreviewed')),
	CONSTRAINT "catalogue_source_policy_public_is_not_preview" CHECK (("permits_public_catalogue" = true and "audience" = 'public') or ("permits_public_catalogue" = false and "audience" = 'private-preview'))
);
--> statement-breakpoint
CREATE TABLE "catalogue_sourced_fact" (
	"id" text PRIMARY KEY,
	"applicability_id" text NOT NULL,
	"source_policy_id" text NOT NULL,
	"property" text NOT NULL,
	"state" text NOT NULL,
	"raw_value" text,
	"normalized_value" text,
	"unit" text,
	"measurement_standard" text,
	"source_title" text NOT NULL,
	"source_url" text,
	"observed_on" text,
	"retrieved_on" text NOT NULL,
	"reviewed_on" text,
	"review_status" text NOT NULL,
	"publication_status" text NOT NULL,
	"curated" boolean NOT NULL,
	"curated_reason" text,
	"unknown_reason" text,
	"conflicts_with_fact_id" text,
	"sort_order" integer NOT NULL,
	CONSTRAINT "catalogue_sourced_fact_state" CHECK ("state" in ('known', 'unknown')),
	CONSTRAINT "catalogue_sourced_fact_review" CHECK ("review_status" in ('reviewed', 'unreviewed')),
	CONSTRAINT "catalogue_sourced_fact_publication" CHECK ("publication_status" in ('published', 'fixture', 'withheld')),
	CONSTRAINT "catalogue_sourced_fact_unknown_has_no_value" CHECK (("state" = 'unknown' and "raw_value" is null and "normalized_value" is null) or ("state" = 'known' and "raw_value" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_alias_identity_idx" ON "catalogue_alias" ("applicability_id","kind","normalized_name");--> statement-breakpoint
CREATE INDEX "catalogue_alias_name_idx" ON "catalogue_alias" ("normalized_name" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "catalogue_applicability_variant_idx" ON "catalogue_applicability" ("market_variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_generation_model_slug_idx" ON "catalogue_generation" ("model_id","slug");--> statement-breakpoint
CREATE INDEX "catalogue_generation_slug_idx" ON "catalogue_generation" ("slug");--> statement-breakpoint
CREATE INDEX "catalogue_market_variant_generation_idx" ON "catalogue_market_variant" ("generation_id");--> statement-breakpoint
CREATE INDEX "catalogue_model_brand_idx" ON "catalogue_model" ("brand_id");--> statement-breakpoint
CREATE INDEX "catalogue_price_reference_applicability_idx" ON "catalogue_price_reference" ("applicability_id");--> statement-breakpoint
CREATE INDEX "catalogue_sourced_fact_applicability_idx" ON "catalogue_sourced_fact" ("applicability_id");--> statement-breakpoint
ALTER TABLE "catalogue_alias" ADD CONSTRAINT "catalogue_alias_67qTjsGmFsAI_fkey" FOREIGN KEY ("applicability_id") REFERENCES "catalogue_applicability"("id");--> statement-breakpoint
ALTER TABLE "catalogue_applicability" ADD CONSTRAINT "catalogue_applicability_t8ue74PiRpq3_fkey" FOREIGN KEY ("market_variant_id") REFERENCES "catalogue_market_variant"("id");--> statement-breakpoint
ALTER TABLE "catalogue_applicability" ADD CONSTRAINT "catalogue_applicability_YDsieEZGf1JP_fkey" FOREIGN KEY ("model_year_id") REFERENCES "catalogue_model_year"("id");--> statement-breakpoint
ALTER TABLE "catalogue_applicability" ADD CONSTRAINT "catalogue_applicability_Tp0DzTHdxdxn_fkey" FOREIGN KEY ("sales_market_id") REFERENCES "catalogue_sales_market"("id");--> statement-breakpoint
ALTER TABLE "catalogue_applicability" ADD CONSTRAINT "catalogue_applicability_9eNTNCrMZ9vh_fkey" FOREIGN KEY ("source_policy_id") REFERENCES "catalogue_source_policy"("id");--> statement-breakpoint
ALTER TABLE "catalogue_generation" ADD CONSTRAINT "catalogue_generation_model_id_catalogue_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "catalogue_model"("id");--> statement-breakpoint
ALTER TABLE "catalogue_market_variant" ADD CONSTRAINT "catalogue_market_variant_cZ3pSQaAjwQ4_fkey" FOREIGN KEY ("generation_id") REFERENCES "catalogue_generation"("id");--> statement-breakpoint
ALTER TABLE "catalogue_market_variant" ADD CONSTRAINT "catalogue_market_variant_5xXhAcP4KtQ6_fkey" FOREIGN KEY ("sales_market_id") REFERENCES "catalogue_sales_market"("id");--> statement-breakpoint
ALTER TABLE "catalogue_model" ADD CONSTRAINT "catalogue_model_brand_id_catalogue_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "catalogue_brand"("id");--> statement-breakpoint
ALTER TABLE "catalogue_price_reference" ADD CONSTRAINT "catalogue_price_reference_spBvabsqDjyT_fkey" FOREIGN KEY ("applicability_id") REFERENCES "catalogue_applicability"("id");--> statement-breakpoint
ALTER TABLE "catalogue_price_reference" ADD CONSTRAINT "catalogue_price_reference_2Uq54VqtJHdX_fkey" FOREIGN KEY ("source_policy_id") REFERENCES "catalogue_source_policy"("id");--> statement-breakpoint
ALTER TABLE "catalogue_price_reference" ADD CONSTRAINT "catalogue_price_reference_Bhy9opql6sdN_fkey" FOREIGN KEY ("sales_market_id") REFERENCES "catalogue_sales_market"("id");--> statement-breakpoint
ALTER TABLE "catalogue_sourced_fact" ADD CONSTRAINT "catalogue_sourced_fact_9vyiBFfAWN1m_fkey" FOREIGN KEY ("applicability_id") REFERENCES "catalogue_applicability"("id");--> statement-breakpoint
ALTER TABLE "catalogue_sourced_fact" ADD CONSTRAINT "catalogue_sourced_fact_OhBjIE16QMwe_fkey" FOREIGN KEY ("source_policy_id") REFERENCES "catalogue_source_policy"("id");