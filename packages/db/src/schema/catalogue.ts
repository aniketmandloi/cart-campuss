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
    permitsImages: boolean("permits_images").notNull().default(false),
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
    rebadgeOfModelId: text("rebadge_of_model_id"),
  },
  (table) => [
    index("catalogue_model_brand_idx").on(table.brandId),
    check(
      "catalogue_model_rebadge_not_self",
      sql`${table.rebadgeOfModelId} is null or ${table.rebadgeOfModelId} <> ${table.id}`,
    ),
  ],
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
    publicationStatus: text("publication_status"),
    synthetic: boolean("synthetic").notNull().default(false),
    sourcePolicyId: text("source_policy_id").references(() => catalogueSourcePolicy.id),
  },
  (table) => [
    uniqueIndex("catalogue_generation_model_slug_idx").on(table.modelId, table.slug),
    index("catalogue_generation_slug_idx").on(table.slug),
    check(
      "catalogue_generation_publication",
      sql`${table.publicationStatus} is null or ${table.publicationStatus} in ('published', 'fixture', 'withheld')`,
    ),
    check(
      "catalogue_generation_fixture_is_synthetic",
      sql`${table.publicationStatus} is null or (${table.publicationStatus} = 'fixture' and ${table.synthetic} = true) or (${table.publicationStatus} = 'published' and ${table.synthetic} = false) or ${table.publicationStatus} = 'withheld'`,
    ),
    check(
      "catalogue_generation_policy",
      sql`${table.publicationStatus} is null or ${table.publicationStatus} = 'withheld' or ${table.sourcePolicyId} is not null`,
    ),
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
    freshness: text("freshness").notNull().default("current"),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    check(
      "catalogue_sourced_fact_state",
      sql`${table.state} in ('known', 'unknown', 'not-applicable', 'withheld')`,
    ),
    check(
      "catalogue_sourced_fact_review",
      sql`${table.reviewStatus} in ('reviewed', 'unreviewed')`,
    ),
    check(
      "catalogue_sourced_fact_publication",
      sql`${table.publicationStatus} in ('published', 'fixture', 'withheld')`,
    ),
    check(
      "catalogue_sourced_fact_freshness",
      sql`${table.freshness} in ('current', 'stale', 'not-checked')`,
    ),
    check(
      "catalogue_sourced_fact_value_matches_state",
      sql`(${table.state} = 'known' and ${table.rawValue} is not null) or (${table.state} in ('unknown', 'not-applicable', 'withheld') and ${table.rawValue} is null and ${table.normalizedValue} is null)`,
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
    sourceTitle: text("source_title").notNull(),
    sourceUrl: text("source_url"),
    sourceIdentifier: text("source_identifier"),
    retrievedOn: text("retrieved_on").notNull(),
    reviewedOn: text("reviewed_on"),
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
    check(
      "catalogue_price_reference_identified_source",
      sql`length(btrim(${table.sourceTitle})) > 0 and ((${table.sourceUrl} is not null and length(btrim(${table.sourceUrl})) > 0) or (${table.sourceIdentifier} is not null and length(btrim(${table.sourceIdentifier})) > 0))`,
    ),
    check(
      "catalogue_price_reference_retrieved",
      sql`length(btrim(${table.retrievedOn})) > 0`,
    ),
    check(
      "catalogue_price_reference_review_date",
      sql`(${table.reviewStatus} = 'reviewed' and ${table.reviewedOn} is not null and length(btrim(${table.reviewedOn})) > 0) or ${table.reviewStatus} = 'unreviewed'`,
    ),
    index("catalogue_price_reference_applicability_idx").on(table.applicabilityId),
  ],
);

export const catalogueProductionClaim = pgTable(
  "catalogue_production_claim",
  {
    id: text("id").primaryKey(),
    applicabilityId: text("applicability_id")
      .notNull()
      .references(() => catalogueApplicability.id),
    sourcePolicyId: text("source_policy_id")
      .notNull()
      .references(() => catalogueSourcePolicy.id),
    scope: text("scope").notNull(),
    geography: text("geography").notNull(),
    period: text("period").notNull(),
    count: integer("count").notNull(),
    status: text("status").notNull(),
    counted: text("counted").notNull(),
    sourceTitle: text("source_title").notNull(),
    sourceUrl: text("source_url"),
    observedOn: text("observed_on"),
    retrievedOn: text("retrieved_on").notNull(),
    reviewedOn: text("reviewed_on"),
    reviewStatus: text("review_status").notNull(),
    publicationStatus: text("publication_status").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    check(
      "catalogue_production_claim_status",
      sql`${table.status} in ('planned', 'completed')`,
    ),
    check("catalogue_production_claim_count", sql`${table.count} >= 0`),
    check(
      "catalogue_production_claim_counted",
      sql`lower(${table.counted}) !~ '(sale|registration|export)'`,
    ),
    check(
      "catalogue_production_claim_review",
      sql`${table.reviewStatus} in ('reviewed', 'unreviewed')`,
    ),
    check(
      "catalogue_production_claim_publication",
      sql`${table.publicationStatus} in ('published', 'fixture', 'withheld')`,
    ),
    index("catalogue_production_claim_applicability_idx").on(table.applicabilityId),
  ],
);

export const catalogueImage = pgTable(
  "catalogue_image",
  {
    id: text("id").primaryKey(),
    applicabilityId: text("applicability_id").references(() => catalogueApplicability.id),
    generationId: text("generation_id").references(() => catalogueGeneration.id),
    sourcePolicyId: text("source_policy_id")
      .notNull()
      .references(() => catalogueSourcePolicy.id),
    publicationStatus: text("publication_status").notNull(),
    credit: text("credit").notNull(),
    licence: text("licence").notNull(),
    sourceUrl: text("source_url"),
    altText: text("alt_text").notNull(),
    assetUrl: text("asset_url").notNull(),
    reviewStatus: text("review_status").notNull(),
  },
  (table) => [
    check(
      "catalogue_image_parent",
      sql`(${table.applicabilityId} is not null and ${table.generationId} is null) or (${table.applicabilityId} is null and ${table.generationId} is not null)`,
    ),
    check(
      "catalogue_image_publication",
      sql`${table.publicationStatus} in ('published', 'fixture', 'withheld')`,
    ),
    check(
      "catalogue_image_review",
      sql`${table.reviewStatus} in ('reviewed', 'unreviewed')`,
    ),
  ],
);

export const catalogueRouteRedirect = pgTable(
  "catalogue_route_redirect",
  {
    id: text("id").primaryKey(),
    modelSlug: text("model_slug").notNull(),
    generationSlug: text("generation_slug").notNull(),
    modelId: text("model_id")
      .notNull()
      .references(() => catalogueModel.id),
    generationId: text("generation_id")
      .notNull()
      .references(() => catalogueGeneration.id),
  },
  (table) => [uniqueIndex("catalogue_route_redirect_pair").on(table.modelSlug, table.generationSlug)],
);

export const catalogueGenerationAlias = pgTable(
  "catalogue_generation_alias",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .references(() => catalogueGeneration.id),
    normalizedName: text("normalized_name").notNull(),
  },
  (table) => [
    uniqueIndex("catalogue_generation_alias_pair").on(table.generationId, table.normalizedName),
    index("catalogue_generation_alias_name_idx").on(table.normalizedName.op("text_pattern_ops")),
  ],
);
