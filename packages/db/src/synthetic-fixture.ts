import {
  catalogueAlias,
  catalogueApplicability,
  catalogueBrand,
  catalogueGeneration,
  catalogueGenerationAlias,
  catalogueImage,
  catalogueMarketVariant,
  catalogueModel,
  catalogueModelYear,
  cataloguePriceReference,
  catalogueProductionClaim,
  catalogueRouteRedirect,
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
    .insert(catalogueSourcePolicy)
    .values({
      id: "policy_synthetic_conflict",
      name: "Synthetic conflict policy",
      audience: "private-preview",
      permitsPublicCatalogue: false,
      rightsReview: "reviewed",
      attribution: "Synthetic conflict note attribution. Not a manufacturer publication.",
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
        sourcePolicyId: "policy_synthetic_conflict",
        property: "Torque",
        state: "known",
        rawValue: "90 N·m",
        normalizedValue: "90",
        unit: "N·m",
        measurementStandard: "fixture-torque",
        sourceTitle: "Synthetic fixture conflict note",
        sourceUrl: "https://example.invalid/fixture-torque-conflict",
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
      sourceTitle: "Synthetic fixture price sheet",
      sourceUrl: null,
      sourceIdentifier: "fixture-price-kestrel-2026",
      retrievedOn: "2026-10-23",
      reviewedOn: "2026-10-23",
    })
    .onConflictDoNothing();

  await insertDossierContextFixtures(db);
}

const previewPolicyId = "policy_synthetic_preview";
const lumenIndia = "app_lumen_in_2024_base";
const lumenJapan = "app_lumen_jp_2024_base";
const relabelApplicability = "app_relabel_in_2024_base";
const twinModelId = "model_twin_coupe";
const twinGenerationId = "gen_series_two";

/**
 * Labelled private-preview cars for the dossier reader.
 * Replaying the insert does not duplicate rows, and none of these names are real catalogue data.
 */
