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
} from "@cart-campuss/db/schema/catalogue";
import type { Database } from "@cart-campuss/db";
import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import { normalizeCatalogueQuery } from "./catalogue-name";
import type { CatalogueAccess } from "./context";
import {
  buildApplicabilitySelector,
  catalogueContextHref,
  correctionIssueUrl,
  dossierSections,
  parseDossierSection,
  type DossierSection,
} from "./dossier";
import { CATALOGUE_IDENTITY_FIELDS, currentProjectionCovers, currentScopedProjectionCovers, publicMetadataEligible, readPublishedCatalogueDetail, type PublicDetail, type PublicMedia } from "./publishing";

export { normalizeCatalogueQuery } from "./catalogue-name";

type CatalogueSearchIdentity = {
  brandName: string;
  modelName: string;
  modelId: string;
  modelSlug: string;
  match: "exact" | "prefix";
  synthetic: boolean;
  href: string;
};

export type CatalogueSearchHit =
  | (CatalogueSearchIdentity & {
      scope: "applicability";
      applicabilityId: string;
      generationId: string;
      generationName: string;
      generationSlug: string;
      salesMarketName: string;
      salesMarketId: string;
      modelYearLabel: string;
      modelYearId: string;
      variantName: string;
      variantId: string;
    })
  | (CatalogueSearchIdentity & {
      scope: "generation";
      applicabilityId: null;
      generationId: string;
      generationName: string;
      generationSlug: string;
    });

export type CatalogueSearchResult = {
  query: string;
  privatePreview: boolean;
  hits: CatalogueSearchHit[];
};

export type CatalogueAssertion = {
  rawValue: string | null;
  normalizedValue: string | null;
  unit: string | null;
  measurementStandard: string | null;
  sourceTitle: string;
  sourceUrl: string | null;
  observedOn: string | null;
  retrievedOn: string;
  reviewedOn: string | null;
  reviewStatus: string;
  policyName: string;
  policyAudience: string;
  policyAttribution: string;
  factualReviewerRef?: string | null;
  rightsReviewerRef?: string | null;
};

export type CatalogueFact = CatalogueAssertion & {
  property: string;
  state: "known" | "unknown" | "not-applicable" | "withheld";
  freshness: "current" | "stale" | "not-checked";
  unknownReason: string | null;
  curatedReason: string | null;
  conflict: CatalogueAssertion | null;
};

export type CatalogueImage = {
  altText: string;
  credit: string;
  licence: string;
  sourceUrl: string | null;
  assetUrl: string;
};

export type CatalogueProductionClaim = {
  scope: string;
  geography: string;
  period: string;
  count: number;
  status: "planned" | "completed";
  counted: string;
  sourceTitle: string;
  sourceUrl: string | null;
  observedOn: string | null;
  retrievedOn: string;
  reviewedOn: string | null;
  reviewStatus: string;
  policyName: string;
  policyAudience: string;
  policyAttribution: string;
};

export type CatalogueSelector = ReturnType<typeof buildApplicabilitySelector>;

export type CataloguePriceReference = {
  kind: "price-reference";
  amountMinor: number;
  currency: string;
  minorUnitExponent: number;
  displayAmount: string;
  basis: string;
  taxInclusivity: string;
  salesMarketName: string;
  observedOn: string;
  retrievedOn: string;
  reviewedOn: string | null;
  reviewStatus: string;
  sourceTitle: string;
  sourceUrl: string | null;
  sourceIdentifier: string | null;
  policyName: string;
  policyAudience: string;
  policyAttribution: string;
};

export type CataloguePolicy = {
  name: string;
  audience: string;
  attribution: string;
  policyReviewerRef?: string | null;
  factualReviewerRef?: string | null;
  rightsReviewerRef?: string | null;
};

export type CatalogueIdentity = {
  brandName: string;
  modelName: string;
  generationName: string;
  modelSlug: string;
  generationSlug: string;
  salesMarketName: string;
  salesMarketId: string;
  modelYearLabel: string;
  modelYearId: string;
  modelYearConvention: string;
  variantName: string;
  variantId: string;
  applicabilityId: string;
};

type GenerationIdentity = Pick<
  CatalogueIdentity,
  "brandName" | "modelName" | "generationName" | "modelSlug" | "generationSlug"
>;

type DossierShell = {
  privatePreview: boolean;
  synthetic: boolean;
  policy: CataloguePolicy;
  selector: CatalogueSelector;
  sections: ReturnType<typeof dossierSections>;
  context: {
    market: string | null;
    year: string | null;
    variant: string | null;
    registration: string | null;
    section: DossierSection;
  };
  correctionHref: string;
  rebadge: { brandName: string; modelName: string; href: string } | null;
  aliases: string[];
  image: CatalogueImage | null;
};

export type CatalogueCarPage =
  | {
      availability: "visible";
      identity: CatalogueIdentity;
      facts: CatalogueFact[];
      priceReference: CataloguePriceReference | null;
      marketLabel: "No market data";
      productionClaims: CatalogueProductionClaim[];
    } & DossierShell
  | {
      availability: "overview" | "incompatible";
      identity: GenerationIdentity;
    } & DossierShell
  | {
      availability: "scoped";
      scope: "generation";
      identity: GenerationIdentity;
      facts: CatalogueFact[];
      productionClaims: CatalogueProductionClaim[];
    } & DossierShell
  | {
      availability: "redirect";
      modelSlug: string;
      generationSlug: string;
    }
  | {
      availability: "not-in-public-catalogue";
      privatePreview: boolean;
    };

export type CarSelection = {
  modelSlug: string;
  generationSlug: string;
  market?: string;
  year?: string;
  variant?: string;
  section?: DossierSection;
  registration?: string;
};

export function formatMinorUnits(
  amountMinor: number | bigint | string,
  currency: string,
  exponent: number,
): string | null {
  const amount =
    typeof amountMinor === "bigint"
      ? amountMinor > BigInt(Number.MAX_SAFE_INTEGER) ||
        amountMinor < BigInt(-Number.MAX_SAFE_INTEGER)
        ? Number.NaN
        : Number(amountMinor)
      : typeof amountMinor === "string"
        ? Number(amountMinor)
        : amountMinor;
  if (
    !Number.isSafeInteger(amount) ||
    !Number.isSafeInteger(exponent) ||
    exponent < 0 ||
    exponent > 6
  ) {
    return null;
  }
  const sign = amount < 0 ? "-" : "";
  const digits = String(Math.abs(amount)).padStart(exponent + 1, "0");
  const whole = exponent === 0 ? digits : digits.slice(0, digits.length - exponent);
  const fraction = exponent === 0 ? "" : digits.slice(digits.length - exponent);
  const grouped = currency === "INR" ? groupIndianDigits(whole) : groupWesternDigits(whole);
  const prefix = currency === "INR" ? "₹" : `${currency} `;
  return `${sign}${prefix}${fraction ? `${grouped}.${fraction}` : grouped}`;
}

