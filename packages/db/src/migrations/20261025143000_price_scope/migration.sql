ALTER TABLE "catalogue_price_reference" ADD COLUMN "included_charges" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "catalogue_price_reference" ADD COLUMN "excluded_charges" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "catalogue_price_reference" ADD CONSTRAINT "catalogue_price_reference_charges" CHECK (jsonb_typeof("included_charges") = 'array' and jsonb_typeof("excluded_charges") = 'array');
