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
} from "@cart-campuss/db/schema/catalogue";
import type { Database } from "@cart-campuss/db";
import { and, asc, eq, or, sql, type SQL } from "drizzle-orm";

import type { CatalogueAccess } from "./context";

export type CatalogueSearchHit = {
  applicabilityId: string;
  brandName: string;
  modelName: string;
  generationName: string;
  modelSlug: string;
  generationSlug: string;
  salesMarketName: string;
  salesMarketId: string;
  modelYearLabel: string;
  modelYearId: string;
  variantName: string;
  variantId: string;
  match: "exact" | "prefix";
  synthetic: boolean;
  href: string;
};

export type CatalogueSearchResult = {
  query: string;
  privatePreview: boolean;
  hits: CatalogueSearchHit[];
};

export type CatalogueFact = {
  property: string;
  state: "known" | "unknown";
  rawValue: string | null;
  normalizedValue: string | null;
  unit: string | null;
  measurementStandard: string | null;
  unknownReason: string | null;
  curatedReason: string | null;
  sourceTitle: string;
  sourceUrl: string | null;
  observedOn: string | null;
  retrievedOn: string;
  reviewedOn: string | null;
  reviewStatus: string;
  policyName: string;
  policyAudience: string;
  policyAttribution: string;
  conflict: {
    rawValue: string | null;
    sourceTitle: string;
    observedOn: string | null;
    reviewStatus: string;
  } | null;
};

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
  reviewStatus: string;
  policyName: string;
};