export function catalogueCarHref(input: {
  modelSlug: string;
  generationSlug: string;
  salesMarketId: string;
  modelYearId: string;
  variantId: string;
}): string {
  return catalogueContextHref({
    modelSlug: input.modelSlug,
    generationSlug: input.generationSlug,
    market: input.salesMarketId,
    year: input.modelYearId,
    variant: input.variantId,
  });
}

export function catalogueStatus(access: CatalogueAccess) {
  return { privatePreview: access.allowFixtures };
}

function prefixUpperBound(prefix: string): string {
  const chars = [...prefix];
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const code = chars[index]?.codePointAt(0);
    if (code === undefined) break;
    if (code < 0x10ffff) {
      chars[index] = String.fromCodePoint(code + 1);
      return chars.slice(0, index + 1).join("");
    }
  }
  return `${prefix}\u{10ffff}`;
}

export function catalogueSearchStatement(
  db: Database,
  access: CatalogueAccess,
  query: string,
  now: () => Date = () => new Date(),
) {
  return buildCatalogueSearch(db, access, normalizeCatalogueQuery(query), now()).toSQL();
}

export async function searchCatalogue(
  db: Database,
  access: CatalogueAccess,
  query: string,
  now: () => Date = () => new Date(),
): Promise<CatalogueSearchResult> {
  const normalized = normalizeCatalogueQuery(query);
  if (!normalized) {
    return { query, privatePreview: access.allowFixtures, hits: [] };
  }
  const rows = await buildCatalogueSearch(db, access, normalized, now());

  const seen = new Set<string>();
  const hits: CatalogueSearchHit[] = [];
  for (const row of rows) {
    if (seen.has(row.applicabilityId)) continue;
    if (!row.synthetic && !publicMetadataEligible(Object.values(row).filter((value) => typeof value === "string"))) continue;
    if (!row.synthetic) {
      const projection = await readPublishedCatalogueDetail(db, row.applicabilityId, now);
      if (!projection || !projectionMatchesIdentity(row, projection)) continue;
      const canonicalName = [
        { kind: "brand", name: row.brandName },
        { kind: "model", name: row.modelName },
        { kind: "generation", name: row.generationName },
      ].some((item) => item.kind === row.aliasKind && normalizeCatalogueQuery(item.name) === row.normalizedName);
      const approvedAlias = projection.permittedFields.includes("alias") &&
        projection.aliases.some((alias) => normalizeCatalogueQuery(alias) === row.normalizedName);
      if (!canonicalName && !approvedAlias) continue;
    }
    seen.add(row.applicabilityId);
    hits.push({
      scope: "applicability",
      applicabilityId: row.applicabilityId,
      generationId: row.generationId,
      modelId: row.modelId,
      brandName: row.brandName,
      modelName: row.modelName,
      generationName: row.generationName,
      modelSlug: row.modelSlug,
      generationSlug: row.generationSlug,
      salesMarketName: row.salesMarketName,
      salesMarketId: row.salesMarketId,
      modelYearLabel: row.modelYearLabel,
      modelYearId: row.modelYearId,
      variantName: row.variantName,
      variantId: row.variantId,
      match: row.normalizedName === normalized ? "exact" : "prefix",
      synthetic: row.synthetic,
      href: catalogueCarHref(row),
    });
    if (hits.length === 20) break;
  }

  if (hits.length < 20) {
    const generations = await searchBareGenerations(db, access, normalized, now());
    for (const hit of generations) {
      if (hits.length === 20) break;
      hits.push(hit);
    }
  }

  return {
    query,
    privatePreview: access.allowFixtures,
    hits,
  };
}

