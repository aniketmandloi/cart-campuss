import type { Metadata } from "next";

import { catalogueAllowsFixtures, loadCatalogueHome, loadCatalogueSearch } from "@/catalogue/load";
import { CatalogueSearchView } from "@/catalogue/views";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

export async function generateMetadata(): Promise<Metadata> {
  const preview = catalogueAllowsFixtures();
  return {
    title: "Search the catalogue",
    description: "Search published cars, browse brands and collections, and choose a registration jurisdiction.",
    robots: preview ? { index: false, follow: false } : { index: true, follow: true },
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; registration?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = first(params.q);
  const registration = first(params.registration);
  const [state, browse] = await Promise.all([
    loadCatalogueSearch(query),
    loadCatalogueHome(registration),
  ]);
  const registrationId = browse.kind === "ready" ? browse.home.registration?.id ?? null : null;
  return <CatalogueSearchView state={state} registrationId={registrationId} browse={browse} />;
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
