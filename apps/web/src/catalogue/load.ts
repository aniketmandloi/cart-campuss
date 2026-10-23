import { cache } from "react";

import { createCatalogueContext } from "@cart-campuss/api/catalogue-runtime";
import type { Context } from "@cart-campuss/api/context";

import { ENV } from "@/env.server";

import { loadCatalogueCarForContext, loadCatalogueSearchForContext } from "./load-state";
import type { CatalogueDetailState, CatalogueSearchState } from "./views";

export { loadCatalogueCarForContext, loadCatalogueSearchForContext } from "./load-state";

type Runtime = Context;

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
  return loadCatalogueSearchForContext(runtime, trimmed);
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
    return loadCatalogueCarForContext(runtime, input);
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