export async function readCatalogueCar(
  db: Database,
  access: CatalogueAccess,
  selection: CarSelection,
  now: () => Date = () => new Date(),
): Promise<CatalogueCarPage> {
  const privatePreview = access.allowFixtures;
  const clock = now();
  const section = parseDossierSection(selection.section);
  const located = await findGenerationBySlug(db, selection.modelSlug, selection.generationSlug);
  if (!located) {
    const redirect = await findRedirect(db, access, selection, clock);
    return redirect ?? { availability: "not-in-public-catalogue", privatePreview };
  }

  const modelRows = await loadVisibleApplicability(db, access, located.modelId, clock);
  const generationRows = modelRows.filter((row) => row.generationId === located.generationId);
  const selfVisible = generationRowVisible(located, access);
  const scoped =
    generationRows.length === 0 && !selfVisible
      ? await publishedGenerationProjection(db, located.generationId, clock)
      : null;
  if (generationRows.length === 0 && !selfVisible && !scoped) {
    return { availability: "not-in-public-catalogue", privatePreview };
  }

  const generations = await listVisibleGenerations(db, access, located.modelId, modelRows, clock);
  const requested = {
    market: selection.market ?? null,
    year: selection.year ?? null,
    variant: selection.variant ?? null,
    section,
    registration: selection.registration ?? null,
  };
  const selector = buildApplicabilitySelector({
    modelSlug: located.modelSlug,
    generations,
    currentGenerationId: located.generationId,
    currentGenerationSlug: located.generationSlug,
    rows: modelRows,
    requested,
  });
  const rebadge = await readRebadge(db, access, located.rebadgeOfModelId, clock);
  const shell = {
    privatePreview,
    synthetic: located.synthetic || generationRows.some((row) => row.synthetic),
    selector,
    sections: dossierSections({
      modelSlug: located.modelSlug,
      generationSlug: located.generationSlug,
      market: requested.market,
      year: requested.year,
      variant: requested.variant,
      section,
      registration: requested.registration,
    }),
    context: requested,
    rebadge,
    aliases: [] as string[],
    image: null as CatalogueImage | null,
  };
  const identity = {
    brandName: located.brandName,
    modelName: located.modelName,
    generationName: located.generationName,
    modelSlug: located.modelSlug,
    generationSlug: located.generationSlug,
  };
  const pagePath = catalogueContextHref({
    modelSlug: located.modelSlug,
    generationSlug: located.generationSlug,
    market: requested.market,
    year: requested.year,
    variant: requested.variant,
    section,
  });
  const complete = Boolean(requested.market && requested.year && requested.variant);
  const selected = complete
    ? generationRows.find(
        (row) =>
          row.salesMarketId === requested.market &&
          row.modelYearId === requested.year &&
          row.variantId === requested.variant,
      )
    : undefined;

  if (!selected) {
    if (scoped) {
      if (complete) {
        return {
          availability: "incompatible",
          ...shell,
          synthetic: false,
          policy: policyFromProjection(
            { name: scoped.policyName ?? "", audience: "public", attribution: scoped.attribution },
            scoped,
          ),
          identity,
          image: null,
          correctionHref: correctionIssueUrl({
            ...identity,
            applicabilityId: null,
            salesMarketId: requested.market,
            modelYearId: requested.year,
            variantId: requested.variant,
            pagePath,
          }),
        };
      }
      const policy = policyFromProjection(
        { name: scoped.policyName ?? "", audience: "public", attribution: scoped.attribution },
        scoped,
      );
      return {
        availability: "scoped",
        scope: "generation",
        ...shell,
        synthetic: false,
        policy,
        aliases: scoped.permittedFields.includes("alias") ? scoped.aliases : [],
        image: imageFromMedia(scoped.media[0], policy),
        correctionHref: correctionIssueUrl({
          ...identity,
          applicabilityId: null,
          salesMarketId: null,
          modelYearId: null,
          variantId: null,
          pagePath,
        }),
        identity,
        facts: projectionFacts(scoped, policy),
        productionClaims: projectionProduction(scoped, policy),
      };
    }
    const [first] = generationRows;
    const policy = first
      ? first.projection
        ? policyFromProjection(policyOf(first), first.projection)
        : policyOf(first)
      : policyOf(located);
    const image =
      located.synthetic || Boolean(first?.synthetic)
        ? await readImage(db, access, { generationId: located.generationId })
        : null;
    return {
      availability: complete ? "incompatible" : "overview",
      ...shell,
      synthetic: shell.synthetic || Boolean(first?.synthetic),
      policy,
      identity,
      image,
      correctionHref: correctionIssueUrl({
        ...identity,
        applicabilityId: null,
        salesMarketId: requested.market,
        modelYearId: requested.year,
        variantId: requested.variant,
        pagePath,
      }),
    };
  }

  const projection = selected.projection;
  if (!selected.synthetic && !projection) {
    return { availability: "not-in-public-catalogue", privatePreview };
  }
  const policy = projection ? policyFromProjection(policyOf(selected), projection) : policyOf(selected);
  const facts = projection
    ? projectionFacts(projection, policy)
    : await readFacts(db, access, selected.applicabilityId);
  const prices = projection
    ? projectionPrices(projection, policy, selected.salesMarketName)
    : await readPrices(db, access, selected.applicabilityId);
  const productionClaims = projection
    ? projectionProduction(projection, policy)
    : await readProductionClaims(db, access, selected.applicabilityId);
  const aliases = projection
    ? projection.permittedFields.includes("alias")
      ? projection.aliases
      : []
    : await readAliases(db, selected.applicabilityId);
  const image = projection
    ? imageFromMedia(projection.media[0], policy)
    : await readImage(db, access, { applicabilityId: selected.applicabilityId });

  return {
    availability: "visible",
    ...shell,
    synthetic: selected.synthetic,
    policy,
    aliases,
    image,
    correctionHref: correctionIssueUrl({
      ...identity,
      applicabilityId: selected.applicabilityId,
      salesMarketId: selected.salesMarketId,
      modelYearId: selected.modelYearId,
      variantId: selected.variantId,
      pagePath,
    }),
    identity: {
      ...identity,
      salesMarketName: selected.salesMarketName,
      salesMarketId: selected.salesMarketId,
      modelYearLabel: selected.modelYearLabel,
      modelYearId: selected.modelYearId,
      modelYearConvention: selected.modelYearConvention,
      variantName: selected.variantName,
      variantId: selected.variantId,
      applicabilityId: selected.applicabilityId,
    },
    facts,
    priceReference: prices.length === 1 ? (prices[0] ?? null) : null,
    marketLabel: "No market data",
    productionClaims,
  };
}

type GenerationRecord = {
  generationId: string;
  generationName: string;
  generationSlug: string;
  modelId: string;
  modelName: string;
  modelSlug: string;
  brandName: string;
  rebadgeOfModelId: string | null;
  publicationStatus: string | null;
  synthetic: boolean;
  policyName: string | null;
  policyAudience: string | null;
  policyAttribution: string | null;
  permitsPublicCatalogue: boolean | null;
  rightsReview: string | null;
};

type ApplicabilityRow = {
  applicabilityId: string;
  generationId: string;
  brandName: string;
  modelName: string;
  generationName: string;
  modelSlug: string;
  generationSlug: string;
  salesMarketName: string;
  salesMarketId: string;
  countryCode: string;
  modelYearLabel: string;
  modelYearId: string;
  modelYearConvention: string;
  variantName: string;
  variantId: string;
  synthetic: boolean;
  policyName: string;
  policyAudience: string;
  policyAttribution: string;
  projection: PublicDetail | null;
};

async function findGenerationBySlug(
  db: Database,
  modelSlug: string,
  generationSlug: string,
): Promise<GenerationRecord | null> {
  const [row] = await db
    .select({
      generationId: catalogueGeneration.id,
      generationName: catalogueGeneration.name,
      generationSlug: catalogueGeneration.slug,
      modelId: catalogueModel.id,
      modelName: catalogueModel.name,
      modelSlug: catalogueModel.slug,
      brandName: catalogueBrand.name,
      rebadgeOfModelId: catalogueModel.rebadgeOfModelId,
      publicationStatus: catalogueGeneration.publicationStatus,
      synthetic: catalogueGeneration.synthetic,
      policyName: catalogueSourcePolicy.name,
      policyAudience: catalogueSourcePolicy.audience,
      policyAttribution: catalogueSourcePolicy.attribution,
      permitsPublicCatalogue: catalogueSourcePolicy.permitsPublicCatalogue,
      rightsReview: catalogueSourcePolicy.rightsReview,
    })
    .from(catalogueGeneration)
    .innerJoin(catalogueModel, eq(catalogueGeneration.modelId, catalogueModel.id))
    .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
    .leftJoin(
      catalogueSourcePolicy,
      eq(catalogueGeneration.sourcePolicyId, catalogueSourcePolicy.id),
    )
    .where(and(eq(catalogueModel.slug, modelSlug), eq(catalogueGeneration.slug, generationSlug)))
    .limit(1);
  return row ?? null;
}

