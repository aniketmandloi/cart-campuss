import { catalogueContextHref } from "@cart-campuss/api/dossier";
import type { Context } from "@cart-campuss/api/context";
import { appRouter } from "@cart-campuss/api/routers/index";

import { parseCatalogueRead, parseCatalogueToken } from "./selection";
import type { CatalogueDetailState, CatalogueSearchState } from "./views";

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
