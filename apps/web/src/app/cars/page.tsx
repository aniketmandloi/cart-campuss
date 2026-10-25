import type { Metadata } from "next";

import { catalogueAllowsFixtures, loadCatalogueList } from "@/catalogue/load";
import { CatalogueSearchView } from "@/catalogue/views";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

export async function generateMetadata(): Promise<Metadata> {
  const preview = catalogueAllowsFixtures();
  return {
    title: "Catalogue",
    description: "Filter published cars by name, brand, model, generation, market, and sourced configuration.",
    robots: preview ? { index: false, follow: false } : { index: true, follow: true },
  };
}

export default async function CarsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const state = await loadCatalogueList(params);
  const registration = first(params.registration);
  return <CatalogueSearchView state={state} registrationId={registration || null} />;
}

function first(value: string | string[] | undefined): string {
  const text = Array.isArray(value) ? value[0] ?? "" : value ?? "";
  return /^[a-z0-9_-]{1,80}$/.test(text) ? text : "";
}
