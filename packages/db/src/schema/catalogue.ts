import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const catalogueSourcePolicy = pgTable(
  "catalogue_source_policy",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    audience: text("audience").notNull(),
    permitsPublicCatalogue: boolean("permits_public_catalogue").notNull(),
    rightsReview: text("rights_review").notNull(),
    attribution: text("attribution").notNull(),
    internalNote: text("internal_note").notNull(),
  },
  (table) => [
    check(
      "catalogue_source_policy_audience",
      sql`${table.audience} in ('public', 'private-preview')`,
    ),
    check(
      "catalogue_source_policy_rights_review",
      sql`${table.rightsReview} in ('reviewed', 'unreviewed')`,
    ),
    check(
      "catalogue_source_policy_public_is_not_preview",
      sql`(${table.permitsPublicCatalogue} = true and ${table.audience} = 'public') or (${table.permitsPublicCatalogue} = false and ${table.audience} = 'private-preview')`,
    ),
  ],
);

export const catalogueSalesMarket = pgTable("catalogue_sales_market", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  countryCode: text("country_code").notNull(),
});

export const catalogueBrand = pgTable("catalogue_brand", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const catalogueModel = pgTable(
  "catalogue_model",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => catalogueBrand.id),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
  },
  (table) => [index("catalogue_model_brand_idx").on(table.brandId)],
);

export const catalogueGeneration = pgTable(
  "catalogue_generation",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => catalogueModel.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
  },
  (table) => [
    uniqueIndex("catalogue_generation_model_slug_idx").on(table.modelId, table.slug),
    index("catalogue_generation_slug_idx").on(table.slug),
  ],
);

export const catalogueModelYear = pgTable("catalogue_model_year", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  convention: text("convention").notNull(),
});

export const catalogueMarketVariant = pgTable(
  "catalogue_market_variant",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .references(() => catalogueGeneration.id),
    salesMarketId: text("sales_market_id")
      .notNull()
      .references(() => catalogueSalesMarket.id),
    name: text("name").notNull(),
  },
  (table) => [index("catalogue_market_variant_generation_idx").on(table.generationId)],
);

export const catalogueApplicability = pgTable(
  "catalogue_applicability",
  {
    id: text("id").primaryKey(),
    marketVariantId: text("market_variant_id")
      .notNull()
      .references(() => catalogueMarketVariant.id),
    modelYearId: text("model_year_id")
      .notNull()
      .references(() => catalogueModelYear.id),
    salesMarketId: text("sales_market_id")
      .notNull()
      .references(() => catalogueSalesMarket.id),
    sourcePolicyId: text("source_policy_id")
      .notNull()
      .references(() => catalogueSourcePolicy.id),
    publicationStatus: text("publication_status").notNull(),
    synthetic: boolean("synthetic").notNull(),
  },
  (table) => [
    check(
      "catalogue_applicability_publication",
      sql`${table.publicationStatus} in ('published', 'fixture', 'withheld')`,
    ),
    check(
      "catalogue_applicability_fixture_is_synthetic",
      sql`(${table.publicationStatus} = 'fixture' and ${table.synthetic} = true) or (${table.publicationStatus} = 'published' and ${table.synthetic} = false) or ${table.publicationStatus} = 'withheld'`,
    ),
    index("catalogue_applicability_variant_idx").on(table.marketVariantId),
  ],
);

export const catalogueAlias = pgTable(
  "catalogue_alias",
  {
    id: text("id").primaryKey(),
    applicabilityId: text("applicability_id")
      .notNull()
      .references(() => catalogueApplicability.id),
    kind: text("kind").notNull(),
    normalizedName: text("normalized_name").notNull(),
  },
  (table) => [
    check(
      "catalogue_alias_kind",
      sql`${table.kind} in ('brand', 'model', 'generation', 'alias')`,
    ),
    uniqueIndex("catalogue_alias_identity_idx").on(
      table.applicabilityId,
      table.kind,
      table.normalizedName,
    ),
    index("catalogue_alias_name_idx").on(table.normalizedName.op("text_pattern_ops")),
  ],
);

export const catalogueSourcedFact = pgTable(
  "catalogue_sourced_fact",
  {
    id: text("id").primaryKey(),
    applicabilityId: text("applicability_id")
      .notNull()
      .references(() => catalogueApplicability.id),
    sourcePolicyId: text("source_policy_id")
      .notNull()
      .references(() => catalogueSourcePolicy.id),
    property: text("property").notNull(),
    state: text("state").notNull(),
    rawValue: text("raw_value"),
    normalizedValue: text("normalized_value"),
    unit: text("unit"),
    measurementStandard: text("measurement_standard"),
    sourceTitle: text("source_title").notNull(),
    sourceUrl: text("source_url"),
    observedOn: text("observed_on"),
    retrievedOn: text("retrieved_on").notNull(),
    reviewedOn: text("reviewed_on"),
    reviewStatus: text("review_status").notNull(),
    publicationStatus: text("publication_status").notNull(),
    curated: boolean("curated").notNull(),
    curatedReason: text("curated_reason"),
    unknownReason: text("unknown_reason"),
    conflictsWithFactId: text("conflicts_with_fact_id"),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    check("catalogue_sourced_fact_state", sql`${table.state} in ('known', 'unknown')`),
    check(
      "catalogue_sourced_fact_review",
      sql`${table.reviewStatus} in ('reviewed', 'unreviewed')`,
    ),
    check(
      "catalogue_sourced_fact_publication",
      sql`${table.publicationStatus} in ('published', 'fixture', 'withheld')`,
    ),
    check(
      "catalogue_sourced_fact_unknown_has_no_value",
      sql`(${table.state} = 'unknown' and ${table.rawValue} is null and ${table.normalizedValue} is null) or (${table.state} = 'known' and ${table.rawValue} is not null)`,
    ),
    index("catalogue_sourced_fact_applicability_idx").on(table.applicabilityId),
  ],
);

export const cataloguePriceReference = pgTable(
  "catalogue_price_reference",
  {
    id: text("id").primaryKey(),
    applicabilityId: text("applicability_id")
      .notNull()
      .references(() => catalogueApplicability.id),
    sourcePolicyId: text("source_policy_id")
      .notNull()
      .references(() => catalogueSourcePolicy.id),
    salesMarketId: text("sales_market_id")
      .notNull()
      .references(() => catalogueSalesMarket.id),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    minorUnitExponent: integer("minor_unit_exponent").notNull(),
    basis: text("basis").notNull(),
    taxInclusivity: text("tax_inclusivity").notNull(),
    observedOn: text("observed_on").notNull(),
    reviewStatus: text("review_status").notNull(),
    publicationStatus: text("publication_status").notNull(),
  },
  (table) => [
    check(
      "catalogue_price_reference_kind",
      sql`${table.taxInclusivity} in ('unspecified', 'tax-inclusive', 'tax-exclusive')`,
    ),
    check(
      "catalogue_price_reference_review",
      sql`${table.reviewStatus} in ('reviewed', 'unreviewed')`,
    ),
    check(
      "catalogue_price_reference_publication",
      sql`${table.publicationStatus} in ('published', 'fixture', 'withheld')`,
    ),
    check(
      "catalogue_price_reference_exponent",
      sql`${table.minorUnitExponent} >= 0 and ${table.minorUnitExponent} <= 6`,
    ),
    check(
      "catalogue_price_reference_safe_integer",
      sql`${table.amountMinor} between -9007199254740991 and 9007199254740991`,
    ),
    index("catalogue_price_reference_applicability_idx").on(table.applicabilityId),
  ],
);