/** Fixture shells only. A public incomplete generation needs a current reviewed projection. */
function generationRowVisible(row: GenerationRecord, access: CatalogueAccess): boolean {
  return (
    access.allowFixtures &&
    row.publicationStatus === "fixture" &&
    row.synthetic &&
    !row.permitsPublicCatalogue &&
    row.policyAudience === "private-preview" &&
    row.rightsReview === "reviewed" &&
    Boolean(row.policyName)
  );
}

async function publishedGenerationProjection(
  db: Database,
  generationId: string,
  now: Date,
): Promise<PublicDetail | null> {
  const projection = await readPublishedCatalogueDetail(db, generationId, () => now);
  if (
    !projection ||
    projection.identityScope !== "generation" ||
    !["brand", "model", "generation"].every((field) => projection.permittedFields.includes(field))
  ) {
    return null;
  }
  return projection;
}

async function loadVisibleApplicability(
  db: Database,
  access: CatalogueAccess,
  modelId: string,
  now: Date,
): Promise<ApplicabilityRow[]> {
  const rows = await db
    .select({
      applicabilityId: catalogueApplicability.id,
      generationId: catalogueGeneration.id,
      brandName: catalogueBrand.name,
      modelName: catalogueModel.name,
      generationName: catalogueGeneration.name,
      modelSlug: catalogueModel.slug,
      generationSlug: catalogueGeneration.slug,
      salesMarketName: catalogueSalesMarket.name,
      salesMarketId: catalogueSalesMarket.id,
      countryCode: catalogueSalesMarket.countryCode,
      modelYearLabel: catalogueModelYear.label,
      modelYearId: catalogueModelYear.id,
      modelYearConvention: catalogueModelYear.convention,
      variantName: catalogueMarketVariant.name,
      variantId: catalogueMarketVariant.id,
      synthetic: catalogueApplicability.synthetic,
      policyName: catalogueSourcePolicy.name,
      policyAudience: catalogueSourcePolicy.audience,
      policyAttribution: catalogueSourcePolicy.attribution,
    })
    .from(catalogueApplicability)
    .innerJoin(
      catalogueMarketVariant,
      eq(catalogueApplicability.marketVariantId, catalogueMarketVariant.id),
    )
    .innerJoin(catalogueGeneration, eq(catalogueMarketVariant.generationId, catalogueGeneration.id))
    .innerJoin(catalogueModel, eq(catalogueGeneration.modelId, catalogueModel.id))
    .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
    .innerJoin(
      catalogueSourcePolicy,
      eq(catalogueApplicability.sourcePolicyId, catalogueSourcePolicy.id),
    )
    .innerJoin(catalogueSalesMarket, eq(catalogueApplicability.salesMarketId, catalogueSalesMarket.id))
    .innerJoin(catalogueModelYear, eq(catalogueApplicability.modelYearId, catalogueModelYear.id))
    .where(and(eq(catalogueModel.id, modelId), visibleRecord(access, now)))
    .orderBy(asc(catalogueApplicability.id));

  const visible: ApplicabilityRow[] = [];
  for (const row of rows) {
    const projection = row.synthetic ? null : await readPublishedCatalogueDetail(db, row.applicabilityId, () => now);
    if (
      row.synthetic ||
      (projection &&
        projectionMatchesIdentity(row, projection) &&
        publicMetadataEligible(Object.values(row).filter((value) => typeof value === "string")))
    ) {
      visible.push({ ...row, projection });
    }
  }
  return visible;
}

async function listVisibleGenerations(
  db: Database,
  access: CatalogueAccess,
  modelId: string,
  rows: ApplicabilityRow[],
  now: Date,
): Promise<Array<{ id: string; name: string; slug: string }>> {
  const listed = new Map<string, { id: string; name: string; slug: string }>();
  for (const row of rows) {
    listed.set(row.generationId, {
      id: row.generationId,
      name: row.generationName,
      slug: row.generationSlug,
    });
  }
  const bare = await db
    .select({
      generationId: catalogueGeneration.id,
      generationName: catalogueGeneration.name,
      generationSlug: catalogueGeneration.slug,
      modelId: catalogueModel.id,
      modelName: catalogueModel.name,
      modelSlug: catalogueModel.slug,
      brandName: catalogueBrand.name,
      rebadgeOfModelId: catalogueModel.rebadgeOfModelId,
      publicationStatus: catalogueGeneration.publicationStatus,
      synthetic: catalogueGeneration.synthetic,
      policyName: catalogueSourcePolicy.name,
      policyAudience: catalogueSourcePolicy.audience,
      policyAttribution: catalogueSourcePolicy.attribution,
      permitsPublicCatalogue: catalogueSourcePolicy.permitsPublicCatalogue,
      rightsReview: catalogueSourcePolicy.rightsReview,
    })
    .from(catalogueGeneration)
    .innerJoin(catalogueModel, eq(catalogueGeneration.modelId, catalogueModel.id))
    .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
    .leftJoin(
      catalogueSourcePolicy,
      eq(catalogueGeneration.sourcePolicyId, catalogueSourcePolicy.id),
    )
    .where(eq(catalogueGeneration.modelId, modelId))
    .orderBy(asc(catalogueGeneration.id));
  for (const generation of bare) {
    if (listed.has(generation.generationId)) continue;
    const visible =
      generationRowVisible(generation, access) ||
      Boolean(await publishedGenerationProjection(db, generation.generationId, now));
    if (!visible) continue;
    listed.set(generation.generationId, {
      id: generation.generationId,
      name: generation.generationName,
      slug: generation.generationSlug,
    });
  }
  return [...listed.values()];
}

async function findRedirect(
  db: Database,
  access: CatalogueAccess,
  selection: CarSelection,
  now: Date,
): Promise<Extract<CatalogueCarPage, { availability: "redirect" }> | null> {
  const [target] = await db
    .select({
      modelSlug: catalogueModel.slug,
      generationSlug: catalogueGeneration.slug,
      modelId: catalogueModel.id,
      generationId: catalogueGeneration.id,
    })
    .from(catalogueRouteRedirect)
    .innerJoin(catalogueGeneration, eq(catalogueRouteRedirect.generationId, catalogueGeneration.id))
    .innerJoin(catalogueModel, eq(catalogueGeneration.modelId, catalogueModel.id))
    .where(
      and(
        eq(catalogueRouteRedirect.modelSlug, selection.modelSlug),
        eq(catalogueRouteRedirect.generationSlug, selection.generationSlug),
      ),
    )
    .limit(1);
  if (!target || (target.modelSlug === selection.modelSlug && target.generationSlug === selection.generationSlug)) {
    return null;
  }
  const generation = await findGenerationBySlug(db, target.modelSlug, target.generationSlug);
  if (!generation) return null;
  const rows = await loadVisibleApplicability(db, access, generation.modelId, now);
  const own = rows.some((row) => row.generationId === generation.generationId);
  if (
    !own &&
    !generationRowVisible(generation, access) &&
    !(await publishedGenerationProjection(db, generation.generationId, now))
  ) {
    return null;
  }
  return {
    availability: "redirect",
    modelSlug: target.modelSlug,
    generationSlug: target.generationSlug,
  };
}

