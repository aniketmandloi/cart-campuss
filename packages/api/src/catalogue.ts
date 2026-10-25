import {
  catalogueAlias,
  catalogueApplicability,
  catalogueBrand,
  catalogueGeneration,
  catalogueGenerationAlias,
  catalogueModelAlias,
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
import { and, asc, eq, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { normalizeCatalogueQuery } from "./catalogue-name";
import { CATALOGUE_PAGE_SIZE, catalogueListHref, type CatalogueListSelection } from "./catalogue-filters";
import type { CatalogueAccess } from "./context";
import {
  buildApplicabilitySelector,
  catalogueContextHref,
  catalogueModelHref,
  correctionIssueUrl,
  dossierModelSections,
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
  match: "exact" | "prefix" | "suggestion" | "listed";
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
    })
  | (CatalogueSearchIdentity & {
      scope: "model";
      applicabilityId: null;
      generationId: null;
    });

export type CatalogueChip = {
  dimension:
    | "brand"
    | "model"
    | "generation"
    | "year"
    | "market"
    | "body"
    | "powertrain"
    | "transmission"
    | "coverage";
  label: string;
  value: string;
  count: number;
  href: string;
  current: boolean;
};

export type CatalogueMiss = {
  publishedOn: string | null;
  brands: number;
  models: number;
  applicabilityRecords: number;
  publishedModels: Array<{ brandName: string; modelName: string; href: string }>;
};

export type CatalogueSearchResult = {
  query: string;
  privatePreview: boolean;
  hits: CatalogueSearchHit[];
  suggestions: CatalogueSearchHit[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  ambiguous: boolean;
  miss: CatalogueMiss | null;
  chips: CatalogueChip[];
  href: string;
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
  fetchedAt?: string | null;
  lastSuccessfulProviderSyncAt?: string | null;
  nextRecheckAt?: string | null;
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
  freshness?: "current" | "stale" | "not-checked";
  fetchedAt?: string | null;
  lastSuccessfulProviderSyncAt?: string | null;
  nextRecheckAt?: string | null;
};

export type CatalogueDirectoryEntry = {
  title: string;
  url: string;
  freshness: "current" | "stale" | "not-checked";
  lastReviewedAt: string | null;
  observedAt: string | null;
  fetchedAt: string | null;
  lastSuccessfulProviderSyncAt: string | null;
  nextRecheckAt: string | null;
};

export type CatalogueListing = {
  title: string;
  url: string;
  priceType: string;
  amountMinor: number | null;
  currency: string | null;
  displayAmount: string | null;
  observedAt: string;
  presentation: "active" | "unknown" | "historical" | "ended";
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

type ModelIdentity = Pick<CatalogueIdentity, "brandName" | "modelName" | "modelSlug">;

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
      marketLabel: "No market data" | "Search official and marketplace sources" | "No current listing" | "Market listings";
      marketDirectory?: CatalogueDirectoryEntry[];
      marketListings?: CatalogueListing[];
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
      availability: "scoped";
      scope: "model";
      identity: ModelIdentity;
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

type CatalogueCandidate = {
  hit: CatalogueSearchHit;
  brandSlug: string;
  modelSlug: string;
  generationSlug: string | null;
  yearId: string | null;
  marketId: string | null;
  body: string | null;
  powertrain: string | null;
  transmission: string | null;
};

function emptyAttributes(): Pick<CatalogueCandidate, "body" | "powertrain" | "transmission"> {
  return { body: null, powertrain: null, transmission: null };
}

function attributesFromFacts(
  facts: ReadonlyArray<{ property: string; state: string; normalizedValue: string | null }>,
): Pick<CatalogueCandidate, "body" | "powertrain" | "transmission"> {
  const read = (property: string) => {
    const fact = facts.find(
      (item) => item.property.toLowerCase() === property && item.state === "known" && item.normalizedValue,
    );
    return fact?.normalizedValue ? normalizeCatalogueQuery(fact.normalizedValue) : null;
  };
  return { body: read("body"), powertrain: read("powertrain"), transmission: read("transmission") };
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
  query: string | CatalogueListSelection,
  now: () => Date = () => new Date(),
): Promise<CatalogueSearchResult> {
  const request: CatalogueListSelection = typeof query === "string" ? { q: query } : query;
  const normalized = normalizeCatalogueQuery(request.q ?? "");
  const clock = now();
  const candidates = normalized
    ? await gatherNamedCandidates(db, access, normalized, clock)
    : await gatherBrowseCandidates(db, access, clock);
  const suggestions = normalized.length >= 3
    ? await gatherSuggestions(db, access, normalized, clock, candidates)
    : [];
  await fillSyntheticAttributes(db, [...candidates, ...suggestions]);
  const filtered = candidates.filter((candidate) => candidateMatches(candidate, request));
  const suggested = suggestions.filter((candidate) => candidateMatches(candidate, request));
  const page = request.page ?? 1;
  const start = (page - 1) * CATALOGUE_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(filtered.length / CATALOGUE_PAGE_SIZE));
  const contexts = new Set(
    filtered.flatMap((candidate) =>
      candidate.hit.scope === "applicability"
        ? [`${candidate.hit.generationId}|${candidate.hit.salesMarketId}|${candidate.hit.modelYearId}`]
        : [],
    ),
  );
  return {
    query: request.q ?? "",
    privatePreview: access.allowFixtures,
    hits: filtered.slice(start, start + CATALOGUE_PAGE_SIZE).map((candidate) => candidate.hit),
    suggestions: suggested.map((candidate) => candidate.hit),
    page,
    pageSize: CATALOGUE_PAGE_SIZE,
    total: filtered.length,
    pageCount,
    ambiguous: normalized.length > 0 && contexts.size > 1,
    miss: null,
    chips: chipsFor(candidates, request),
    href: catalogueListHref({ ...request, q: request.q ?? "", page }),
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
    ...(projection
      ? projectionMarket(projection)
      : { marketLabel: "No market data" as const }),
    productionClaims,
  };
}

export type ModelSelection = {
  modelSlug: string;
  section?: DossierSection;
  registration?: string;
};

export async function readCatalogueModel(
  db: Database,
  access: CatalogueAccess,
  selection: ModelSelection,
  now: () => Date = () => new Date(),
): Promise<CatalogueCarPage> {
  const privatePreview = access.allowFixtures;
  const clock = now();
  const section = parseDossierSection(selection.section);
  const located = await findModelBySlug(db, selection.modelSlug);
  if (!located) return { availability: "not-in-public-catalogue", privatePreview };
  const projection = await readPublishedCatalogueDetail(db, located.modelId, () => clock);
  if (
    !projection ||
    projection.identityScope !== "model" ||
    !["brand", "model"].every((field) => projection.permittedFields.includes(field))
  ) {
    return { availability: "not-in-public-catalogue", privatePreview };
  }
  const rows = await loadVisibleApplicability(db, access, located.modelId, clock);
  const generations = await listVisibleGenerations(db, access, located.modelId, rows, clock);
  if (rows.length > 0 || generations.length > 0) {
    return { availability: "not-in-public-catalogue", privatePreview };
  }
  const policy = policyFromProjection(
    { name: projection.policyName ?? "", audience: "public", attribution: projection.attribution },
    projection,
  );
  const requested = {
    market: null,
    year: null,
    variant: null,
    section,
    registration: selection.registration ?? null,
  };
  const pagePath = catalogueModelHref({
    modelSlug: located.modelSlug,
    section,
  });
  return {
    availability: "scoped",
    scope: "model",
    privatePreview,
    synthetic: false,
    policy,
    selector: buildApplicabilitySelector({
      modelSlug: located.modelSlug,
      generations: [],
      currentGenerationId: "",
      currentGenerationSlug: "",
      rows: [],
      requested,
    }),
    sections: dossierModelSections({
      modelSlug: located.modelSlug,
      section,
      registration: requested.registration,
    }),
    context: requested,
    rebadge: await readRebadge(db, access, located.rebadgeOfModelId, clock),
    aliases: projection.permittedFields.includes("alias") ? projection.aliases : [],
    image: imageFromMedia(projection.media[0], policy),
    correctionHref: correctionIssueUrl({
      brandName: located.brandName,
      modelName: located.modelName,
      generationName: "not selected",
      applicabilityId: null,
      salesMarketId: null,
      modelYearId: null,
      variantId: null,
      pagePath,
    }),
    identity: {
      brandName: located.brandName,
      modelName: located.modelName,
      modelSlug: located.modelSlug,
    },
    facts: projectionFacts(projection, policy),
    productionClaims: projectionProduction(projection, policy),
  };
}

async function findModelBySlug(
  db: Database,
  modelSlug: string,
): Promise<{ modelId: string; modelName: string; modelSlug: string; brandName: string; rebadgeOfModelId: string | null } | null> {
  const [row] = await db
    .select({
      modelId: catalogueModel.id,
      modelName: catalogueModel.name,
      modelSlug: catalogueModel.slug,
      brandName: catalogueBrand.name,
      rebadgeOfModelId: catalogueModel.rebadgeOfModelId,
    })
    .from(catalogueModel)
    .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
    .where(eq(catalogueModel.slug, modelSlug))
    .limit(1);
  return row ?? null;
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
  mode: "prefix" | "fuzzy" = "prefix",
): Promise<CatalogueCandidate[]> {
  const rows = await db
    .select({
      generationId: catalogueGeneration.id,
      generationName: catalogueGeneration.name,
      generationSlug: catalogueGeneration.slug,
      modelId: catalogueModel.id,
      modelName: catalogueModel.name,
      modelSlug: catalogueModel.slug,
      brandName: catalogueBrand.name,
      brandSlug: catalogueBrand.slug,
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
    .where(and(aliasNamePredicate(catalogueGenerationAlias.normalizedName, normalized, mode), selfVisibleGenerationSql(access, now)))
    .orderBy(...aliasNameOrder(catalogueGenerationAlias.normalizedName, catalogueGeneration.id, normalized, mode))
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
  const approvedNames = new Map<string, PublicDetail | null>();
  const candidates: CatalogueCandidate[] = [];
  for (const row of rows) {
    if (occupiedIds.has(row.generationId) || seen.has(row.generationId)) continue;
    if (!row.synthetic && !await currentScopedNameApproved(
      db,
      row.generationId,
      row.normalizedName,
      [row.brandName, row.modelName, row.generationName],
      now,
      approvedNames,
    )) continue;
    seen.add(row.generationId);
    candidates.push({
      hit: {
        scope: "generation",
        applicabilityId: null,
        generationId: row.generationId,
        modelId: row.modelId,
        brandName: row.brandName,
        modelName: row.modelName,
        generationName: row.generationName,
        modelSlug: row.modelSlug,
        generationSlug: row.generationSlug,
        match: nameMatch(mode, row.normalizedName, normalized),
        synthetic: row.synthetic,
        href: catalogueContextHref({
          modelSlug: row.modelSlug,
          generationSlug: row.generationSlug,
        }),
      },
      brandSlug: row.brandSlug,
      modelSlug: row.modelSlug,
      generationSlug: row.generationSlug,
      yearId: null,
      marketId: null,
      ...emptyAttributes(),
    });
  }
  return candidates;
}

async function searchBareModels(
  db: Database,
  access: CatalogueAccess,
  normalized: string,
  now: Date,
  mode: "prefix" | "fuzzy" = "prefix",
): Promise<CatalogueCandidate[]> {
  const rows = await db
    .select({
      modelId: catalogueModel.id,
      modelName: catalogueModel.name,
      modelSlug: catalogueModel.slug,
      brandName: catalogueBrand.name,
      brandSlug: catalogueBrand.slug,
      normalizedName: catalogueModelAlias.normalizedName,
    })
    .from(catalogueModelAlias)
    .innerJoin(catalogueModel, eq(catalogueModelAlias.modelId, catalogueModel.id))
    .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
    .where(
      and(
        aliasNamePredicate(catalogueModelAlias.normalizedName, normalized, mode),
        currentScopedProjectionCovers(catalogueModel.id, "model", now),
      ),
    )
    .orderBy(...aliasNameOrder(catalogueModelAlias.normalizedName, catalogueModel.id, normalized, mode))
    .limit(20);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.modelId);
  const generationRows = await db
    .select({ modelId: catalogueGeneration.modelId })
    .from(catalogueGeneration)
    .leftJoin(
      catalogueSourcePolicy,
      eq(catalogueGeneration.sourcePolicyId, catalogueSourcePolicy.id),
    )
    .where(and(inArray(catalogueGeneration.modelId, ids), selfVisibleGenerationSql(access, now)));
  const applicabilityRows = await db
    .select({ modelId: catalogueModel.id })
    .from(catalogueApplicability)
    .innerJoin(
      catalogueMarketVariant,
      eq(catalogueApplicability.marketVariantId, catalogueMarketVariant.id),
    )
    .innerJoin(catalogueGeneration, eq(catalogueMarketVariant.generationId, catalogueGeneration.id))
    .innerJoin(catalogueModel, eq(catalogueGeneration.modelId, catalogueModel.id))
    .innerJoin(
      catalogueSourcePolicy,
      eq(catalogueApplicability.sourcePolicyId, catalogueSourcePolicy.id),
    )
    .where(and(inArray(catalogueModel.id, ids), visibleRecord(access, now)));
  const occupied = new Set([
    ...generationRows.map((row) => row.modelId),
    ...applicabilityRows.map((row) => row.modelId),
  ]);
  const seen = new Set<string>();
  const approvedNames = new Map<string, PublicDetail | null>();
  const candidates: CatalogueCandidate[] = [];
  for (const row of rows) {
    if (occupied.has(row.modelId) || seen.has(row.modelId)) continue;
    if (!await currentScopedNameApproved(
      db,
      row.modelId,
      row.normalizedName,
      [row.brandName, row.modelName],
      now,
      approvedNames,
    )) continue;
    seen.add(row.modelId);
    candidates.push({
      hit: {
        scope: "model",
        applicabilityId: null,
        generationId: null,
        modelId: row.modelId,
        brandName: row.brandName,
        modelName: row.modelName,
        modelSlug: row.modelSlug,
        match: nameMatch(mode, row.normalizedName, normalized),
        synthetic: false,
        href: catalogueModelHref({ modelSlug: row.modelSlug }),
      },
      brandSlug: row.brandSlug,
      modelSlug: row.modelSlug,
      generationSlug: null,
      yearId: null,
      marketId: null,
      ...emptyAttributes(),
    });
  }
  return candidates;
}

async function currentScopedNameApproved(
  db: Database,
  subjectId: string,
  normalizedName: string,
  canonicalNames: string[],
  now: Date,
  cache: Map<string, PublicDetail | null>,
): Promise<boolean> {
  if (!cache.has(subjectId)) {
    cache.set(subjectId, await readPublishedCatalogueDetail(db, subjectId, () => now));
  }
  const projection = cache.get(subjectId);
  if (!projection) return false;
  if (canonicalNames.some((name) => normalizeCatalogueQuery(name) === normalizedName)) return true;
  return projection.permittedFields.includes("alias") &&
    projection.aliases.some((alias) => normalizeCatalogueQuery(alias) === normalizedName);
}

export function applicabilityIsVisible(access: CatalogueAccess, now: Date): SQL {
  return visibleRecord(access, now);
}

export function generationIsVisible(access: CatalogueAccess, now: Date): SQL {
  return selfVisibleGenerationSql(access, now);
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

function buildCatalogueSearch(
  db: Database,
  access: CatalogueAccess,
  normalized: string,
  now: Date,
  mode: "prefix" | "fuzzy" = "prefix",
) {
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
      brandSlug: catalogueBrand.slug,
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
    .where(and(aliasNamePredicate(catalogueAlias.normalizedName, normalized, mode), visibleRecord(access, now)))
    .orderBy(
      ...aliasNameOrder(catalogueAlias.normalizedName, catalogueApplicability.id, normalized, mode),
      asc(catalogueAlias.id),
    )
    .limit(100);
}

function aliasNamePredicate(column: AnyColumn, normalized: string, mode: "prefix" | "fuzzy"): SQL {
  const upper = prefixUpperBound(normalized);
  if (mode === "prefix") {
    return mustSql(
      and(
        // Range operators belong to text_pattern_ops, so a parameterized prefix can use the name index.
        sql`${column} ~>=~ ${normalized}`,
        sql`${column} ~<~ ${upper}`,
      ),
    );
  }
  return mustSql(
    and(
      sql`${column} operator(public.%) ${normalized}`,
      sql`not (${column} ~>=~ ${normalized} and ${column} ~<~ ${upper})`,
    ),
  );
}

function aliasNameOrder(column: AnyColumn, idColumn: AnyColumn, normalized: string, mode: "prefix" | "fuzzy") {
  if (mode === "fuzzy") {
    return [sql`public.similarity(${column}, ${normalized}) desc`, asc(idColumn)] as const;
  }
  return [sql`case when ${column} = ${normalized} then 0 else 1 end`, asc(idColumn)] as const;
}

function nameMatch(
  mode: "prefix" | "fuzzy",
  normalizedName: string,
  normalized: string,
): CatalogueSearchHit["match"] {
  if (mode === "fuzzy") return "suggestion";
  return normalizedName === normalized ? "exact" : "prefix";
}

async function gatherNamedCandidates(
  db: Database,
  access: CatalogueAccess,
  normalized: string,
  now: Date,
): Promise<CatalogueCandidate[]> {
  const rows = await buildCatalogueSearch(db, access, normalized, now, "prefix");
  const candidates = await approveApplicabilityRows(db, rows, now, normalized, "prefix");
  candidates.push(...(await searchBareGenerations(db, access, normalized, now, "prefix")));
  const seenModels = new Set(candidates.map((candidate) => candidate.hit.modelId));
  for (const candidate of await searchBareModels(db, access, normalized, now, "prefix")) {
    if (seenModels.has(candidate.hit.modelId)) continue;
    seenModels.add(candidate.hit.modelId);
    candidates.push(candidate);
  }
  return candidates;
}

async function gatherSuggestions(
  db: Database,
  access: CatalogueAccess,
  normalized: string,
  now: Date,
  existing: CatalogueCandidate[],
): Promise<CatalogueCandidate[]> {
  const seen = new Set(existing.map(identityKey));
  const rows = await buildCatalogueSearch(db, access, normalized, now, "fuzzy");
  const found = [
    ...(await approveApplicabilityRows(db, rows, now, normalized, "fuzzy")),
    ...(await searchBareGenerations(db, access, normalized, now, "fuzzy")),
    ...(await searchBareModels(db, access, normalized, now, "fuzzy")),
  ];
  const suggestions: CatalogueCandidate[] = [];
  for (const candidate of found) {
    const key = identityKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push(candidate);
  }
  return suggestions;
}

async function approveApplicabilityRows(
  db: Database,
  rows: Awaited<ReturnType<typeof buildCatalogueSearch>>,
  now: Date,
  normalized: string,
  mode: "prefix" | "fuzzy",
): Promise<CatalogueCandidate[]> {
  const seen = new Set<string>();
  const candidates: CatalogueCandidate[] = [];
  for (const row of rows) {
    if (seen.has(row.applicabilityId)) continue;
    if (!row.synthetic && !publicMetadataEligible(stringValues(row))) continue;
    let attributes = emptyAttributes();
    if (!row.synthetic) {
      const projection = await readPublishedCatalogueDetail(db, row.applicabilityId, () => now);
      if (!projection || !projectionMatchesIdentity(row, projection)) continue;
      const canonicalName = [
        { kind: "brand", name: row.brandName },
        { kind: "model", name: row.modelName },
        { kind: "generation", name: row.generationName },
      ].some((item) => item.kind === row.aliasKind && normalizeCatalogueQuery(item.name) === row.normalizedName);
      const approvedAlias =
        projection.permittedFields.includes("alias") &&
        projection.aliases.some((alias) => normalizeCatalogueQuery(alias) === row.normalizedName);
      if (!canonicalName && !approvedAlias) continue;
      attributes = attributesFromFacts(projection.facts);
    }
    seen.add(row.applicabilityId);
    candidates.push({
      hit: {
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
        match: nameMatch(mode, row.normalizedName, normalized),
        synthetic: row.synthetic,
        href: catalogueCarHref(row),
      },
      brandSlug: row.brandSlug,
      modelSlug: row.modelSlug,
      generationSlug: row.generationSlug,
      yearId: row.modelYearId,
      marketId: row.salesMarketId,
      ...attributes,
    });
  }
  return candidates;
}

async function gatherBrowseCandidates(
  db: Database,
  access: CatalogueAccess,
  now: Date,
): Promise<CatalogueCandidate[]> {
  const rows = await db
    .select({
      applicabilityId: catalogueApplicability.id,
      generationId: catalogueGeneration.id,
      modelId: catalogueModel.id,
      brandName: catalogueBrand.name,
      brandSlug: catalogueBrand.slug,
      modelName: catalogueModel.name,
      modelSlug: catalogueModel.slug,
      generationName: catalogueGeneration.name,
      generationSlug: catalogueGeneration.slug,
      salesMarketName: catalogueSalesMarket.name,
      salesMarketId: catalogueSalesMarket.id,
      countryCode: catalogueSalesMarket.countryCode,
      modelYearLabel: catalogueModelYear.label,
      modelYearId: catalogueModelYear.id,
      variantName: catalogueMarketVariant.name,
      variantId: catalogueMarketVariant.id,
      synthetic: catalogueApplicability.synthetic,
    })
    .from(catalogueApplicability)
    .innerJoin(catalogueSourcePolicy, eq(catalogueApplicability.sourcePolicyId, catalogueSourcePolicy.id))
    .innerJoin(catalogueMarketVariant, eq(catalogueApplicability.marketVariantId, catalogueMarketVariant.id))
    .innerJoin(catalogueGeneration, eq(catalogueMarketVariant.generationId, catalogueGeneration.id))
    .innerJoin(catalogueModel, eq(catalogueGeneration.modelId, catalogueModel.id))
    .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
    .innerJoin(catalogueSalesMarket, eq(catalogueApplicability.salesMarketId, catalogueSalesMarket.id))
    .innerJoin(catalogueModelYear, eq(catalogueApplicability.modelYearId, catalogueModelYear.id))
    .where(visibleRecord(access, now))
    .orderBy(asc(catalogueApplicability.id))
    .limit(500);
  const candidates: CatalogueCandidate[] = [];
  for (const row of rows) {
    if (!row.synthetic && !publicMetadataEligible(stringValues(row))) continue;
    let attributes = emptyAttributes();
    if (!row.synthetic) {
      const projection = await readPublishedCatalogueDetail(db, row.applicabilityId, () => now);
      if (!projection || !projectionMatchesIdentity(row, projection)) continue;
      attributes = attributesFromFacts(projection.facts);
    }
    candidates.push({
      hit: {
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
        match: "listed",
        synthetic: row.synthetic,
        href: catalogueCarHref(row),
      },
      brandSlug: row.brandSlug,
      modelSlug: row.modelSlug,
      generationSlug: row.generationSlug,
      yearId: row.modelYearId,
      marketId: row.salesMarketId,
      ...attributes,
    });
  }
  const occupied = new Set(candidates.map((candidate) => candidate.hit.generationId).filter((id): id is string => id !== null));
  const generations = await db
    .select({
      generationId: catalogueGeneration.id,
      generationName: catalogueGeneration.name,
      generationSlug: catalogueGeneration.slug,
      modelId: catalogueModel.id,
      modelName: catalogueModel.name,
      modelSlug: catalogueModel.slug,
      brandName: catalogueBrand.name,
      brandSlug: catalogueBrand.slug,
      synthetic: catalogueGeneration.synthetic,
    })
    .from(catalogueGeneration)
    .innerJoin(catalogueModel, eq(catalogueGeneration.modelId, catalogueModel.id))
    .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
    .leftJoin(catalogueSourcePolicy, eq(catalogueGeneration.sourcePolicyId, catalogueSourcePolicy.id))
    .where(selfVisibleGenerationSql(access, now))
    .orderBy(asc(catalogueGeneration.id))
    .limit(500);
  for (const row of generations) {
    if (occupied.has(row.generationId) || !publicMetadataEligible(stringValues(row))) continue;
    occupied.add(row.generationId);
    candidates.push({
      hit: {
        scope: "generation",
        applicabilityId: null,
        generationId: row.generationId,
        modelId: row.modelId,
        brandName: row.brandName,
        modelName: row.modelName,
        generationName: row.generationName,
        modelSlug: row.modelSlug,
        generationSlug: row.generationSlug,
        match: "listed",
        synthetic: row.synthetic,
        href: catalogueContextHref({ modelSlug: row.modelSlug, generationSlug: row.generationSlug }),
      },
      brandSlug: row.brandSlug,
      modelSlug: row.modelSlug,
      generationSlug: row.generationSlug,
      yearId: null,
      marketId: null,
      ...emptyAttributes(),
    });
  }
  const occupiedModels = new Set(candidates.map((candidate) => candidate.hit.modelId));
  const models = await db
    .select({
      modelId: catalogueModel.id,
      modelName: catalogueModel.name,
      modelSlug: catalogueModel.slug,
      brandName: catalogueBrand.name,
      brandSlug: catalogueBrand.slug,
    })
    .from(catalogueModel)
    .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
    .where(currentScopedProjectionCovers(catalogueModel.id, "model", now))
    .orderBy(asc(catalogueModel.id))
    .limit(500);
  for (const row of models) {
    if (occupiedModels.has(row.modelId) || !publicMetadataEligible(stringValues(row))) continue;
    occupiedModels.add(row.modelId);
    candidates.push({
      hit: {
        scope: "model",
        applicabilityId: null,
        generationId: null,
        modelId: row.modelId,
        brandName: row.brandName,
        modelName: row.modelName,
        modelSlug: row.modelSlug,
        match: "listed",
        synthetic: false,
        href: catalogueModelHref({ modelSlug: row.modelSlug }),
      },
      brandSlug: row.brandSlug,
      modelSlug: row.modelSlug,
      generationSlug: null,
      yearId: null,
      marketId: null,
      ...emptyAttributes(),
    });
  }
  return candidates;
}

async function fillSyntheticAttributes(db: Database, candidates: CatalogueCandidate[]): Promise<void> {
  const ids = candidates.flatMap((candidate) =>
    candidate.hit.scope === "applicability" && candidate.hit.synthetic ? [candidate.hit.applicabilityId] : [],
  );
  if (ids.length === 0) return;
  const rows = await db
    .select({
      applicabilityId: catalogueSourcedFact.applicabilityId,
      property: catalogueSourcedFact.property,
      normalizedValue: catalogueSourcedFact.normalizedValue,
      state: catalogueSourcedFact.state,
    })
    .from(catalogueSourcedFact)
    .where(
      and(
        inArray(catalogueSourcedFact.applicabilityId, ids),
        eq(catalogueSourcedFact.curated, true),
        eq(catalogueSourcedFact.state, "known"),
      ),
    );
  const grouped = new Map<string, { property: string; state: string; normalizedValue: string | null }[]>();
  for (const row of rows) {
    const list = grouped.get(row.applicabilityId) ?? [];
    list.push(row);
    grouped.set(row.applicabilityId, list);
  }
  for (const candidate of candidates) {
    if (candidate.hit.scope !== "applicability" || !candidate.hit.synthetic) continue;
    const facts = grouped.get(candidate.hit.applicabilityId);
    if (!facts) continue;
    Object.assign(candidate, attributesFromFacts(facts));
  }
}

function candidateMatches(candidate: CatalogueCandidate, request: CatalogueListSelection): boolean {
  if (request.brand && candidate.brandSlug !== request.brand) return false;
  if (request.model && candidate.modelSlug !== request.model) return false;
  if (request.generation && candidate.generationSlug !== request.generation) return false;
  if (request.year && candidate.yearId !== request.year) return false;
  if (request.market && candidate.marketId !== request.market) return false;
  if (request.coverage && candidate.hit.scope !== request.coverage) return false;
  if (request.body && candidate.body !== normalizeCatalogueQuery(request.body)) return false;
  if (request.powertrain && candidate.powertrain !== normalizeCatalogueQuery(request.powertrain)) return false;
  if (request.transmission && candidate.transmission !== normalizeCatalogueQuery(request.transmission)) return false;
  return true;
}

function chipSelection(
  request: CatalogueListSelection,
  chip: { dimension: CatalogueChip["dimension"]; value: string },
  current: boolean,
): CatalogueListSelection {
  const next: CatalogueListSelection = { ...request, page: undefined };
  if (current) {
    delete next[chip.dimension];
    return next;
  }
  switch (chip.dimension) {
    case "coverage":
      if (chip.value === "applicability" || chip.value === "generation" || chip.value === "model") {
        return { ...next, coverage: chip.value };
      }
      return next;
    case "brand":
      return { ...next, brand: chip.value };
    case "model":
      return { ...next, model: chip.value };
    case "generation":
      return { ...next, generation: chip.value };
    case "year":
      return { ...next, year: chip.value };
    case "market":
      return { ...next, market: chip.value };
    case "body":
      return { ...next, body: chip.value };
    case "powertrain":
      return { ...next, powertrain: chip.value };
    case "transmission":
      return { ...next, transmission: chip.value };
  }
}

function chipsFor(candidates: CatalogueCandidate[], request: CatalogueListSelection): CatalogueChip[] {
  const grouped = new Map<string, { dimension: CatalogueChip["dimension"]; value: string; label: string; count: number }>();
  for (const candidate of candidates) {
    for (const chip of chipValues(candidate)) {
      const key = `${chip.dimension}:${chip.value}`;
      const existing = grouped.get(key);
      if (existing) existing.count += 1;
      else grouped.set(key, { ...chip, count: 1 });
    }
  }
  return [...grouped.values()]
    .sort(
      (left, right) =>
        CHIP_ORDER.indexOf(left.dimension) - CHIP_ORDER.indexOf(right.dimension) ||
        left.label.localeCompare(right.label) ||
        left.value.localeCompare(right.value),
    )
    .map((chip) => {
      const current = request[chip.dimension] === chip.value;
      return { ...chip, current, href: catalogueListHref(chipSelection(request, chip, current)) };
    });
}

const CHIP_ORDER = [
  "brand",
  "model",
  "generation",
  "year",
  "market",
  "body",
  "powertrain",
  "transmission",
  "coverage",
] as const;

function chipValues(
  candidate: CatalogueCandidate,
): Array<{ dimension: CatalogueChip["dimension"]; value: string; label: string }> {
  const chips: Array<{ dimension: CatalogueChip["dimension"]; value: string; label: string }> = [
    { dimension: "brand", value: candidate.brandSlug, label: candidate.hit.brandName },
    { dimension: "model", value: candidate.modelSlug, label: candidate.hit.modelName },
    {
      dimension: "coverage",
      value: candidate.hit.scope,
      label:
        candidate.hit.scope === "applicability"
          ? "Applicability record"
          : candidate.hit.scope === "generation"
            ? "Generation record"
            : "Model record",
    },
  ];
  if (candidate.hit.scope !== "model" && candidate.generationSlug) {
    chips.push({ dimension: "generation", value: candidate.generationSlug, label: candidate.hit.generationName });
  }
  if (candidate.hit.scope === "applicability" && candidate.yearId && candidate.marketId) {
    chips.push({ dimension: "year", value: candidate.yearId, label: candidate.hit.modelYearLabel });
    chips.push({ dimension: "market", value: candidate.marketId, label: candidate.hit.salesMarketName });
  }
  if (candidate.body) chips.push({ dimension: "body", value: candidate.body, label: candidate.body });
  if (candidate.powertrain) chips.push({ dimension: "powertrain", value: candidate.powertrain, label: candidate.powertrain });
  if (candidate.transmission) {
    chips.push({ dimension: "transmission", value: candidate.transmission, label: candidate.transmission });
  }
  return chips;
}

function identityKey(candidate: CatalogueCandidate): string {
  const hit = candidate.hit;
  if (hit.scope === "applicability") return `applicability:${hit.applicabilityId}`;
  if (hit.scope === "generation") return `generation:${hit.generationId}`;
  return `model:${hit.modelId}`;
}

function stringValues(row: object): string[] {
  return Object.values(row).filter((value) => typeof value === "string");
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
    const valued = fact.state === "known";
    const recheck = projection.rechecks.find(
      (item) => item.kind === "editorial-specification" && item.targetKey === fact.property,
    );
    return {
      property: fact.property,
      state: factState(fact.state),
      rawValue: valued && fact.rawValue ? fact.rawValue : null,
      normalizedValue: valued ? fact.normalizedValue : null,
      unit: valued ? fact.unit : null,
      measurementStandard: valued ? fact.standard : null,
      unknownReason: valued ? null : fact.unknownReason,
      freshness: recheck ? recheck.freshness : factFreshness(fact.freshness),
      fetchedAt: recheck?.fetchedAt ?? null,
      lastSuccessfulProviderSyncAt: recheck?.lastSuccessfulProviderSyncAt ?? null,
      nextRecheckAt: recheck?.nextRecheckAt ?? null,
      curatedReason: fact.curatedReason,
      conflict:
        fact.conflict && (fact.state === "known" || fact.state === "unknown")
          ? {
              rawValue: fact.conflict.rawValue,
              normalizedValue: fact.conflict.normalizedValue,
              unit: fact.conflict.unit,
              measurementStandard: fact.conflict.standard,
              sourceTitle: fact.conflict.sourceTitle ?? "",
              sourceUrl: fact.conflict.sourceUrl,
              observedOn: fact.conflict.observedAt,
              retrievedOn: fact.conflict.retrievedAt,
              reviewedOn: projection.reviewedAt,
              reviewStatus: "reviewed",
              policyName: policy.name,
              policyAudience: policy.audience,
              policyAttribution: policy.attribution,
              factualReviewerRef: fact.conflict.factualReviewerRef,
              rightsReviewerRef: fact.conflict.rightsReviewerRef,
            }
          : null,
      sourceTitle: fact.sourceTitle ?? "",
      sourceUrl: fact.sourceUrl,
      observedOn: fact.observedAt,
      retrievedOn: fact.retrievedAt,
      reviewedOn: recheck?.lastReviewedAt ?? projection.reviewedAt,
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
  const recheck = projection.rechecks.find((item) => item.kind === "model-price");
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
      reviewedOn: recheck?.lastReviewedAt ?? price.reviewedOn,
      reviewStatus: "reviewed",
      sourceTitle: price.sourceTitle,
      sourceUrl: price.sourceUrl,
      sourceIdentifier: price.sourceIdentifier,
      policyName: policy.name,
      policyAudience: policy.audience,
      policyAttribution: policy.attribution,
      freshness: recheck?.freshness,
      fetchedAt: recheck?.fetchedAt,
      lastSuccessfulProviderSyncAt: recheck?.lastSuccessfulProviderSyncAt,
      nextRecheckAt: recheck?.nextRecheckAt,
    },
  ];
}

function projectionMarket(projection: PublicDetail): {
  marketLabel: "No market data" | "Search official and marketplace sources" | "No current listing" | "Market listings";
  marketDirectory: CatalogueDirectoryEntry[];
  marketListings: CatalogueListing[];
} {
  const access = projection.marketAccess;
  const marketDirectory = (access?.sourceDirectory ?? []).map((entry) => {
    const recheck = projection.rechecks.find(
      (item) => item.kind === "source-directory-url" && item.targetKey === entry.url,
    );
    return {
      title: entry.title,
      url: entry.url,
      freshness: recheck?.freshness ?? "current",
      lastReviewedAt: recheck?.lastReviewedAt ?? entry.reviewedAt,
      observedAt: recheck?.observedAt ?? entry.observedAt,
      fetchedAt: recheck?.fetchedAt ?? entry.retrievedAt,
      lastSuccessfulProviderSyncAt: recheck?.lastSuccessfulProviderSyncAt ?? null,
      nextRecheckAt: recheck?.nextRecheckAt ?? null,
    };
  });
  const marketListings = (access?.listings ?? []).map((listing) => {
    const recheck = projection.rechecks.find(
      (item) => item.kind === "approved-feed" && item.targetKey === listing.externalId,
    );
    const displayAmount =
      listing.amountMinor !== null && listing.currency && listing.minorUnitExponent !== null
        ? formatMinorUnits(listing.amountMinor, listing.currency, listing.minorUnitExponent)
        : null;
    return {
      title: listing.title,
      url: listing.url,
      priceType: listing.priceType,
      amountMinor: listing.amountMinor,
      currency: listing.currency,
      displayAmount,
      observedAt: recheck?.observedAt ?? listing.observedAt,
      presentation: listingPresentation(listing.lifecycle, recheck),
    };
  });
  const live = marketListings.some((listing) => listing.presentation === "active" || listing.presentation === "unknown" || listing.presentation === "ended");
  const marketLabel = marketDirectory.length > 0
    ? "Search official and marketplace sources"
    : live
      ? "Market listings"
      : marketListings.length > 0
        ? "No current listing"
        : "No market data";
  return { marketLabel, marketDirectory, marketListings };
}

function listingPresentation(
  lifecycle: "active" | "ended" | "unknown",
  recheck: PublicDetail["rechecks"][number] | undefined,
): CatalogueListing["presentation"] {
  if (!recheck) {
    if (lifecycle === "ended") return "ended";
    if (lifecycle === "unknown") return "unknown";
    return "active";
  }
  if (recheck.lifecycle === "ended" && recheck.providerOutcome === "succeeded") return "ended";
  if (recheck.providerOutcome === "failed" && !recheck.suppressed && recheck.freshness !== "stale") return "unknown";
  if (recheck.freshness === "stale" || recheck.freshness === "not-checked" || recheck.suppressed) return "historical";
  if (recheck.lifecycle === "unknown" || lifecycle === "unknown") return "unknown";
  return "active";
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