async function insertDossierContextFixtures(db: Database) {
  await db
    .insert(catalogueSourcePolicy)
    .values({
      id: "policy_synthetic_image",
      name: "Synthetic image policy",
      audience: "private-preview",
      permitsPublicCatalogue: false,
      rightsReview: "reviewed",
      attribution: "Synthetic fixture image policy. Not a catalogue photograph grant.",
      internalNote: "provider-secret-do-not-project",
      permitsImages: true,
    })
    .onConflictDoNothing();

  await db
    .insert(catalogueSalesMarket)
    .values({ id: "mkt_fixture_jp", name: "Japan", countryCode: "JP" })
    .onConflictDoNothing();

  await db.insert(catalogueModelYear).values([
    {
      id: "year_lumen_in",
      label: "2024",
      convention: "India model-year label. Not the calendar build year.",
    },
    {
      id: "year_lumen_jp",
      label: "2024",
      convention: "Japanese model-year label. Not the calendar build year.",
    },
  ]).onConflictDoNothing();

  await db
    .insert(catalogueBrand)
    .values({ id: "brand_lumen_fixture", name: "Lumen Fixture", slug: "lumen-fixture" })
    .onConflictDoNothing();

  await db
    .insert(catalogueModel)
    .values({ id: twinModelId, brandId: "brand_lumen_fixture", name: "Twin Coupe", slug: "twin-coupe" })
    .onConflictDoNothing();

  await db
    .insert(catalogueGeneration)
    .values({
      id: twinGenerationId,
      modelId: twinModelId,
      name: "Series Two",
      slug: "series-two",
      publicationStatus: "fixture",
      synthetic: true,
      sourcePolicyId: previewPolicyId,
    })
    .onConflictDoNothing();

  await db.insert(catalogueMarketVariant).values([
    {
      id: "var_lumen_in_base",
      generationId: twinGenerationId,
      salesMarketId: "mkt_fixture_in",
      name: "Base",
    },
    {
      id: "var_lumen_jp_base",
      generationId: twinGenerationId,
      salesMarketId: "mkt_fixture_jp",
      name: "Base",
    },
  ]).onConflictDoNothing();

  await db.insert(catalogueApplicability).values([
    {
      id: lumenIndia,
      marketVariantId: "var_lumen_in_base",
      modelYearId: "year_lumen_in",
      salesMarketId: "mkt_fixture_in",
      sourcePolicyId: previewPolicyId,
      publicationStatus: "fixture",
      synthetic: true,
    },
    {
      id: lumenJapan,
      marketVariantId: "var_lumen_jp_base",
      modelYearId: "year_lumen_jp",
      salesMarketId: "mkt_fixture_jp",
      sourcePolicyId: previewPolicyId,
      publicationStatus: "fixture",
      synthetic: true,
    },
  ]).onConflictDoNothing();

  await db.insert(catalogueAlias).values([
    ...identityAliases(lumenIndia, "alias_lumen_in", "lumen twin"),
    ...identityAliases(lumenJapan, "alias_lumen_jp", "lumen twin"),
  ]).onConflictDoNothing();

  await db.insert(catalogueSourcedFact).values([
    fixtureFact({
      id: "fact_lumen_in_powertrain",
      applicabilityId: lumenIndia,
      property: "Powertrain",
      state: "known",
      rawValue: "petrol fixture",
      normalizedValue: "fixture-petrol",
      measurementStandard: "fixture-powertrain",
      sourceTitle: "Synthetic fixture power note",
      sortOrder: 1,
    }),
    fixtureFact({
      id: "fact_lumen_in_ps",
      applicabilityId: lumenIndia,
      property: "Power",
      state: "known",
      rawValue: "300 PS",
      normalizedValue: "300",
      unit: "PS",
      measurementStandard: "PS",
      sourceTitle: "Synthetic fixture power note",
      freshness: "stale",
      sortOrder: 2,
    }),
    fixtureFact({
      id: "fact_lumen_in_bhp",
      applicabilityId: lumenIndia,
      property: "Power",
      state: "known",
      rawValue: "296 bhp",
      normalizedValue: "296",
      unit: "bhp",
      measurementStandard: "bhp",
      sourceTitle: "Synthetic fixture power note",
      sortOrder: 3,
    }),
    fixtureFact({
      id: "fact_lumen_in_kw",
      applicabilityId: lumenIndia,
      property: "Power",
      state: "known",
      rawValue: "221 kW",
      normalizedValue: "221",
      unit: "kW",
      measurementStandard: "kW",
      sourceTitle: "Synthetic fixture power note",
      sortOrder: 4,
    }),
    fixtureFact({
      id: "fact_lumen_in_drive",
      applicabilityId: lumenIndia,
      property: "Drivetrain",
      state: "known",
      rawValue: "rear-wheel drive",
      normalizedValue: "rear-wheel drive",
      measurementStandard: "fixture-drivetrain",
      sourceTitle: "Synthetic fixture power note",
      sortOrder: 5,
    }),
    fixtureFact({
      id: "fact_lumen_in_transmission",
      applicabilityId: lumenIndia,
      property: "Transmission",
      state: "not-applicable",
      unknownReason: "The synthetic fixture marks transmission not applicable.",
      sourceTitle: "Synthetic fixture applicability note",
      sortOrder: 6,
    }),
    fixtureFact({
      id: "fact_lumen_in_acceleration",
      applicabilityId: lumenIndia,
      property: "Acceleration",
      state: "withheld",
      unknownReason: "The synthetic fixture withholds this figure by rights.",
      sourceTitle: "Synthetic fixture rights note",
      sortOrder: 7,
    }),
    fixtureFact({
      id: "fact_lumen_in_kerb",
      applicabilityId: lumenIndia,
      property: "Kerb weight",
      state: "known",
      rawValue: "1400 kg",
      normalizedValue: "1400",
      unit: "kg",
      measurementStandard: "kerb",
      sourceTitle: "Synthetic fixture weight note",
      curatedReason: "The synthetic fixture keeps the kerb weight.",
      sortOrder: 8,
    }),
    fixtureFact({
      id: "fact_lumen_in_kerb_conflict",
      applicabilityId: lumenIndia,
      sourcePolicyId: "policy_synthetic_conflict",
      property: "Kerb weight",
      state: "known",
      rawValue: "1350 kg",
      normalizedValue: "1350",
      unit: "kg",
      measurementStandard: "kerb",
      sourceTitle: "Synthetic fixture weight conflict",
      sourceUrl: "https://example.invalid/fixture-weight-conflict",
      curated: false,
      conflictsWithFactId: "fact_lumen_in_kerb",
      sortOrder: 9,
    }),
    fixtureFact({
      id: "fact_lumen_in_dry",
      applicabilityId: lumenIndia,
      property: "Dry weight",
      state: "known",
      rawValue: "1280 kg",
      normalizedValue: "1280",
      unit: "kg",
      measurementStandard: "dry",
      sourceTitle: "Synthetic fixture weight note",
      sortOrder: 10,
    }),
    fixtureFact({
      id: "fact_lumen_in_wltp",
      applicabilityId: lumenIndia,
      property: "Efficiency",
      state: "known",
      rawValue: "8.4 l/100 km",
      normalizedValue: "8.4",
      unit: "l/100 km",
      measurementStandard: "WLTP",
      sourceTitle: "Synthetic fixture efficiency note",
      sortOrder: 11,
    }),
    fixtureFact({
      id: "fact_lumen_in_nedc",
      applicabilityId: lumenIndia,
      property: "Efficiency",
      state: "known",
      rawValue: "7.1 l/100 km",
      normalizedValue: "7.1",
      unit: "l/100 km",
      measurementStandard: "NEDC",
      sourceTitle: "Synthetic fixture efficiency note",
      sortOrder: 12,
    }),
    fixtureFact({
      id: "fact_lumen_in_range",
      applicabilityId: lumenIndia,
      property: "Range",
      state: "unknown",
      unknownReason: "The synthetic fixture has not checked a range figure.",
      sourceTitle: "Synthetic fixture range note",
      freshness: "not-checked",
      sortOrder: 13,
    }),
    fixtureFact({
      id: "fact_lumen_in_safety",
      applicabilityId: lumenIndia,
      property: "Safety",
      state: "known",
      rawValue: "six airbags",
      normalizedValue: "six airbags",
      measurementStandard: "fixture-safety",
      sourceTitle: "Synthetic fixture safety note",
      sortOrder: 14,
    }),
    fixtureFact({
      id: "fact_lumen_in_sales",
      applicabilityId: lumenIndia,
      property: "Sales",
      state: "known",
      rawValue: "88001",
      normalizedValue: "88001",
      measurementStandard: "fixture-sales",
      sourceTitle: "Synthetic fixture sales note",
      sortOrder: 15,
    }),
    fixtureFact({
      id: "fact_lumen_in_body",
      applicabilityId: lumenIndia,
      property: "Body",
      state: "known",
      rawValue: "coupe",
      normalizedValue: "coupe",
      measurementStandard: "fixture-body",
      sourceTitle: "Synthetic fixture dossier",
      sortOrder: 16,
    }),
    fixtureFact({
      id: "fact_lumen_jp_power",
      applicabilityId: lumenJapan,
      property: "Power",
      state: "known",
      rawValue: "150 PS",
      normalizedValue: "150",
      unit: "PS",
      measurementStandard: "PS",
      sourceTitle: "Synthetic fixture Japan power note",
      sortOrder: 1,
    }),
  ]).onConflictDoNothing();

  await db.insert(catalogueProductionClaim).values([
    {
      id: "prod_lumen_in_completed",
      applicabilityId: lumenIndia,
      sourcePolicyId: previewPolicyId,
      scope: "India Base",
      geography: "India",
      period: "2024",
      count: 12,
      status: "completed",
      counted: "vehicles built",
      sourceTitle: "Synthetic fixture production note",
      sourceUrl: null,
      observedOn: "2026-10-22",
      retrievedOn: "2026-10-23",
      reviewedOn: "2026-10-23",
      reviewStatus: "reviewed",
      publicationStatus: "fixture",
      sortOrder: 1,
    },
    {
      id: "prod_lumen_in_planned",
      applicabilityId: lumenIndia,
      sourcePolicyId: previewPolicyId,
      scope: "India Base",
      geography: "India",
      period: "2025",
      count: 40,
      status: "planned",
      counted: "vehicles planned",
      sourceTitle: "Synthetic fixture production note",
      sourceUrl: null,
      observedOn: "2026-10-22",
      retrievedOn: "2026-10-23",
      reviewedOn: "2026-10-23",
      reviewStatus: "reviewed",
      publicationStatus: "fixture",
      sortOrder: 2,
    },
  ]).onConflictDoNothing();

  await db.insert(cataloguePriceReference).values([
    {
      id: "price_lumen_in",
      applicabilityId: lumenIndia,
      sourcePolicyId: previewPolicyId,
      salesMarketId: "mkt_fixture_in",
      amountMinor: 11110000,
      currency: "INR",
      minorUnitExponent: 2,
      basis: "official price reference",
      taxInclusivity: "unspecified",
      observedOn: "2026-10-22",
      reviewStatus: "reviewed",
      publicationStatus: "fixture",
      sourceTitle: "Synthetic fixture India price sheet",
      sourceUrl: null,
      sourceIdentifier: "fixture-price-lumen-in-2024",
      retrievedOn: "2026-10-23",
      reviewedOn: "2026-10-23",
    },
    {
      id: "price_lumen_jp",
      applicabilityId: lumenJapan,
      sourcePolicyId: previewPolicyId,
      salesMarketId: "mkt_fixture_jp",
      amountMinor: 2500000,
      currency: "JPY",
      minorUnitExponent: 0,
      basis: "official price reference",
      taxInclusivity: "unspecified",
      observedOn: "2026-10-22",
      reviewStatus: "reviewed",
      publicationStatus: "fixture",
      sourceTitle: "Synthetic fixture Japan price sheet",
      sourceUrl: null,
      sourceIdentifier: "fixture-price-lumen-jp-2024",
      retrievedOn: "2026-10-23",
      reviewedOn: "2026-10-23",
    },
  ]).onConflictDoNothing();

  await db
    .insert(catalogueImage)
    .values({
      id: "image_lumen_jp",
      applicabilityId: lumenJapan,
      generationId: null,
      sourcePolicyId: "policy_synthetic_image",
      publicationStatus: "fixture",
      credit: "Synthetic fixture image office",
      licence: "Fixture image only. Not a catalogue photograph grant.",
      sourceUrl: "https://example.invalid/fixture-image",
      altText: "Synthetic fixture graphic",
      assetUrl:
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3Crect width='640' height='360' fill='%23111111'/%3E%3Crect x='96' y='150' width='448' height='64' fill='%232a2a2a'/%3E%3C/svg%3E",
      reviewStatus: "reviewed",
    })
    .onConflictDoNothing();

  await db
    .insert(catalogueRouteRedirect)
    .values({
      id: "redirect_twin_old",
      modelSlug: "twin-coupe-old",
      generationSlug: "series-two-old",
      modelId: twinModelId,
      generationId: twinGenerationId,
    })
    .onConflictDoNothing();

  await db
    .insert(catalogueBrand)
    .values({ id: "brand_sketch_fixture", name: "Sketch Fixture", slug: "sketch-fixture" })
    .onConflictDoNothing();
  await db
    .insert(catalogueModel)
    .values({
      id: "model_unfinished_note",
      brandId: "brand_sketch_fixture",
      name: "Unfinished Note",
      slug: "unfinished-note",
    })
    .onConflictDoNothing();
  await db
    .insert(catalogueGeneration)
    .values({
      id: "gen_open_sheet",
      modelId: "model_unfinished_note",
      name: "Open Sheet",
      slug: "open-sheet",
      publicationStatus: "fixture",
      synthetic: true,
      sourcePolicyId: previewPolicyId,
    })
    .onConflictDoNothing();
  await db.insert(catalogueGenerationAlias).values([
    { id: "gen_alias_sketch", generationId: "gen_open_sheet", normalizedName: "sketch fixture" },
    { id: "gen_alias_unfinished", generationId: "gen_open_sheet", normalizedName: "unfinished note" },
  ]).onConflictDoNothing();

  await db
    .insert(catalogueModel)
    .values({
      id: "model_relabelled_coupe",
      brandId: "brand_lumen_fixture",
      name: "Relabelled Coupe",
      slug: "relabelled-coupe",
      rebadgeOfModelId: twinModelId,
    })
    .onConflictDoNothing();
  await db
    .insert(catalogueGeneration)
    .values({
      id: "gen_local_sheet",
      modelId: "model_relabelled_coupe",
      name: "Local Sheet",
      slug: "local-sheet",
    })
    .onConflictDoNothing();
  await db
    .insert(catalogueMarketVariant)
    .values({
      id: "var_relabel_base",
      generationId: "gen_local_sheet",
      salesMarketId: "mkt_fixture_in",
      name: "Base",
    })
    .onConflictDoNothing();
  await db
    .insert(catalogueApplicability)
    .values({
      id: relabelApplicability,
      marketVariantId: "var_relabel_base",
      modelYearId: "year_lumen_in",
      salesMarketId: "mkt_fixture_in",
      sourcePolicyId: previewPolicyId,
      publicationStatus: "fixture",
      synthetic: true,
    })
    .onConflictDoNothing();
  await db.insert(catalogueAlias).values([
    {
      id: "alias_relabel_model",
      applicabilityId: relabelApplicability,
      kind: "model",
      normalizedName: "relabelled coupe",
    },
    {
      id: "alias_relabel_alias",
      applicabilityId: relabelApplicability,
      kind: "alias",
      normalizedName: "relabelled coupe",
    },
  ]).onConflictDoNothing();
  await db
    .insert(catalogueSourcedFact)
    .values(
      fixtureFact({
        id: "fact_relabel_body",
        applicabilityId: relabelApplicability,
        property: "Body",
        state: "known",
        rawValue: "coupe",
        normalizedValue: "coupe",
        measurementStandard: "fixture-body",
        sourceTitle: "Synthetic fixture rebadge note",
        sortOrder: 1,
      }),
    )
    .onConflictDoNothing();
}