export type CataloguePolicy = {
  name: string;
  audience: string;
  attribution: string;
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

export type CatalogueCarPage =
  | {
      availability: "visible";
      privatePreview: boolean;
      synthetic: boolean;
      identity: CatalogueIdentity;
      policy: CataloguePolicy;
      facts: CatalogueFact[];
      priceReference: CataloguePriceReference | null;
      marketLabel: "No market data";
    }
  | {
      availability: "overview";
      privatePreview: boolean;
      synthetic: boolean;
      policy: CataloguePolicy;
      identity: Pick<
        CatalogueIdentity,
        "brandName" | "modelName" | "generationName" | "modelSlug" | "generationSlug"
      >;
      selections: Array<{
        salesMarketName: string;
        modelYearLabel: string;
        variantName: string;
        href: string;
      }>;
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
};

export function normalizeCatalogueQuery(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

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
  const params = new URLSearchParams({
    market: input.salesMarketId,
    year: input.modelYearId,
    variant: input.variantId,
  });
  return `/cars/${input.modelSlug}/${input.generationSlug}?${params.toString()}`;
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

export function catalogueSearchStatement(db: Database, access: CatalogueAccess, query: string) {
  return buildCatalogueSearch(db, access, normalizeCatalogueQuery(query)).toSQL();
}

export async function searchCatalogue(
  db: Database,
  access: CatalogueAccess,
  query: string,
): Promise<CatalogueSearchResult> {
  const normalized = normalizeCatalogueQuery(query);
  if (!normalized) {
    return { query, privatePreview: access.allowFixtures, hits: [] };
  }
  const rows = await buildCatalogueSearch(db, access, normalized);

  const ranked = [...rows].sort((left, right) => {
    const leftRank = left.normalizedName === normalized ? 0 : 1;
    const rightRank = right.normalizedName === normalized ? 0 : 1;
    return (
      leftRank - rightRank ||
      left.applicabilityId.localeCompare(right.applicabilityId) ||
      left.aliasId.localeCompare(right.aliasId)
    );
  });

  const seen = new Set<string>();
  const hits: CatalogueSearchHit[] = [];
  for (const row of ranked) {
    if (seen.has(row.applicabilityId)) continue;
    seen.add(row.applicabilityId);
    hits.push({
      applicabilityId: row.applicabilityId,
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
): Promise<CatalogueCarPage> {
  const rows = await db
    .select({
      applicabilityId: catalogueApplicability.id,
      brandName: catalogueBrand.name,
      modelName: catalogueModel.name,
      generationName: catalogueGeneration.name,
      modelSlug: catalogueModel.slug,
      generationSlug: catalogueGeneration.slug,
      salesMarketName: catalogueSalesMarket.name,
      salesMarketId: catalogueSalesMarket.id,
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
    .from(catalogueGeneration)
    .innerJoin(catalogueModel, eq(catalogueGeneration.modelId, catalogueModel.id))
    .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
    .innerJoin(
      catalogueMarketVariant,
      eq(catalogueMarketVariant.generationId, catalogueGeneration.id),
    )
    .innerJoin(
      catalogueApplicability,
      eq(catalogueApplicability.marketVariantId, catalogueMarketVariant.id),
    )
    .innerJoin(
      catalogueSourcePolicy,
      eq(catalogueApplicability.sourcePolicyId, catalogueSourcePolicy.id),
    )
    .innerJoin(catalogueSalesMarket, eq(catalogueApplicability.salesMarketId, catalogueSalesMarket.id))
    .innerJoin(catalogueModelYear, eq(catalogueApplicability.modelYearId, catalogueModelYear.id))
    .where(
      and(
        eq(catalogueModel.slug, selection.modelSlug),
        eq(catalogueGeneration.slug, selection.generationSlug),
        visibleRecord(access),
      ),
    )
    .orderBy(asc(catalogueApplicability.id));

  const privatePreview = access.allowFixtures;
  if (rows.length === 0) {
    return { availability: "not-in-public-catalogue", privatePreview };
  }

  const selected =
    selection.market && selection.year && selection.variant
      ? rows.find(
          (row) =>
            row.salesMarketId === selection.market &&
            row.modelYearId === selection.year &&
            row.variantId === selection.variant,
        )
      : undefined;

  if (!selected) {
    const [first] = rows;
    if (!first) return { availability: "not-in-public-catalogue", privatePreview };
    return {
      availability: "overview",
      privatePreview,
      synthetic: rows.some((row) => row.synthetic),
      policy: policyOf(first),
      identity: {
        brandName: first.brandName,
        modelName: first.modelName,
        generationName: first.generationName,
        modelSlug: first.modelSlug,
        generationSlug: first.generationSlug,
      },
      selections: rows.map((row) => ({
        salesMarketName: row.salesMarketName,
        modelYearLabel: row.modelYearLabel,
        variantName: row.variantName,
        href: catalogueCarHref(row),
      })),
    };
  }

  const [facts, prices] = await Promise.all([
    readFacts(db, access, selected.applicabilityId),
    readPrices(db, access, selected.applicabilityId),
  ]);

  return {
    availability: "visible",
    privatePreview,
    synthetic: selected.synthetic,
    policy: policyOf(selected),
    identity: {
      brandName: selected.brandName,
      modelName: selected.modelName,
      generationName: selected.generationName,
      modelSlug: selected.modelSlug,
      generationSlug: selected.generationSlug,
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
  };
}

function buildCatalogueSearch(db: Database, access: CatalogueAccess, normalized: string) {
  const upper = prefixUpperBound(normalized);
  return db
    .select({
      applicabilityId: catalogueApplicability.id,
      normalizedName: catalogueAlias.normalizedName,
      aliasId: catalogueAlias.id,
      brandName: catalogueBrand.name,
      modelName: catalogueModel.name,
      generationName: catalogueGeneration.name,
      modelSlug: catalogueModel.slug,
      generationSlug: catalogueGeneration.slug,
      salesMarketName: catalogueSalesMarket.name,
      salesMarketId: catalogueSalesMarket.id,
      modelYearLabel: catalogueModelYear.label,
      modelYearId: catalogueModelYear.id,
      variantName: catalogueMarketVariant.name,
      variantId: catalogueMarketVariant.id,
      synthetic: catalogueApplicability.synthetic,
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
        visibleRecord(access),
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
  policyName: string;
  policyAudience: string;
  policyAttribution: string;
}): CataloguePolicy {
  return {
    name: row.policyName,
    audience: row.policyAudience,
    attribution: row.policyAttribution,
  };
}

function visibleRecord(access: CatalogueAccess): SQL {
  return visibleProjection(access, {
    publicationStatus: catalogueApplicability.publicationStatus,
    synthetic: catalogueApplicability.synthetic,
  });
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

  return rows
    .filter((row) => row.curated)
    .map((row) => {
      const conflict = conflicts.get(row.id);
      return {
        property: row.property,
        state: row.state === "unknown" ? "unknown" : "known",
        rawValue: row.rawValue,
        normalizedValue: row.normalizedValue,
        unit: row.unit,
        measurementStandard: row.measurementStandard,
        unknownReason: row.unknownReason,
        curatedReason: row.curatedReason,
        sourceTitle: row.sourceTitle,
        sourceUrl: row.sourceUrl,
        observedOn: row.observedOn,
        retrievedOn: row.retrievedOn,
        reviewedOn: row.reviewedOn,
        reviewStatus: row.reviewStatus,
        policyName: row.policyName,
        policyAudience: row.policyAudience,
        policyAttribution: row.policyAttribution,
        conflict: conflict
          ? {
              rawValue: conflict.rawValue,
              sourceTitle: conflict.sourceTitle,
              observedOn: conflict.observedOn,
              reviewStatus: conflict.reviewStatus,
            }
          : null,
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
      reviewStatus: cataloguePriceReference.reviewStatus,
      policyName: catalogueSourcePolicy.name,
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
        reviewStatus: row.reviewStatus,
        policyName: row.policyName,
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
