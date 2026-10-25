import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export type PublishingPriceReference = {
  amountMinor: number;
  currency: string;
  minorUnitExponent: number;
  basis: string;
  taxInclusivity: "unspecified" | "tax-inclusive" | "tax-exclusive";
  includedCharges: string[];
  excludedCharges: string[];
  observedOn: string;
  retrievedOn: string;
  reviewedOn: string;
  sourceTitle: string;
  sourceUrl: string | null;
  sourceIdentifier: string | null;
};

/** A production count stored on the approved projection, under its own source policy. */
export type PublishingProductionClaim = {
  scope: string;
  geography: string;
  period: string;
  count: number;
  status: "planned" | "completed";
  counted: string;
  sourceTitle: string;
  sourceUrl: string | null;
  observedAt: string | null;
  retrievedAt: string;
  reviewedOn: string;
  countryCode: string;
  sourcePolicyId: string;
  factualReviewerRef: string;
  rightsReviewerRef: string;
  policyName: string;
  policyAttribution: string;
};

/**
 * Reviewed permission for one source. Fact and image permissions are
 * independent and default to denied. `contract_text` is never part of a
 * visitor response.
 */
export const publishingSourcePolicy = pgTable(
  "publishing_source_policy",
  {
    id: text("id").primaryKey(),
    providerKey: text("provider_key").notNull(),
    factPermission: text("fact_permission").notNull().default("denied"),
    imagePermission: text("image_permission").notNull().default("denied"),
    permittedFields: jsonb("permitted_fields").$type<string[]>().notNull(),
    permittedGeographies: jsonb("permitted_geographies").$type<string[]>().notNull(),
    attribution: text("attribution").notNull().default(""),
    retentionSeconds: integer("retention_seconds").notNull(),
    derivativeRestriction: text("derivative_restriction").notNull(),
    aggregationRestriction: text("aggregation_restriction").notNull(),
    refreshIntervalSeconds: integer("refresh_interval_seconds").notNull(),
    permissionExpiresAt: timestamp("permission_expires_at", { withTimezone: true, mode: "string" }),
    takedownObligation: text("takedown_obligation").notNull(),
    deletionObligation: text("deletion_obligation").notNull(),
    contractText: text("contract_text"),
    suspended: boolean("suspended").notNull().default(false),
    reviewerRef: text("reviewer_ref"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    check(
      "publishing_source_policy_fact_permission",
      sql`${table.factPermission} in ('denied', 'permitted')`,
    ),
    check(
      "publishing_source_policy_image_permission",
      sql`${table.imagePermission} in ('denied', 'permitted')`,
    ),
  ],
);

export const publishingImportBatch = pgTable(
  "publishing_import_batch",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    providerKey: text("provider_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").notNull(),
    result: jsonb("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    unique("publishing_import_batch_idempotency").on(table.idempotencyKey),
    check(
      "publishing_import_batch_status",
      sql`${table.status} in ('staged', 'held', 'published')`,
    ),
  ],
);

export const publishingStagedRecord = pgTable(
  "publishing_staged_record",
  {
    id: text("id").primaryKey(),
    providerKey: text("provider_key").notNull(),
    externalId: text("external_id").notNull(),
    batchId: text("batch_id")
      .notNull()
      .references(() => publishingImportBatch.id),
    contentHash: text("content_hash").notNull(),
    privatePayload: jsonb("private_payload").notNull(),
    provenance: text("provenance").notNull(),
    document: jsonb("document").notNull(),
    identityOutcome: text("identity_outcome").notNull(),
    identitySubjectId: text("identity_subject_id"),
    identityReviewerRef: text("identity_reviewer_ref"),
    identityNote: text("identity_note").notNull().default(""),
    factualOutcome: text("factual_outcome").notNull(),
    factualReviewerRef: text("factual_reviewer_ref"),
    rightsOutcome: text("rights_outcome").notNull(),
    rightsReviewerRef: text("rights_reviewer_ref"),
    sourcePolicyId: text("source_policy_id")
      .notNull()
      .references(() => publishingSourcePolicy.id),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    unique("publishing_staged_provider_external").on(table.providerKey, table.externalId),
    check(
      "publishing_staged_provenance",
      sql`${table.provenance} in ('manual', 'seed', 'import', 'fixture')`,
    ),
    check(
      "publishing_staged_identity",
      sql`${table.identityOutcome} in ('pending', 'certain', 'uncertain')`,
    ),
    check(
      "publishing_staged_factual",
      sql`${table.factualOutcome} in ('pending', 'passed', 'failed')`,
    ),
    check(
      "publishing_staged_rights",
      sql`${table.rightsOutcome} in ('pending', 'passed', 'failed')`,
    ),
  ],
);

export const publishingProjectionGeneration = pgTable(
  "publishing_projection_generation",
  {
    id: text("id").primaryKey(),
    generation: integer("generation").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }).notNull(),
    batchId: text("batch_id")
      .notNull()
      .references(() => publishingImportBatch.id),
  },
  (table) => [unique("publishing_projection_generation_number").on(table.generation)],
);