function identityAliases(applicabilityId: string, prefix: string, alias: string) {
  return [
    { id: `${prefix}_brand`, applicabilityId, kind: "brand" as const, normalizedName: "lumen fixture" },
    { id: `${prefix}_model`, applicabilityId, kind: "model" as const, normalizedName: "twin coupe" },
    { id: `${prefix}_generation`, applicabilityId, kind: "generation" as const, normalizedName: "series two" },
    { id: `${prefix}_alias`, applicabilityId, kind: "alias" as const, normalizedName: alias },
  ];
}

function fixtureFact(input: {
  id: string;
  applicabilityId: string;
  sourcePolicyId?: string;
  property: string;
  state: "known" | "unknown" | "not-applicable" | "withheld";
  rawValue?: string | null;
  normalizedValue?: string | null;
  unit?: string | null;
  measurementStandard?: string | null;
  sourceTitle: string;
  sourceUrl?: string | null;
  curated?: boolean;
  curatedReason?: string | null;
  unknownReason?: string | null;
  conflictsWithFactId?: string | null;
  freshness?: "current" | "stale" | "not-checked";
  sortOrder: number;
}) {
  return {
    id: input.id,
    applicabilityId: input.applicabilityId,
    sourcePolicyId: input.sourcePolicyId ?? previewPolicyId,
    property: input.property,
    state: input.state,
    rawValue: input.rawValue ?? null,
    normalizedValue: input.normalizedValue ?? null,
    unit: input.unit ?? null,
    measurementStandard: input.measurementStandard ?? null,
    sourceTitle: input.sourceTitle,
    sourceUrl: input.sourceUrl ?? null,
    observedOn: "2026-10-22",
    retrievedOn: "2026-10-23",
    reviewedOn: "2026-10-23",
    reviewStatus: "reviewed" as const,
    publicationStatus: "fixture" as const,
    curated: input.curated ?? true,
    curatedReason: input.curatedReason ?? null,
    unknownReason: input.unknownReason ?? null,
    conflictsWithFactId: input.conflictsWithFactId ?? null,
    freshness: input.freshness ?? ("current" as const),
    sortOrder: input.sortOrder,
  };
}
