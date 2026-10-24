import type { Metadata } from "next";

import { loadCatalogueModel } from "@/catalogue/load";
import { CatalogueDetailView, type CatalogueDetailState } from "@/catalogue/views";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

type ModelRoute = {
  params: Promise<{ modelSlug: string }>;
  searchParams: Promise<{
    section?: string | string[];
    registration?: string | string[];
  }>;
};

export async function generateMetadata({ params, searchParams }: ModelRoute): Promise<Metadata> {
  const state = await loadFromRoute(params, searchParams);
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

export default async function ModelPage({ params, searchParams }: ModelRoute) {
  const state = await loadFromRoute(params, searchParams);
  return <CatalogueDetailView state={state} />;
}

async function loadFromRoute(
  params: ModelRoute["params"],
  searchParams: ModelRoute["searchParams"],
): Promise<CatalogueDetailState> {
  const [{ modelSlug }, query] = await Promise.all([params, searchParams]);
  return loadCatalogueModel({
    modelSlug,
    section: first(query.section),
    registration: first(query.registration),
  });
}

function first(value: string | string[] | undefined): string | undefined {
  const found = Array.isArray(value) ? value[0] : value;
  return found === undefined || found === "" ? undefined : found;
}
