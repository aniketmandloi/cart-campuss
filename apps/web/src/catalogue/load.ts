import { cache } from "react";

import { createCatalogueContext } from "@cart-campuss/api/catalogue-runtime";
import { appRouter } from "@cart-campuss/api/routers/index";

import { ENV } from "@/env.server";

import { parseCatalogueRead } from "./selection";
import type { CatalogueDetailState, CatalogueSearchState } from "./views";

type Runtime = ReturnType<typeof createCatalogueContext>;

let cached: { databaseUrl: string; allowFixtures: boolean; runtime: Runtime } | undefined;

export function catalogueAllowsFixtures(): boolean {
  return ENV.CATALOGUE_ALLOW_FIXTURES === true;
}

export const loadCatalogueSearch = cache(async (query: string): Promise<CatalogueSearchState> => {
  const trimmed = query.trim();
  const privatePreview = catalogueAllowsFixtures();
  if (trimmed.length > 80) return { kind: "invalid", query: trimmed, privatePreview };
  const runtime = catalogueRuntime();
  if (!runtime) return { kind: "unconfigured", query: trimmed, privatePreview };
  if (!trimmed) return { kind: "idle", query: "", privatePreview };
  try {
    const result = await appRouter.createCaller(runtime).catalogue.search({ q: trimmed });
    return { kind: "results", query: trimmed, privatePreview, result };
  } catch {
    return { kind: "unavailable", query: trimmed, privatePreview };
  }
});

export const loadCatalogueCar = cache(
  async (input: {
    modelSlug: string;
    generationSlug: string;
    market?: string;
    year?: string;
    variant?: string;
  }): Promise<CatalogueDetailState> => {
    const runtime = catalogueRuntime();
    if (!runtime) return { kind: "unconfigured" };
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
  },
);

function catalogueRuntime(): Runtime | null {
  if (typeof window !== "undefined") {
    throw new Error("Catalogue data is loaded on the server.");
  }
  const databaseUrl = ENV.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) return null;
  const allowFixtures = catalogueAllowsFixtures();
  if (cached?.databaseUrl === databaseUrl && cached.allowFixtures === allowFixtures) {
    return cached.runtime;
  }
  const runtime = createCatalogueContext({ databaseUrl, allowFixtures });
  cached = { databaseUrl, allowFixtures, runtime };
  return runtime;
}
