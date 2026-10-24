ALTER TABLE "publishing_published_assertion" ADD COLUMN "production_claims" jsonb DEFAULT '[]'::jsonb NOT NULL;
