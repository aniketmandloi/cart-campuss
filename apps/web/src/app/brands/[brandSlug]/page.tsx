import type { Metadata } from "next";

import { CatalogueBrandView } from "@/catalogue/browse-view";
import { loadCatalogueBrand, type CatalogueBrandState } from "@/catalogue/load";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

type BrandRoute = {
  params: Promise<{ brandSlug: string }>;
  searchParams: Promise<{
    generation?: string | string[];
    status?: string | string[];
    registration?: string | string[];
  }>;
};

export async function generateMetadata({ params, searchParams }: BrandRoute): Promise<Metadata> {
  const state = await loadFromRoute(params, searchParams);
  if (state.kind === "page" && state.page.availability === "visible") {
    return {
      title: state.page.brandName,
      description: state.page.synthetic
        ? `${state.page.brandName}. Synthetic fixture for private preview.`
        : `${state.page.brandName}. Published models in this catalogue.`,
      robots:
        state.page.privatePreview || state.page.synthetic
          ? { index: false, follow: false }
          : { index: true, follow: true },
    };
  }
  return {
    title: "Catalogue",
    description: "This address does not match a published brand.",
    robots: { index: false, follow: false },
  };
}

export default async function BrandPage({ params, searchParams }: BrandRoute) {
  return <CatalogueBrandView state={await loadFromRoute(params, searchParams)} />;
}

async function loadFromRoute(
  params: BrandRoute["params"],
  searchParams: BrandRoute["searchParams"],
): Promise<CatalogueBrandState> {
  const [{ brandSlug }, query] = await Promise.all([params, searchParams]);
  return loadCatalogueBrand({
    brandSlug,
    generation: first(query.generation),
    status: first(query.status),
    registration: first(query.registration),
  });
}

function first(value: string | string[] | undefined): string | undefined {
  const found = Array.isArray(value) ? value[0] : value;
  return found === undefined || found === "" ? undefined : found;
}
