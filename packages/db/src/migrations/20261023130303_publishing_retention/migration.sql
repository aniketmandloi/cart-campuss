ALTER TABLE "publishing_published_assertion" ADD COLUMN "captured_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "publishing_staged_record" ADD COLUMN "captured_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "publishing_published_assertion" AS assertion
SET "captured_at" = least(
  (SELECT policy."created_at" FROM "publishing_source_policy" AS policy
    WHERE policy."id" = assertion."source_policy_id"),
  (SELECT generation."published_at" FROM "publishing_projection_generation" AS generation
    WHERE generation."id" = assertion."generation_id"),
  (SELECT min((fact->>'retrievedAt')::timestamptz)
    FROM jsonb_array_elements(assertion."facts") AS fact)
);
--> statement-breakpoint
UPDATE "publishing_staged_record" AS record
SET "captured_at" = least(
  (SELECT policy."created_at" FROM "publishing_source_policy" AS policy
    WHERE policy."id" = record."source_policy_id"),
  record."updated_at",
  (SELECT min((fact->>'retrievedAt')::timestamptz)
    FROM jsonb_array_elements(record."document"->'facts') AS fact)
);
--> statement-breakpoint
ALTER TABLE "publishing_published_assertion" ALTER COLUMN "captured_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "publishing_staged_record" ALTER COLUMN "captured_at" SET NOT NULL;
