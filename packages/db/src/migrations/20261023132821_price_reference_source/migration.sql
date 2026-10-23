ALTER TABLE "catalogue_price_reference" ADD COLUMN "source_title" text NOT NULL;--> statement-breakpoint
ALTER TABLE "catalogue_price_reference" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "catalogue_price_reference" ADD COLUMN "source_identifier" text;--> statement-breakpoint
ALTER TABLE "catalogue_price_reference" ADD COLUMN "retrieved_on" text NOT NULL;--> statement-breakpoint
ALTER TABLE "catalogue_price_reference" ADD COLUMN "reviewed_on" text;--> statement-breakpoint
ALTER TABLE "catalogue_price_reference" ADD CONSTRAINT "catalogue_price_reference_identified_source" CHECK (length(btrim("source_title")) > 0 and (("source_url" is not null and length(btrim("source_url")) > 0) or ("source_identifier" is not null and length(btrim("source_identifier")) > 0)));--> statement-breakpoint
ALTER TABLE "catalogue_price_reference" ADD CONSTRAINT "catalogue_price_reference_retrieved" CHECK (length(btrim("retrieved_on")) > 0);--> statement-breakpoint
ALTER TABLE "catalogue_price_reference" ADD CONSTRAINT "catalogue_price_reference_review_date" CHECK (("review_status" = 'reviewed' and "reviewed_on" is not null and length(btrim("reviewed_on")) > 0) or "review_status" = 'unreviewed');