export const publishingPublishedAssertion = pgTable(
  "publishing_published_assertion",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .references(() => publishingProjectionGeneration.id),
    providerKey: text("provider_key").notNull(),
    externalId: text("external_id").notNull(),
    canonicalSubjectId: text("canonical_subject_id").notNull(),
    displayName: text("display_name").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull(),
    salesMarket: text("sales_market").notNull(),
    modelYearLabel: text("model_year_label"),
    facts: jsonb("facts").notNull(),
    media: jsonb("media").notNull(),
    productionClaims: jsonb("production_claims")
      .$type<PublishingProductionClaim[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    attribution: text("attribution").notNull(),
    sourcePolicyId: text("source_policy_id")
      .notNull()
      .references(() => publishingSourcePolicy.id),
    factualReviewerRef: text("factual_reviewer_ref").notNull(),
    rightsReviewerRef: text("rights_reviewer_ref").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "string" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "string" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }).notNull(),
    priceReference: jsonb("price_reference").$type<PublishingPriceReference | null>(),
    marketAccess: jsonb("market_access").$type<PublishingMarketAccess | null>(),
    identityScope: text("identity_scope").notNull().default("applicability"),
    rightsGeographies: jsonb("rights_geographies").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (table) => [
    unique("publishing_published_provider_external").on(
      table.generationId,
      table.providerKey,
      table.externalId,
    ),
    unique("publishing_published_generation_subject").on(
      table.generationId,
      table.canonicalSubjectId,
    ),
    index("publishing_published_subject").on(table.canonicalSubjectId),
    check(
      "publishing_published_assertion_identity_scope",
      sql`${table.identityScope} in ('applicability', 'generation', 'model', 'collection')`,
    ),
  ],
);

export type PublishingDirectoryEntry = {
  title: string;
  url: string;
  observedAt: string | null;
  retrievedAt: string;
  reviewedAt: string;
};

export type PublishingListingPriceType =
  | "asking"
  | "auction-guide"
  | "current-bid"
  | "assumed-hammer"
  | "hammer"
  | "buyer-premium"
  | "completed-sale"
  | "estimate";

/** A licensed feed card or a reviewed outbound link stored on the approved projection. */
export type PublishingListing = {
  externalId: string;
  title: string;
  url: string;
  lifecycle: "active" | "ended" | "unknown";
  priceType: PublishingListingPriceType;
  amountMinor: number | null;
  currency: string | null;
  minorUnitExponent: number | null;
  observedAt: string;
  retrievedAt: string;
  reviewedAt: string;
};

export type PublishingMarketAccess = {
  sourceDirectory: PublishingDirectoryEntry[];
  listings: PublishingListing[];
};

export type RecheckKind =
  | "editorial-specification"
  | "model-price"
  | "source-directory-url"
  | "approved-feed";

export type RecheckPublicValue = {
  state?: string;
  rawValue?: string | null;
  normalizedValue?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  title?: string;
  url?: string;
  priceType?: string;
};

/** Singleton row. The visitor reads whichever generation this points at. */
export const publishingProjectionPointer = pgTable(
  "publishing_projection_pointer",
  {
    id: integer("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .references(() => publishingProjectionGeneration.id),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [check("publishing_projection_pointer_singleton", sql`${table.id} = 1`)],
);

/**
 * Schedule for one public fact, price, directory URL, or feed card.
 * The public value is the visitor-facing snapshot. It never stores a private payload.
 */
export const publishingRecheckTarget = pgTable(
  "publishing_recheck_target",
  {
    id: text("id").primaryKey(),
    providerKey: text("provider_key").notNull(),
    externalId: text("external_id").notNull(),
    canonicalSubjectId: text("canonical_subject_id").notNull(),
    kind: text("kind").$type<RecheckKind>().notNull(),
    targetKey: text("target_key").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "string" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "string" }),
    lastSuccessfulProviderSyncAt: timestamp("last_successful_provider_sync_at", {
      withTimezone: true,
      mode: "string",
    }),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true, mode: "string" }),
    nextRecheckAt: timestamp("next_recheck_at", { withTimezone: true, mode: "string" }).notNull(),
    intervalSeconds: integer("interval_seconds").notNull(),
    freshness: text("freshness").notNull(),
    providerOutcome: text("provider_outcome").notNull(),
    lifecycle: text("lifecycle"),
    suppressed: boolean("suppressed").notNull().default(false),
    publicValue: jsonb("public_value").$type<RecheckPublicValue>().notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    unique("publishing_recheck_target_identity").on(
      table.providerKey,
      table.externalId,
      table.kind,
      table.targetKey,
    ),
    index("publishing_recheck_target_source_idx").on(table.providerKey, table.externalId),
    check(
      "publishing_recheck_target_kind",
      sql`${table.kind} in ('editorial-specification', 'model-price', 'source-directory-url', 'approved-feed')`,
    ),
    check(
      "publishing_recheck_target_freshness",
      sql`${table.freshness} in ('current', 'stale', 'not-checked')`,
    ),
    check(
      "publishing_recheck_target_provider_outcome",
      sql`${table.providerOutcome} in ('succeeded', 'failed', 'not-attempted')`,
    ),
    check(
      "publishing_recheck_target_lifecycle",
      sql`${table.lifecycle} is null or ${table.lifecycle} in ('active', 'ended', 'unknown')`,
    ),
    check("publishing_recheck_target_interval", sql`${table.intervalSeconds} > 0`),
  ],
);

/** Operator-visible record that a recheck, withdrawal, expiry, or suspension happened. */
export const publishingAuditEvent = pgTable(
  "publishing_audit_event",
  {
    id: text("id").primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    kind: text("kind").notNull(),
    canonicalSubjectId: text("canonical_subject_id"),
    providerKey: text("provider_key"),
    externalId: text("external_id"),
    targetKind: text("target_kind"),
    targetKey: text("target_key"),
    summary: text("summary").notNull(),
  },
  (table) => [
    check(
      "publishing_audit_event_kind",
      sql`${table.kind} in ('recheck-missed', 'recheck-succeeded', 'provider-failure', 'recheck-not-attempted', 'withdrawal', 'expiry', 'suspension')`,
    ),
    check("publishing_audit_event_summary", sql`length(btrim(${table.summary})) > 0`),
    index("publishing_audit_event_subject_idx").on(table.canonicalSubjectId),
  ],
);
