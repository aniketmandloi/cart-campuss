import {
  catalogueAlias,
  catalogueApplicability,
  catalogueBrand,
  catalogueGeneration,
  catalogueMarketVariant,
  catalogueModel,
  catalogueModelYear,
  cataloguePriceReference,
  catalogueSalesMarket,
  catalogueSourcePolicy,
  catalogueSourcedFact,
} from "./schema/catalogue";

import type { Database } from "./index";

const policyId = "policy_synthetic_preview";
const salesMarketId = "mkt_fixture_in";
const brandId = "brand_kestrel_fixture";
const modelId = "model_sample_hatch";
const generationId = "gen_series_one";
const modelYearId = "year_2026_model";
const variantId = "var_base";
const applicabilityId = "app_kestrel_in_2026_base";

/**
 * Inserts one labelled synthetic applicability record for private preview and tests.
 * Public reads still exclude it. Replaying the insert does not duplicate rows.
 */
export async function insertSyntheticPreviewFixture(db: Database) {
  await db
    .insert(catalogueSourcePolicy)
    .values({
      id: policyId,
      name: "Synthetic preview policy",
      audience: "private-preview",
      permitsPublicCatalogue: false,
      rightsReview: "reviewed",
      attribution: "Synthetic fixture for private preview. Not a manufacturer publication.",
      internalNote: "provider-secret-do-not-project",
    })
    .onConflictDoNothing();

  await db
    .insert(catalogueSalesMarket)
    .values({ id: salesMarketId, name: "India", countryCode: "IN" })
    .onConflictDoNothing();

  await db
    .insert(catalogueBrand)
    .values({ id: brandId, name: "Kestrel Fixture", slug: "kestrel-fixture" })
    .onConflictDoNothing();

  await db
    .insert(catalogueModel)
    .values({
      id: modelId,
      brandId,
      name: "Sample Hatch",
      slug: "sample-hatch",
    })
    .onConflictDoNothing();

  await db
    .insert(catalogueGeneration)
    .values({
      id: generationId,
      modelId,
      name: "Series One",
      slug: "series-one",
    })
    .onConflictDoNothing();

  await db
    .insert(catalogueModelYear)
    .values({
      id: modelYearId,
      label: "2026",
      convention: "Manufacturer model-year label. Not the calendar build year.",
    })
    .onConflictDoNothing();

  await db
    .insert(catalogueMarketVariant)
    .values({
      id: variantId,
      generationId,
      salesMarketId,
      name: "Base",
    })
    .onConflictDoNothing();

  await db
    .insert(catalogueApplicability)
    .values({
      id: applicabilityId,
      marketVariantId: variantId,
      modelYearId,
      salesMarketId,
      sourcePolicyId: policyId,
      publicationStatus: "fixture",
      synthetic: true,
    })
    .onConflictDoNothing();

  await db
    .insert(catalogueAlias)
    .values([
      {
        id: "alias_brand",
        applicabilityId,
        kind: "brand",
        normalizedName: "kestrel fixture",
      },
      {
        id: "alias_model",
        applicabilityId,
        kind: "model",
        normalizedName: "sample hatch",
      },
      {
        id: "alias_generation",
        applicabilityId,
        kind: "generation",
        normalizedName: "series one",
      },
      {
        id: "alias_lookup",
        applicabilityId,
        kind: "alias",
        normalizedName: "kestrel sample",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(catalogueSourcedFact)
    .values([
      {
        id: "fact_powertrain",
        applicabilityId,
        sourcePolicyId: policyId,
        property: "Powertrain",
        state: "known",
        rawValue: "petrol inline-4 fixture",
        normalizedValue: "fixture-petrol",
        unit: null,
        measurementStandard: "fixture-powertrain",
        sourceTitle: "Synthetic fixture dossier",
        sourceUrl: null,
        observedOn: "2026-10-22",
        retrievedOn: "2026-10-23",
        reviewedOn: "2026-10-23",
        reviewStatus: "reviewed",
        publicationStatus: "fixture",
        curated: true,
        curatedReason: null,
        unknownReason: null,
        conflictsWithFactId: null,
        sortOrder: 1,
      },
      {
        id: "fact_body",
        applicabilityId,
        sourcePolicyId: policyId,
        property: "Body",
        state: "known",
        rawValue: "hatchback",
        normalizedValue: "hatchback",
        unit: null,
        measurementStandard: "fixture-body",
        sourceTitle: "Synthetic fixture dossier",
        sourceUrl: null,
        observedOn: "2026-10-22",
        retrievedOn: "2026-10-23",
        reviewedOn: "2026-10-23",
        reviewStatus: "reviewed",
        publicationStatus: "fixture",
        curated: true,
        curatedReason: null,
        unknownReason: null,
        conflictsWithFactId: null,
        sortOrder: 2,
      },
      {
        id: "fact_power",
        applicabilityId,
        sourcePolicyId: policyId,
        property: "Power",
        state: "unknown",
        rawValue: null,
        normalizedValue: null,
        unit: null,
        measurementStandard: null,
        sourceTitle: "Synthetic fixture dossier",
        sourceUrl: null,
        observedOn: "2026-10-22",
        retrievedOn: "2026-10-23",
        reviewedOn: "2026-10-23",
        reviewStatus: "reviewed",
        publicationStatus: "fixture",
        curated: true,
        curatedReason: null,
        unknownReason: "The synthetic fixture does not include a measured power figure.",
        conflictsWithFactId: null,
        sortOrder: 3,
      },
      {
        id: "fact_torque",
        applicabilityId,
        sourcePolicyId: policyId,
        property: "Torque",
        state: "known",
        rawValue: "100 N·m",
        normalizedValue: "100",
        unit: "N·m",
        measurementStandard: "fixture-torque",
        sourceTitle: "Synthetic fixture dossier",
        sourceUrl: null,
        observedOn: "2026-10-22",
        retrievedOn: "2026-10-23",
        reviewedOn: "2026-10-23",
        reviewStatus: "reviewed",
        publicationStatus: "fixture",
        curated: true,
        curatedReason: "The synthetic fixture keeps 100 N·m as the curated torque.",
        unknownReason: null,
        conflictsWithFactId: null,
        sortOrder: 4,
      },
      {
        id: "fact_torque_conflict",
        applicabilityId,
        sourcePolicyId: policyId,
        property: "Torque",
        state: "known",
        rawValue: "90 N·m",
        normalizedValue: "90",
        unit: "N·m",
        measurementStandard: "fixture-torque",
        sourceTitle: "Synthetic fixture conflict note",
        sourceUrl: null,
        observedOn: "2026-10-22",
        retrievedOn: "2026-10-23",
        reviewedOn: "2026-10-23",
        reviewStatus: "reviewed",
        publicationStatus: "fixture",
        curated: false,
        curatedReason: null,
        unknownReason: null,
        conflictsWithFactId: "fact_torque",
        sortOrder: 5,
      },
      {
        id: "fact_transmission",
        applicabilityId,
        sourcePolicyId: policyId,
        property: "Transmission",
        state: "unknown",
        rawValue: null,
        normalizedValue: null,
        unit: null,
        measurementStandard: null,
        sourceTitle: "Synthetic fixture dossier",
        sourceUrl: null,
        observedOn: "2026-10-22",
        retrievedOn: "2026-10-23",
        reviewedOn: "2026-10-23",
        reviewStatus: "reviewed",
        publicationStatus: "fixture",
        curated: true,
        curatedReason: null,
        unknownReason: "The synthetic fixture does not include a transmission.",
        conflictsWithFactId: null,
        sortOrder: 6,
      },
      {
        id: "fact_hidden_output",
        applicabilityId,
        sourcePolicyId: policyId,
        property: "Hidden output",
        state: "known",
        rawValue: "999 kW",
        normalizedValue: "999",
        unit: "kW",
        measurementStandard: "fixture-hidden",
        sourceTitle: "Synthetic fixture hidden note",
        sourceUrl: null,
        observedOn: "2026-10-22",
        retrievedOn: "2026-10-23",
        reviewedOn: null,
        reviewStatus: "unreviewed",
        publicationStatus: "withheld",
        curated: true,
        curatedReason: null,
        unknownReason: null,
        conflictsWithFactId: null,
        sortOrder: 7,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(cataloguePriceReference)
    .values({
      id: "price_kestrel_fixture",
      applicabilityId,
      sourcePolicyId: policyId,
      salesMarketId,
      amountMinor: 42424242,
      currency: "INR",
      minorUnitExponent: 2,
      basis: "official price reference",
      taxInclusivity: "unspecified",
      observedOn: "2026-10-22",
      reviewStatus: "reviewed",
      publicationStatus: "fixture",
    })
    .onConflictDoNothing();
}
