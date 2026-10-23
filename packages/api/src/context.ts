import type { Database } from "@cart-campuss/db";

export type CatalogueAccess = {
  /** Synthetic fixtures are readable only when this server is explicitly authorized. */
  allowFixtures: boolean;
};

export type Context = {
  db: Database;
  access: CatalogueAccess;
};
