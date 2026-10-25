CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;--> statement-breakpoint
CREATE INDEX "catalogue_alias_trgm_idx" ON "catalogue_alias" USING gin ("normalized_name" public.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "catalogue_model_alias_trgm_idx" ON "catalogue_model_alias" USING gin ("normalized_name" public.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "catalogue_generation_alias_trgm_idx" ON "catalogue_generation_alias" USING gin ("normalized_name" public.gin_trgm_ops);
