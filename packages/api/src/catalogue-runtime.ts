import { createDb, createDbFromClient } from "@cart-campuss/db";

import type { Context } from "./context";

export function createCatalogueContext(config: {
  databaseUrl: string;
  allowFixtures: boolean;
}): Context {
  return {
    db: createDb({ DATABASE_URL: config.databaseUrl }),
    access: { allowFixtures: config.allowFixtures },
  };
}

export function createCatalogueContextFromClient(
  client: Parameters<typeof createDbFromClient>[0],
  allowFixtures: boolean,
): Context {
  return {
    db: createDbFromClient(client),
    access: { allowFixtures },
  };
}
