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
    attribution: text("attribution").notNull(),
    sourcePolicyId: text("source_policy_id")
      .notNull()
      .references(() => publishingSourcePolicy.id),
    factualReviewerRef: text("factual_reviewer_ref").notNull(),
    rightsReviewerRef: text("rights_reviewer_ref").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "string" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }).notNull(),
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
  ],
);

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
