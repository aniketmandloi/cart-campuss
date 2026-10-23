import { neon, neonConfig } from "@neondatabase/serverless";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export { sql } from "drizzle-orm";

export function createDb(env: DatabaseConfig) {
  const sql = neon(env.DATABASE_URL);
  return drizzle({ client: sql, relations });
}

export type Database = ReturnType<typeof createDb>;

/**
 * Point the Neon HTTP client at a fetch endpoint before the first query.
 * Production keeps the driver's default Neon host. The publishing integration
 * test sets a local endpoint so `batch()` still uses the Neon transaction
 * protocol against an empty Postgres it created itself. The returned function
 * restores the previous endpoint.
 */
export function setDatabaseFetchEndpoint(url: string): () => void {
  const previous = neonConfig.fetchEndpoint;
  neonConfig.fetchEndpoint = url;
  return () => {
    neonConfig.fetchEndpoint = previous;
  };
}

/**
 * Submit Drizzle statements through the Neon HTTP client's batch. That client
 * posts the statements as one `queries` array, and Postgres commits or rolls
 * them back together. `db.transaction()` throws on this driver.
 *
 * The argument is widened before the call. A dynamic list is not a tuple, and
 * inferring `batch()`'s per-statement result type walks every query builder.
 */
export async function commitNeonHttpBatch(
  db: Database,
  statements: readonly BatchItem<"pg">[],
): Promise<void> {
  const [first, ...rest] = statements;
  if (!first) return;
  await db.batch([first, ...rest] as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
}

/**
 * Apply the SQL migrations in `migrationsFolder`. The Neon HTTP driver runs
 * each statement on its own, so a failed migration is not rolled back.
 */
export async function migrateDatabase(db: Database, migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder });
}
