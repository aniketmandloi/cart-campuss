import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

import { loadCatalogueCar } from "@/catalogue/load";
import { CatalogueDetailView, type CatalogueDetailState } from "@/catalogue/views";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

type CarRoute = {
  params: Promise<{ modelSlug: string; generationSlug: string }>;
  searchParams: Promise<{
    market?: string | string[];
    year?: string | string[];
    variant?: string | string[];
    section?: string | string[];
    registration?: string | string[];
  }>;
};

export async function generateMetadata({ params, searchParams }: CarRoute): Promise<Metadata> {
  const state = await loadFromRoute(params, searchParams);
  if (state.kind === "redirect") permanentCatalogueRedirect(state.location);
  if (state.kind === "page" && state.page.availability !== "not-in-public-catalogue" && state.page.availability !== "redirect") {
    const title = `${state.page.identity.brandName} ${state.page.identity.modelName}`;
    return {
      title,
      description: state.page.synthetic
        ? `${title}. Synthetic fixture for private preview.`
        : `${title}. Sourced catalogue record.`,
      robots:
        state.page.privatePreview || state.page.synthetic
          ? { index: false, follow: false }
          : { index: true, follow: true },
    };
  }
  return {
    title: "Catalogue",
    description: "This address does not match a published catalogue record.",
    robots: { index: false, follow: false },
  };
}

export default async function CarPage({ params, searchParams }: CarRoute) {
  const state = await loadFromRoute(params, searchParams);
  if (state.kind === "redirect") permanentCatalogueRedirect(state.location);
  return <CatalogueDetailView state={state} />;
}

async function loadFromRoute(
  params: CarRoute["params"],
  searchParams: CarRoute["searchParams"],
): Promise<CatalogueDetailState> {
  const [{ modelSlug, generationSlug }, query] = await Promise.all([params, searchParams]);
  return loadCatalogueCar({
    modelSlug,
    generationSlug,
    market: first(query.market),
    year: first(query.year),
    variant: first(query.variant),
    section: first(query.section),
    registration: first(query.registration),
  });
}

function permanentCatalogueRedirect(location: string): never {
  if (!/^\/cars\/[a-z0-9-]+\/[a-z0-9-]+(?:\?[a-z0-9_&=-]+)?$/.test(location)) {
    throw new Error("The catalogue redirect is not a car path.");
  }
  permanentRedirect(location as `/cars/${string}/${string}` | `/cars/${string}/${string}?${string}`);
}

function first(value: string | string[] | undefined): string | undefined {
  const found = Array.isArray(value) ? value[0] : value;
  return found === undefined || found === "" ? undefined : found;
}
