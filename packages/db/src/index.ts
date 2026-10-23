import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export function createDbFromClient(client: NeonQueryFunction<false, false>) {
  return drizzle({ client, relations });
}

export function createDb(env: DatabaseConfig) {
  const sql = neon(env.DATABASE_URL);
  return createDbFromClient(sql);
}

export type Database = ReturnType<typeof createDb>;
