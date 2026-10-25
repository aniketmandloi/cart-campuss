import type { Database } from "@cart-campuss/db";

import { listPublishedModels } from "./browse";
import { searchCatalogue, type CatalogueSearchResult } from "./catalogue";
import type { CatalogueListSelection } from "./catalogue-filters";
import type { CatalogueAccess } from "./context";

export async function listCatalogue(
  db: Database,
  access: CatalogueAccess,
  request: CatalogueListSelection,
  now: () => Date = () => new Date(),
): Promise<CatalogueSearchResult> {
  const result = await searchCatalogue(db, access, request, now);
  if (result.total === 0 && result.suggestions.length === 0) {
    return { ...result, miss: await listPublishedModels(db, access, now) };
  }
  return result;
}
