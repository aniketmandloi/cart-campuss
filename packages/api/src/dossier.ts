export const DOSSIER_SECTIONS = ["overview", "specs", "market", "cost", "sources"] as const;

export type DossierSection = (typeof DOSSIER_SECTIONS)[number];

const SECTION_LABELS: Record<DossierSection, string> = {
  overview: "Overview",
  specs: "Specs",
  market: "Market",
  cost: "India cost",
  sources: "Sources",
};

export type DossierLink = {
  id: string;
  label: string;
  href: string;
  current: boolean;
};

export type DossierRecordLink = DossierLink & {
  detail: string;
};

export function parseDossierSection(value: string | undefined): DossierSection {
  if (value === "specs" || value === "market" || value === "cost" || value === "sources") return value;
  return "overview";
}

export function catalogueContextHref(input: {
  modelSlug: string;
  generationSlug: string;
  market?: string | null;
  year?: string | null;
  variant?: string | null;
  section?: DossierSection | null;
  registration?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.market) params.set("market", input.market);
  if (input.year) params.set("year", input.year);
  if (input.variant) params.set("variant", input.variant);
  if (input.section && input.section !== "overview") params.set("section", input.section);
  if (input.registration) params.set("registration", input.registration);
  const query = params.toString();
  const path = `/cars/${input.modelSlug}/${input.generationSlug}`;
  return query ? `${path}?${query}` : path;
}

export function dossierSections(input: {
  modelSlug: string;
  generationSlug: string;
  market?: string | null;
  year?: string | null;
  variant?: string | null;
  section?: DossierSection | null;
  registration?: string | null;
}): DossierLink[] {
  const section = input.section ?? "overview";
  return DOSSIER_SECTIONS.map((id) => ({
    id,
    label: SECTION_LABELS[id],
    href: `${catalogueContextHref({ ...input, section: id })}#${id}`,
    current: section === id,
  }));
}

/**
 * Public correction prefill. The body is identity and the catalogue address.
 * Registration and finance inputs are omitted on purpose.
 */
export function correctionIssueUrl(input: {
  brandName: string;
  modelName: string;
  generationName: string;
  applicabilityId: string | null;
  salesMarketId: string | null;
  modelYearId: string | null;
  variantId: string | null;
  pagePath: string;
}): string {
  const lines = [
    "Public catalogue correction",
    "",
    `Brand: ${input.brandName}`,
    `Model: ${input.modelName}`,
    `Generation: ${input.generationName}`,
    `Applicability: ${input.applicabilityId ?? "not selected"}`,
  ];
  if (input.salesMarketId) lines.push(`Sales market: ${input.salesMarketId}`);
  if (input.modelYearId) lines.push(`Model year: ${input.modelYearId}`);
  if (input.variantId) lines.push(`Market variant: ${input.variantId}`);
  lines.push(`Page: ${input.pagePath}`);
  const url = new URL("https://github.com/aniketmandloi/cart-campuss/issues/new");
  url.searchParams.set(
    "title",
    `Correction: ${input.brandName} ${input.modelName} ${input.generationName}`,
  );
  url.searchParams.set("body", lines.join("\n"));
  return url.toString();
}

export type ApplicabilityChoice = {
  generationId: string;
  generationSlug: string;
  generationName: string;
  salesMarketId: string;
  salesMarketName: string;
  modelYearId: string;
  modelYearLabel: string;
  modelYearConvention: string;
  variantId: string;
  variantName: string;
};

export function buildApplicabilitySelector(input: {
  modelSlug: string;
  generations: Array<{ id: string; name: string; slug: string }>;
  currentGenerationId: string;
  currentGenerationSlug: string;
  rows: ApplicabilityChoice[];
  requested: {
    market?: string | null;
    year?: string | null;
    variant?: string | null;
    section: DossierSection;
    registration?: string | null;
  };
}): {
  generations: DossierLink[];
  markets: DossierLink[];
  years: DossierLink[];
  variants: DossierLink[];
  records: DossierRecordLink[];
} {
  const section = input.requested.section;
  const registration = input.requested.registration;
  const here = input.rows.filter((row) => row.generationId === input.currentGenerationId);
  const market = input.requested.market ?? null;
  const year = input.requested.year ?? null;

  const generations = input.generations.map((generation) => ({
    id: generation.id,
    label: generation.name,
    href: catalogueContextHref({
      modelSlug: input.modelSlug,
      generationSlug: generation.slug,
      section,
      registration,
    }),
    current: generation.id === input.currentGenerationId,
  }));

  const markets = unique(here, (row) => row.salesMarketId).map((row) => ({
    id: row.salesMarketId,
    label: row.salesMarketName,
    href: catalogueContextHref({
      modelSlug: input.modelSlug,
      generationSlug: input.currentGenerationSlug,
      market: row.salesMarketId,
      section,
      registration,
    }),
    current: market === row.salesMarketId,
  }));

  const yearRows = market ? here.filter((row) => row.salesMarketId === market) : here;
  const years = unique(yearRows, (row) => `${row.salesMarketId}:${row.modelYearId}`).map((row) => ({
    id: row.modelYearId,
    label: market ? row.modelYearLabel : `${row.salesMarketName} · ${row.modelYearLabel}`,
    href: catalogueContextHref({
      modelSlug: input.modelSlug,
      generationSlug: input.currentGenerationSlug,
      market: row.salesMarketId,
      year: row.modelYearId,
      section,
      registration,
    }),
    current: market === row.salesMarketId && year === row.modelYearId,
  }));

  const variantRows =
    market && year
      ? here.filter((row) => row.salesMarketId === market && row.modelYearId === year)
      : here;
  const variants = variantRows.map((row) => ({
    id: row.variantId,
    label:
      market && year ? row.variantName : `${row.salesMarketName} · ${row.modelYearLabel} · ${row.variantName}`,
    href: catalogueContextHref({
      modelSlug: input.modelSlug,
      generationSlug: input.currentGenerationSlug,
      market: row.salesMarketId,
      year: row.modelYearId,
      variant: row.variantId,
      section,
      registration,
    }),
    current:
      market === row.salesMarketId && year === row.modelYearId && input.requested.variant === row.variantId,
  }));

  const records = here.map((row) => ({
    id: `${row.salesMarketId}:${row.modelYearId}:${row.variantId}`,
    label: `${row.salesMarketName}, model year ${row.modelYearLabel}, ${row.variantName}`,
    detail: row.modelYearConvention,
    href: catalogueContextHref({
      modelSlug: input.modelSlug,
      generationSlug: input.currentGenerationSlug,
      market: row.salesMarketId,
      year: row.modelYearId,
      variant: row.variantId,
      section,
      registration,
    }),
    current:
      market === row.salesMarketId &&
      year === row.modelYearId &&
      input.requested.variant === row.variantId,
  }));

  return { generations, markets, years, variants, records };
}

function unique<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    const id = key(row);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(row);
  }
  return result;
}
