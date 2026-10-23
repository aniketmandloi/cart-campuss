import type { Database } from "@cart-campuss/db";

export type Context = {
  db: Database;
  /** Server-held operator credential. Null when publishing is not configured. */
  operatorToken: string | null;
  /** Bearer token presented on this request. Visitors present none. */
  presentedOperatorToken: string | null;
};
