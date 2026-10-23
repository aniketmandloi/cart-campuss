import type { Database } from "@cart-campuss/db";

export type CatalogueAccess = {
  /** Synthetic fixtures are readable only when this server is explicitly authorized. */
  allowFixtures: boolean;
};

export type Context = {
  db: Database;
  now?: () => Date;
  /** Server-held operator credential. Null when publishing is not configured. */
  operatorToken: string | null;
  /** Bearer token presented on this request. Visitors present none. */
  presentedOperatorToken: string | null;
  access: CatalogueAccess;
};
