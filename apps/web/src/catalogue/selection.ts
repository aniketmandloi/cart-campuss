import type { DossierSection } from "@cart-campuss/api/dossier";

const slugPattern = /^[a-z0-9-]+$/;
const idPattern = /^[a-z0-9_-]+$/;
const dossierSections = ["overview", "specs", "market", "cost", "sources"] as const;

export type CatalogueToken =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "present"; value: string };

export type CatalogueReadInput = {
  modelSlug: string;
  generationSlug: string;
  market?: string;
  year?: string;
  variant?: string;
  section?: DossierSection;
  registration?: string;
};

export function parseCatalogueToken(
  value: string | undefined,
  kind: "slug" | "id",
): CatalogueToken {
  if (value === undefined || value.trim() === "") return { status: "absent" };
  const trimmed = value.trim();
  const pattern = kind === "slug" ? slugPattern : idPattern;
  if (trimmed.length > 80 || !pattern.test(trimmed)) return { status: "invalid" };
  return { status: "present", value: trimmed };
}

/**
 * Route tokens are either missing, rejected, or a real value.
 * "absent" and "invalid" are legal slugs and ids, so they cannot be status markers.
 */
export function parseCatalogueRead(input: {
  modelSlug: string;
  generationSlug: string;
  market?: string;
  year?: string;
  variant?: string;
  section?: string;
  registration?: string;
}): { status: "invalid" } | { status: "ready"; value: CatalogueReadInput } {
  const modelSlug = parseCatalogueToken(input.modelSlug, "slug");
  const generationSlug = parseCatalogueToken(input.generationSlug, "slug");
  const market = parseCatalogueToken(input.market, "id");
  const year = parseCatalogueToken(input.year, "id");
  const variant = parseCatalogueToken(input.variant, "id");
  const section = parseDossierSectionToken(input.section);
  const registration = parseCatalogueToken(input.registration, "id");
  if (
    modelSlug.status !== "present" ||
    generationSlug.status !== "present" ||
    market.status === "invalid" ||
    year.status === "invalid" ||
    variant.status === "invalid"
  ) {
    return { status: "invalid" };
  }
  return {
    status: "ready",
    value: {
      modelSlug: modelSlug.value,
      generationSlug: generationSlug.value,
      ...(market.status === "present" ? { market: market.value } : {}),
      ...(year.status === "present" ? { year: year.value } : {}),
      ...(variant.status === "present" ? { variant: variant.value } : {}),
      ...(section ? { section } : {}),
      ...(registration.status === "present" ? { registration: registration.value } : {}),
    },
  };
}

function parseDossierSectionToken(value: string | undefined): DossierSection | undefined {
  const token = parseCatalogueToken(value, "id");
  if (token.status !== "present") return undefined;
  return dossierSections.find((section) => section === token.value);
}