async function readRebadge(
  db: Database,
  access: CatalogueAccess,
  modelId: string | null,
  now: Date,
): Promise<{ brandName: string; modelName: string; href: string } | null> {
  if (!modelId) return null;
  const generations = await db
    .select({
      generationId: catalogueGeneration.id,
      generationName: catalogueGeneration.name,
      generationSlug: catalogueGeneration.slug,
      modelId: catalogueModel.id,
      modelName: catalogueModel.name,
      modelSlug: catalogueModel.slug,
      brandName: catalogueBrand.name,
      rebadgeOfModelId: catalogueModel.rebadgeOfModelId,
      publicationStatus: catalogueGeneration.publicationStatus,
      synthetic: catalogueGeneration.synthetic,
      policyName: catalogueSourcePolicy.name,
      policyAudience: catalogueSourcePolicy.audience,
      policyAttribution: catalogueSourcePolicy.attribution,
      permitsPublicCatalogue: catalogueSourcePolicy.permitsPublicCatalogue,
      rightsReview: catalogueSourcePolicy.rightsReview,
    })
    .from(catalogueModel)
    .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
    .innerJoin(catalogueGeneration, eq(catalogueGeneration.modelId, catalogueModel.id))
    .leftJoin(
      catalogueSourcePolicy,
      eq(catalogueGeneration.sourcePolicyId, catalogueSourcePolicy.id),
    )
    .where(eq(catalogueModel.id, modelId))
    .orderBy(asc(catalogueGeneration.id));
  const rows = await loadVisibleApplicability(db, access, modelId, now);
  for (const generation of generations) {
    const visible =
      rows.some((row) => row.generationId === generation.generationId) ||
      generationRowVisible(generation, access) ||
      Boolean(await publishedGenerationProjection(db, generation.generationId, now));
    if (!visible) continue;
    return {
      brandName: generation.brandName,
      modelName: generation.modelName,
      href: catalogueContextHref({
        modelSlug: generation.modelSlug,
        generationSlug: generation.generationSlug,
      }),
    };
  }
  return null;
}

async function readAliases(db: Database, applicabilityId: string): Promise<string[]> {
  const rows = await db
    .select({ name: catalogueAlias.normalizedName })
    .from(catalogueAlias)
    .where(and(eq(catalogueAlias.applicabilityId, applicabilityId), eq(catalogueAlias.kind, "alias")))
    .orderBy(asc(catalogueAlias.normalizedName));
  return rows.map((row) => row.name);
}

/** Synthetic fixture rows. Public production counts come from the approved projection. */
async function readProductionClaims(
  db: Database,
  access: CatalogueAccess,
  applicabilityId: string,
): Promise<CatalogueProductionClaim[]> {
  const rows = await db
    .select({
      scope: catalogueProductionClaim.scope,
      geography: catalogueProductionClaim.geography,
      period: catalogueProductionClaim.period,
      count: catalogueProductionClaim.count,
      status: catalogueProductionClaim.status,
      counted: catalogueProductionClaim.counted,
      sourceTitle: catalogueProductionClaim.sourceTitle,
      sourceUrl: catalogueProductionClaim.sourceUrl,
      observedOn: catalogueProductionClaim.observedOn,
      retrievedOn: catalogueProductionClaim.retrievedOn,
      reviewedOn: catalogueProductionClaim.reviewedOn,
      reviewStatus: catalogueProductionClaim.reviewStatus,
      policyName: catalogueSourcePolicy.name,
      policyAudience: catalogueSourcePolicy.audience,
      policyAttribution: catalogueSourcePolicy.attribution,
    })
    .from(catalogueProductionClaim)
    .innerJoin(
      catalogueSourcePolicy,
      eq(catalogueProductionClaim.sourcePolicyId, catalogueSourcePolicy.id),
    )
    .where(
      and(
        eq(catalogueProductionClaim.applicabilityId, applicabilityId),
        visibleProjection(access, {
          publicationStatus: catalogueProductionClaim.publicationStatus,
          reviewStatus: catalogueProductionClaim.reviewStatus,
        }),
      ),
    )
    .orderBy(asc(catalogueProductionClaim.sortOrder));
  return rows.flatMap((row) => {
    const status = row.status === "planned" || row.status === "completed" ? row.status : null;
    if (!status || /(sale|registration|export)/i.test(row.counted)) return [];
    return [
      {
        scope: row.scope,
        geography: row.geography,
        period: row.period,
        count: row.count,
        status,
        counted: row.counted,
        sourceTitle: row.sourceTitle,
        sourceUrl: row.sourceUrl,
        observedOn: row.observedOn,
        retrievedOn: row.retrievedOn,
        reviewedOn: row.reviewedOn,
        reviewStatus: row.reviewStatus,
        policyName: row.policyName,
        policyAudience: row.policyAudience,
        policyAttribution: row.policyAttribution,
      },
    ];
  });
}

/** Synthetic fixture rows. A public image comes from the approved projection. */
async function readImage(
  db: Database,
  access: CatalogueAccess,
  parent: { applicabilityId?: string; generationId?: string },
): Promise<CatalogueImage | null> {
  const parentMatch = parent.applicabilityId
    ? eq(catalogueImage.applicabilityId, parent.applicabilityId)
    : parent.generationId
      ? eq(catalogueImage.generationId, parent.generationId)
      : sql`false`;
  const [row] = await db
    .select({
      altText: catalogueImage.altText,
      credit: catalogueImage.credit,
      licence: catalogueImage.licence,
      sourceUrl: catalogueImage.sourceUrl,
      assetUrl: catalogueImage.assetUrl,
    })
    .from(catalogueImage)
    .innerJoin(catalogueSourcePolicy, eq(catalogueImage.sourcePolicyId, catalogueSourcePolicy.id))
    .where(
      and(
        parentMatch,
        eq(catalogueSourcePolicy.permitsImages, true),
        visibleProjection(access, {
          publicationStatus: catalogueImage.publicationStatus,
          reviewStatus: catalogueImage.reviewStatus,
        }),
      ),
    )
    .limit(1);
  return row ?? null;
}

