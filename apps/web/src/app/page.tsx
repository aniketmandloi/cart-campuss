import type { Metadata } from "next";

import { catalogueAllowsFixtures, loadCatalogueSearch } from "@/catalogue/load";
import { CatalogueSearchView } from "@/catalogue/views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata(): Promise<Metadata> {
  const preview = catalogueAllowsFixtures();
  return {
    title: "Search the catalogue",
    description: "Find a car and read its sourced details.",
    robots: preview ? { index: false, follow: false } : { index: true, follow: true },
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = first(params.q);
  const state = await loadCatalogueSearch(query);
  return <CatalogueSearchView state={state} />;
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
