ALTER TABLE "publishing_published_assertion" ADD COLUMN "market_access" jsonb;--> statement-breakpoint
CREATE TABLE "publishing_recheck_target" (
  "id" text PRIMARY KEY,
  "provider_key" text NOT NULL,
  "external_id" text NOT NULL,
  "canonical_subject_id" text NOT NULL,
  "kind" text NOT NULL,
  "target_key" text NOT NULL,
  "observed_at" timestamp with time zone,
  "fetched_at" timestamp with time zone,
  "last_successful_provider_sync_at" timestamp with time zone,
  "last_reviewed_at" timestamp with time zone,
  "next_recheck_at" timestamp with time zone NOT NULL,
  "interval_seconds" integer NOT NULL,
  "freshness" text NOT NULL,
  "provider_outcome" text NOT NULL,
  "lifecycle" text,
  "suppressed" boolean DEFAULT false NOT NULL,
  "public_value" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "publishing_recheck_target_kind" CHECK ("kind" in ('editorial-specification', 'model-price', 'source-directory-url', 'approved-feed')),
  CONSTRAINT "publishing_recheck_target_freshness" CHECK ("freshness" in ('current', 'stale', 'not-checked')),
  CONSTRAINT "publishing_recheck_target_provider_outcome" CHECK ("provider_outcome" in ('succeeded', 'failed', 'not-attempted')),
  CONSTRAINT "publishing_recheck_target_lifecycle" CHECK ("lifecycle" is null or "lifecycle" in ('active', 'ended', 'unknown')),
  CONSTRAINT "publishing_recheck_target_interval" CHECK ("interval_seconds" > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "publishing_recheck_target_identity" ON "publishing_recheck_target" ("provider_key", "external_id", "kind", "target_key");--> statement-breakpoint
CREATE INDEX "publishing_recheck_target_source_idx" ON "publishing_recheck_target" ("provider_key", "external_id");--> statement-breakpoint
CREATE TABLE "publishing_audit_event" (
  "id" text PRIMARY KEY,
  "occurred_at" timestamp with time zone NOT NULL,
  "kind" text NOT NULL,
  "canonical_subject_id" text,
  "provider_key" text,
  "external_id" text,
  "target_kind" text,
  "target_key" text,
  "summary" text NOT NULL,
  CONSTRAINT "publishing_audit_event_kind" CHECK ("kind" in ('recheck-missed', 'recheck-succeeded', 'provider-failure', 'recheck-not-attempted', 'withdrawal', 'expiry', 'suspension')),
  CONSTRAINT "publishing_audit_event_summary" CHECK (length(btrim("summary")) > 0)
);--> statement-breakpoint
CREATE INDEX "publishing_audit_event_subject_idx" ON "publishing_audit_event" ("canonical_subject_id");