function imageFromMedia(media: PublicMedia | undefined, policy: CataloguePolicy): CatalogueImage | null {
  if (!media?.credit || !media.altText || !media.sourceUrl) return null;
  return {
    altText: media.altText,
    credit: media.credit,
    licence: media.attribution || policy.attribution,
    sourceUrl: media.sourceUrl,
    assetUrl: media.sourceUrl,
  };
}

function projectionProduction(projection: PublicDetail, policy: CataloguePolicy): CatalogueProductionClaim[] {
  return projection.productionClaims.flatMap((claim) => {
    if (claim.status !== "planned" && claim.status !== "completed") return [];
    if (/(sale|registration|export)/i.test(claim.counted)) return [];
    return [
      {
        scope: claim.scope,
        geography: claim.geography,
        period: claim.period,
        count: claim.count,
        status: claim.status,
        counted: claim.counted,
        sourceTitle: claim.sourceTitle,
        sourceUrl: claim.sourceUrl,
        observedOn: claim.observedAt,
        retrievedOn: claim.retrievedAt,
        reviewedOn: claim.reviewedOn,
        reviewStatus: "reviewed",
        policyName: claim.policyName || policy.name,
        policyAudience: "public",
        policyAttribution: claim.policyAttribution || policy.attribution,
      },
    ];
  });
}

function factState(state: string): CatalogueFact["state"] {
  if (state === "unknown" || state === "not-applicable" || state === "withheld") return state;
  return "known";
}

function factFreshness(value: string): CatalogueFact["freshness"] {
  if (value === "stale" || value === "not-checked") return value;
  return "current";
}

async function searchBareGenerations(
  db: Database,
  access: CatalogueAccess,
  normalized: string,
  now: Date,
): Promise<CatalogueSearchHit[]> {
  const upper = prefixUpperBound(normalized);
  const rows = await db
    .select({
      generationId: catalogueGeneration.id,
      generationName: catalogueGeneration.name,
      generationSlug: catalogueGeneration.slug,
      modelId: catalogueModel.id,
      modelName: catalogueModel.name,
      modelSlug: catalogueModel.slug,
      brandName: catalogueBrand.name,
      normalizedName: catalogueGenerationAlias.normalizedName,
      synthetic: catalogueGeneration.synthetic,
    })
    .from(catalogueGenerationAlias)
    .innerJoin(catalogueGeneration, eq(catalogueGenerationAlias.generationId, catalogueGeneration.id))
    .innerJoin(catalogueModel, eq(catalogueGeneration.modelId, catalogueModel.id))
    .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
    .leftJoin(
      catalogueSourcePolicy,
      eq(catalogueGeneration.sourcePolicyId, catalogueSourcePolicy.id),
    )
    .where(
      and(
        sql`${catalogueGenerationAlias.normalizedName} ~>=~ ${normalized}`,
        sql`${catalogueGenerationAlias.normalizedName} ~<~ ${upper}`,
        selfVisibleGenerationSql(access, now),
      ),
    )
    .orderBy(
      sql`case when ${catalogueGenerationAlias.normalizedName} = ${normalized} then 0 else 1 end`,
      asc(catalogueGeneration.id),
    )
    .limit(20);
  if (rows.length === 0) return [];
  const occupied = await db
    .select({ generationId: catalogueMarketVariant.generationId })
    .from(catalogueApplicability)
    .innerJoin(
      catalogueMarketVariant,
      eq(catalogueApplicability.marketVariantId, catalogueMarketVariant.id),
    )
    .innerJoin(
      catalogueSourcePolicy,
      eq(catalogueApplicability.sourcePolicyId, catalogueSourcePolicy.id),
    )
    .where(
      and(
        inArray(
          catalogueMarketVariant.generationId,
          rows.map((row) => row.generationId),
        ),
        visibleRecord(access, now),
      ),
    );
  const occupiedIds = new Set(occupied.map((row) => row.generationId));
  const seen = new Set<string>();
  const hits: CatalogueSearchHit[] = [];
  for (const row of rows) {
    if (occupiedIds.has(row.generationId) || seen.has(row.generationId)) continue;
    seen.add(row.generationId);
    hits.push({
      scope: "generation",
      applicabilityId: null,
      generationId: row.generationId,
      modelId: row.modelId,
      brandName: row.brandName,
      modelName: row.modelName,
      generationName: row.generationName,
      modelSlug: row.modelSlug,
      generationSlug: row.generationSlug,
      match: row.normalizedName === normalized ? "exact" : "prefix",
      synthetic: row.synthetic,
      href: catalogueContextHref({
        modelSlug: row.modelSlug,
        generationSlug: row.generationSlug,
      }),
    });
  }
  return hits;
}

function selfVisibleGenerationSql(access: CatalogueAccess, now: Date): SQL {
  const published = currentScopedProjectionCovers(catalogueGeneration.id, "generation", now);
  if (!access.allowFixtures) return published;
  return mustSql(
    or(
      published,
      and(
        eq(catalogueGeneration.publicationStatus, "fixture"),
        eq(catalogueGeneration.synthetic, true),
        eq(catalogueSourcePolicy.permitsPublicCatalogue, false),
        eq(catalogueSourcePolicy.audience, "private-preview"),
        eq(catalogueSourcePolicy.rightsReview, "reviewed"),
      ),
    ),
  );
}

