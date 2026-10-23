import type { Context } from "@cart-campuss/api/context";
import { appRouter } from "@cart-campuss/api/routers/index";

import { parseCatalogueRead } from "./selection";
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

export async function loadCatalogueCarForContext(
  runtime: Context,
  input: {
    modelSlug: string;
    generationSlug: string;
    market?: string;
    year?: string;
    variant?: string;
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
    return { kind: "page", page };
  } catch {
    return { kind: "unavailable" };
  }
}
