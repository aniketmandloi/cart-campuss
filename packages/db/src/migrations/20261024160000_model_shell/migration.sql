CREATE TABLE "catalogue_model_alias" (
  "id" text PRIMARY KEY,
  "model_id" text NOT NULL REFERENCES "catalogue_model"("id"),
  "normalized_name" text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_model_alias_pair" ON "catalogue_model_alias" ("model_id", "normalized_name");--> statement-breakpoint
CREATE INDEX "catalogue_model_alias_name_idx" ON "catalogue_model_alias" ("normalized_name" text_pattern_ops);
