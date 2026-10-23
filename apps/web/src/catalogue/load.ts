import { cache } from "react";

import { createCatalogueContext } from "@cart-campuss/api/catalogue-runtime";
import { appRouter } from "@cart-campuss/api/routers/index";

import { ENV } from "@/env.server";

import type { CatalogueDetailState, CatalogueSearchState } from "./views";

const slugPattern = /^[a-z0-9-]+$/;
const idPattern = /^[a-z0-9_-]+$/;

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
    const modelSlug = validToken(input.modelSlug, slugPattern);
    const generationSlug = validToken(input.generationSlug, slugPattern);
    const market = validToken(input.market, idPattern);
    const year = validToken(input.year, idPattern);
    const variant = validToken(input.variant, idPattern);
    const hidden = {
      kind: "page" as const,
      page: {
        availability: "not-in-public-catalogue" as const,
        privatePreview: runtime.access.allowFixtures,
      },
    };
    if (
      modelSlug === "invalid" ||
      modelSlug === "absent" ||
      generationSlug === "invalid" ||
      generationSlug === "absent" ||
      market === "invalid" ||
      year === "invalid" ||
      variant === "invalid"
    ) {
      return hidden;
    }
    try {
      const page = await appRouter.createCaller(runtime).catalogue.read({
        modelSlug,
        generationSlug,
        market: market === "absent" ? undefined : market,
        year: year === "absent" ? undefined : year,
        variant: variant === "absent" ? undefined : variant,
      });
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

function validToken(value: string | undefined, pattern: RegExp): "absent" | "invalid" | string {
  if (value === undefined || value.trim() === "") return "absent";
  const trimmed = value.trim();
  if (trimmed.length > 80 || !pattern.test(trimmed)) return "invalid";
  return trimmed;
}