function buildCatalogueSearch(db: Database, access: CatalogueAccess, normalized: string, now: Date) {
  const upper = prefixUpperBound(normalized);
  return db
    .select({
      applicabilityId: catalogueApplicability.id,
      generationId: catalogueGeneration.id,
      modelId: catalogueModel.id,
      normalizedName: catalogueAlias.normalizedName,
      aliasId: catalogueAlias.id,
      aliasKind: catalogueAlias.kind,
      brandName: catalogueBrand.name,
      modelName: catalogueModel.name,
      generationName: catalogueGeneration.name,
      modelSlug: catalogueModel.slug,
      generationSlug: catalogueGeneration.slug,
      salesMarketName: catalogueSalesMarket.name,
      salesMarketId: catalogueSalesMarket.id,
      countryCode: catalogueSalesMarket.countryCode,
      modelYearLabel: catalogueModelYear.label,
      modelYearId: catalogueModelYear.id,
      variantName: catalogueMarketVariant.name,
      variantId: catalogueMarketVariant.id,
      synthetic: catalogueApplicability.synthetic,
      policyName: catalogueSourcePolicy.name,
      policyAttribution: catalogueSourcePolicy.attribution,
    })
    .from(catalogueAlias)
    .innerJoin(
      catalogueApplicability,
      eq(catalogueAlias.applicabilityId, catalogueApplicability.id),
    )
    .innerJoin(
      catalogueSourcePolicy,
      eq(catalogueApplicability.sourcePolicyId, catalogueSourcePolicy.id),
    )
    .innerJoin(
      catalogueMarketVariant,
      eq(catalogueApplicability.marketVariantId, catalogueMarketVariant.id),
    )
    .innerJoin(catalogueGeneration, eq(catalogueMarketVariant.generationId, catalogueGeneration.id))
    .innerJoin(catalogueModel, eq(catalogueGeneration.modelId, catalogueModel.id))
    .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
    .innerJoin(
      catalogueSalesMarket,
      eq(catalogueApplicability.salesMarketId, catalogueSalesMarket.id),
    )
    .innerJoin(catalogueModelYear, eq(catalogueApplicability.modelYearId, catalogueModelYear.id))
    .where(
      and(
        // Range operators belong to text_pattern_ops, so a parameterized prefix can use the name index.
        sql`${catalogueAlias.normalizedName} ~>=~ ${normalized}`,
        sql`${catalogueAlias.normalizedName} ~<~ ${upper}`,
        visibleRecord(access, now),
      ),
    )
    .orderBy(
      sql`case when ${catalogueAlias.normalizedName} = ${normalized} then 0 else 1 end`,
      asc(catalogueApplicability.id),
      asc(catalogueAlias.id),
    )
    .limit(100);
}

function mustSql(condition: SQL | undefined): SQL {
  return condition ?? sql`false`;
}

function policyOf(row: {
  policyName: string | null;
  policyAudience: string | null;
  policyAttribution: string | null;
}): CataloguePolicy {
  return {
    name: row.policyName ?? "",
    audience: row.policyAudience ?? "",
    attribution: row.policyAttribution ?? "",
  };
}

function policyFromProjection(policy: CataloguePolicy, projection: PublicDetail): CataloguePolicy {
  return {
    name: projection.policyName ?? policy.name,
    audience: "public",
    attribution: projection.attribution,
    policyReviewerRef: projection.policyReviewerRef,
    factualReviewerRef: projection.factualReviewerRef,
    rightsReviewerRef: projection.rightsReviewerRef,
  };
}

function projectionMatchesIdentity(
  identity: { countryCode: string; modelYearLabel: string },
  projection: PublicDetail,
): boolean {
  return projection.policyName !== null &&
    CATALOGUE_IDENTITY_FIELDS.every((field) => projection.permittedFields.includes(field)) &&
    identity.countryCode === projection.salesMarket && identity.modelYearLabel === projection.modelYearLabel;
}

function projectionFacts(projection: PublicDetail, policy: CataloguePolicy): CatalogueFact[] {
  return projection.facts.map((fact) => {
    const unknown = fact.state === "unknown";
    return {
      property: fact.property,
      state: unknown ? "unknown" : "known",
      rawValue: unknown ? null : fact.rawValue,
      normalizedValue: unknown ? null : fact.normalizedValue,
      unit: unknown ? null : fact.unit,
      measurementStandard: unknown ? null : fact.standard,
      unknownReason: unknown ? fact.unknownReason : null,
      freshness: "current",
      curatedReason: null,
      conflict: null,
      sourceTitle: fact.sourceTitle ?? "",
      sourceUrl: fact.sourceUrl,
      observedOn: fact.observedAt,
      retrievedOn: fact.retrievedAt,
      reviewedOn: projection.reviewedAt,
      reviewStatus: "reviewed",
      policyName: policy.name,
      policyAudience: policy.audience,
      policyAttribution: policy.attribution,
      factualReviewerRef: fact.factualReviewerRef,
      rightsReviewerRef: fact.rightsReviewerRef,
    };
  });
}

function projectionPrices(
  projection: PublicDetail,
  policy: CataloguePolicy,
  salesMarketName: string,
): CataloguePriceReference[] {
  const price = projection.priceReference;
  if (!price) return [];
  const displayAmount = formatMinorUnits(price.amountMinor, price.currency, price.minorUnitExponent);
  if (displayAmount === null) return [];
  return [
    {
      kind: "price-reference",
      amountMinor: price.amountMinor,
      currency: price.currency,
      minorUnitExponent: price.minorUnitExponent,
      displayAmount,
      basis: price.basis,
      taxInclusivity: price.taxInclusivity,
      salesMarketName,
      observedOn: price.observedOn,
      retrievedOn: price.retrievedOn,
      reviewedOn: price.reviewedOn,
      reviewStatus: "reviewed",
      sourceTitle: price.sourceTitle,
      sourceUrl: price.sourceUrl,
      sourceIdentifier: price.sourceIdentifier,
      policyName: policy.name,
      policyAudience: policy.audience,
      policyAttribution: policy.attribution,
    },
  ];
}

function visibleRecord(access: CatalogueAccess, now: Date): SQL {
  const projected = mustSql(
    and(
      eq(catalogueApplicability.publicationStatus, "published"),
      eq(catalogueApplicability.synthetic, false),
      currentProjectionCovers(catalogueApplicability.id, now),
    ),
  );
  if (!access.allowFixtures) return projected;
  return mustSql(or(projected, fixtureRecord()));
}

function fixtureRecord(): SQL {
  return mustSql(
    and(
      eq(catalogueApplicability.publicationStatus, "fixture"),
      eq(catalogueApplicability.synthetic, true),
      eq(catalogueSourcePolicy.permitsPublicCatalogue, false),
      eq(catalogueSourcePolicy.audience, "private-preview"),
      eq(catalogueSourcePolicy.rightsReview, "reviewed"),
    ),
  );
}

