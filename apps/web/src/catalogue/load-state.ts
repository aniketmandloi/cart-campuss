import type { CatalogueBrandPage, CatalogueHome } from "@cart-campuss/api/browse";
import type { Context } from "@cart-campuss/api/context";
import { catalogueContextHref } from "@cart-campuss/api/dossier";
import { appRouter } from "@cart-campuss/api/routers/index";

import { parseCatalogueRead, parseCatalogueToken } from "./selection";
import type { CatalogueDetailState, CatalogueSearchState } from "./views";

export type CatalogueBrowseState =
  | { kind: "unconfigured" }
  | { kind: "unavailable" }
  | { kind: "ready"; home: CatalogueHome };

export type CatalogueBrandState =
  | { kind: "unconfigured" }
  | { kind: "unavailable" }
  | { kind: "page"; page: CatalogueBrandPage };

const brandStatuses = ["applicability", "generation", "model"] as const;

export async function loadCatalogueHomeForContext(
  runtime: Context,
  input: { registration?: string },
): Promise<CatalogueBrowseState> {
  const registration = parseCatalogueToken(input.registration, "id");
  if (registration.status === "invalid") {
    return loadHome(runtime, undefined);
  }
  return loadHome(runtime, registration.status === "present" ? registration.value : undefined);
}

async function loadHome(runtime: Context, registration: string | undefined): Promise<CatalogueBrowseState> {
  try {
    const home = await appRouter.createCaller(runtime).catalogue.home({
      ...(registration ? { registration } : {}),
    });
    return { kind: "ready", home };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function loadCatalogueBrandForContext(
  runtime: Context,
  input: { brandSlug: string; generation?: string; status?: string; registration?: string },
): Promise<CatalogueBrandState> {
  const brandSlug = parseCatalogueToken(input.brandSlug, "slug");
  const generation = parseCatalogueToken(input.generation, "id");
  const registration = parseCatalogueToken(input.registration, "id");
  const status = brandStatuses.find((item) => item === input.status?.trim());
  if (brandSlug.status !== "present") {
    return {
      kind: "page",
      page: { availability: "not-in-public-catalogue", privatePreview: runtime.access.allowFixtures },
    };
  }
  try {
    const page = await appRouter.createCaller(runtime).catalogue.brand({
      brandSlug: brandSlug.value,
      ...(generation.status === "present" ? { generation: generation.value } : {}),
      ...(status ? { status } : {}),
      ...(registration.status === "present" ? { registration: registration.value } : {}),
    });
    return { kind: "page", page };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function loadCatalogueSearchForContext(
  runtime: Context,
  query: string,
): Promise<CatalogueSearchState> {
  const trimmed = query.trim();
  const privatePreview = runtime.access.allowFixtures;
  if (trimmed.length > 80) return { kind: "invalid", query: trimmed, privatePreview };
  if (!trimmed) return { kind: "idle", query: "", privatePreview };
  try {
    const result = await appRouter.createCaller(runtime).catalogue.search({ q: trimmed });
    return { kind: "results", query: trimmed, privatePreview, result };
  } catch {
    return { kind: "unavailable", query: trimmed, privatePreview };
  }
}

export async function loadCatalogueModelForContext(
  runtime: Context,
  input: { modelSlug: string; section?: string; registration?: string },
): Promise<CatalogueDetailState> {
  const modelSlug = parseCatalogueToken(input.modelSlug, "slug");
  const registration = parseCatalogueToken(input.registration, "id");
  const sectionToken = parseCatalogueToken(input.section, "id");
  const section =
    sectionToken.status === "present"
      ? (["overview", "specs", "market", "cost", "sources"] as const).find((item) => item === sectionToken.value)
      : undefined;
  if (modelSlug.status !== "present" || registration.status === "invalid" || sectionToken.status === "invalid") {
    return {
      kind: "page",
      page: { availability: "not-in-public-catalogue", privatePreview: runtime.access.allowFixtures },
    };
  }
  try {
    const page = await appRouter.createCaller(runtime).catalogue.readModel({
      modelSlug: modelSlug.value,
      ...(section ? { section } : {}),
      ...(registration.status === "present" ? { registration: registration.value } : {}),
    });
    return { kind: "page", page };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function loadCatalogueCarForContext(
  runtime: Context,
  input: {
    modelSlug: string;
    generationSlug: string;
    market?: string;
    year?: string;
    variant?: string;
    section?: string;
    registration?: string;
  },
): Promise<CatalogueDetailState> {
  const parsed = parseCatalogueRead(input);
  if (parsed.status === "invalid") {
    return {
      kind: "page",
      page: {
        availability: "not-in-public-catalogue",
        privatePreview: runtime.access.allowFixtures,
      },
    };
  }
  try {
    const page = await appRouter.createCaller(runtime).catalogue.read(parsed.value);
    if (page.availability === "redirect") {
      return {
        kind: "redirect",
        location: catalogueContextHref({
          modelSlug: page.modelSlug,
          generationSlug: page.generationSlug,
          market: parsed.value.market,
          year: parsed.value.year,
          variant: parsed.value.variant,
          section: parsed.value.section,
          registration: parsed.value.registration,
        }),
      };
    }
    return { kind: "page", page };
  } catch {
    return { kind: "unavailable" };
  }
}