async function readFacts(
  db: Database,
  access: CatalogueAccess,
  applicabilityId: string,
): Promise<CatalogueFact[]> {
  const factPolicy = catalogueSourcePolicy;
  const rows = await db
    .select({
      id: catalogueSourcedFact.id,
      property: catalogueSourcedFact.property,
      state: catalogueSourcedFact.state,
      rawValue: catalogueSourcedFact.rawValue,
      normalizedValue: catalogueSourcedFact.normalizedValue,
      unit: catalogueSourcedFact.unit,
      measurementStandard: catalogueSourcedFact.measurementStandard,
      unknownReason: catalogueSourcedFact.unknownReason,
      curatedReason: catalogueSourcedFact.curatedReason,
      freshness: catalogueSourcedFact.freshness,
      sourceTitle: catalogueSourcedFact.sourceTitle,
      sourceUrl: catalogueSourcedFact.sourceUrl,
      observedOn: catalogueSourcedFact.observedOn,
      retrievedOn: catalogueSourcedFact.retrievedOn,
      reviewedOn: catalogueSourcedFact.reviewedOn,
      reviewStatus: catalogueSourcedFact.reviewStatus,
      policyName: factPolicy.name,
      policyAudience: factPolicy.audience,
      policyAttribution: factPolicy.attribution,
      curated: catalogueSourcedFact.curated,
      conflictsWithFactId: catalogueSourcedFact.conflictsWithFactId,
      sortOrder: catalogueSourcedFact.sortOrder,
    })
    .from(catalogueSourcedFact)
    .innerJoin(factPolicy, eq(catalogueSourcedFact.sourcePolicyId, factPolicy.id))
    .where(and(eq(catalogueSourcedFact.applicabilityId, applicabilityId), visibleFact(access)))
    .orderBy(catalogueSourcedFact.sortOrder);

  const conflicts = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!row.curated && row.conflictsWithFactId) conflicts.set(row.conflictsWithFactId, row);
  }

  const assertion = (row: (typeof rows)[number]): CatalogueAssertion => ({
    rawValue: row.rawValue,
    normalizedValue: row.normalizedValue,
    unit: row.unit,
    measurementStandard: row.measurementStandard,
    sourceTitle: row.sourceTitle,
    sourceUrl: row.sourceUrl,
    observedOn: row.observedOn,
    retrievedOn: row.retrievedOn,
    reviewedOn: row.reviewedOn,
    reviewStatus: row.reviewStatus,
    policyName: row.policyName,
    policyAudience: row.policyAudience,
    policyAttribution: row.policyAttribution,
  });

  return rows
    .filter((row) => row.curated)
    .map((row) => {
      const conflict = conflicts.get(row.id);
      return {
        ...assertion(row),
        property: row.property,
        state: factState(row.state),
        freshness: factFreshness(row.freshness),
        unknownReason: row.unknownReason,
        curatedReason: row.curatedReason,
        conflict: conflict ? assertion(conflict) : null,
      };
    });
}

function visibleFact(access: CatalogueAccess): SQL {
  return visibleProjection(access, {
    publicationStatus: catalogueSourcedFact.publicationStatus,
    reviewStatus: catalogueSourcedFact.reviewStatus,
  });
}

async function readPrices(
  db: Database,
  access: CatalogueAccess,
  applicabilityId: string,
): Promise<CataloguePriceReference[]> {
  const rows = await db
    .select({
      amountMinor: cataloguePriceReference.amountMinor,
      currency: cataloguePriceReference.currency,
      minorUnitExponent: cataloguePriceReference.minorUnitExponent,
      basis: cataloguePriceReference.basis,
      taxInclusivity: cataloguePriceReference.taxInclusivity,
      observedOn: cataloguePriceReference.observedOn,
      retrievedOn: cataloguePriceReference.retrievedOn,
      reviewedOn: cataloguePriceReference.reviewedOn,
      reviewStatus: cataloguePriceReference.reviewStatus,
      sourceTitle: cataloguePriceReference.sourceTitle,
      sourceUrl: cataloguePriceReference.sourceUrl,
      sourceIdentifier: cataloguePriceReference.sourceIdentifier,
      policyName: catalogueSourcePolicy.name,
      policyAudience: catalogueSourcePolicy.audience,
      policyAttribution: catalogueSourcePolicy.attribution,
      salesMarketName: catalogueSalesMarket.name,
    })
    .from(cataloguePriceReference)
    .innerJoin(
      catalogueSourcePolicy,
      eq(cataloguePriceReference.sourcePolicyId, catalogueSourcePolicy.id),
    )
    .innerJoin(
      catalogueSalesMarket,
      eq(cataloguePriceReference.salesMarketId, catalogueSalesMarket.id),
    )
    .where(
      and(eq(cataloguePriceReference.applicabilityId, applicabilityId), visiblePrice(access)),
    );

  return rows.flatMap((row) => {
    const displayAmount = formatMinorUnits(row.amountMinor, row.currency, row.minorUnitExponent);
    if (displayAmount === null) return [];
    return [
      {
        kind: "price-reference" as const,
        amountMinor:
          typeof row.amountMinor === "number" ? row.amountMinor : Number(row.amountMinor),
        currency: row.currency,
        minorUnitExponent: row.minorUnitExponent,
        displayAmount,
        basis: row.basis,
        taxInclusivity: row.taxInclusivity,
        salesMarketName: row.salesMarketName,
        observedOn: row.observedOn,
        retrievedOn: row.retrievedOn,
        reviewedOn: row.reviewedOn,
        reviewStatus: row.reviewStatus,
        sourceTitle: row.sourceTitle,
        sourceUrl: row.sourceUrl,
        sourceIdentifier: row.sourceIdentifier,
        policyName: row.policyName,
        policyAudience: row.policyAudience,
        policyAttribution: row.policyAttribution,
      },
    ];
  });
}

function visiblePrice(access: CatalogueAccess): SQL {
  return visibleProjection(access, {
    publicationStatus: cataloguePriceReference.publicationStatus,
    reviewStatus: cataloguePriceReference.reviewStatus,
  });
}

function visibleProjection(
  access: CatalogueAccess,
  columns: {
    publicationStatus: Parameters<typeof eq>[0];
    reviewStatus?: Parameters<typeof eq>[0];
    synthetic?: Parameters<typeof eq>[0];
  },
): SQL {
  const reviewed = (status: "published" | "fixture") =>
    and(
      eq(columns.publicationStatus, status),
      columns.reviewStatus ? eq(columns.reviewStatus, "reviewed") : undefined,
      columns.synthetic ? eq(columns.synthetic, status === "published" ? false : true) : undefined,
      eq(catalogueSourcePolicy.permitsPublicCatalogue, status === "published"),
      eq(catalogueSourcePolicy.audience, status === "published" ? "public" : "private-preview"),
      eq(catalogueSourcePolicy.rightsReview, "reviewed"),
    );

  if (!access.allowFixtures) return mustSql(reviewed("published"));
  return mustSql(or(reviewed("published"), reviewed("fixture")));
}

function groupIndianDigits(whole: string): string {
  if (whole.length <= 3) return whole;
  const head = whole.slice(0, -3);
  const tail = whole.slice(-3);
  const parts: string[] = [];
  let rest = head;
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(",")},${tail}`;
}

function groupWesternDigits(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
