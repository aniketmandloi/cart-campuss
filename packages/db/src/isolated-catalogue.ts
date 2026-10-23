import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NeonQueryFunction } from "@neondatabase/serverless";

import { createPsqlNeonClient, quoteRunSchema, runPsql } from "./psql-client";

const migrationDirectory = fileURLToPath(new URL("./migrations/", import.meta.url));

export type IsolatedCatalogueDatabase = {
  schema: string;
  client: NeonQueryFunction<false, false>;
  close: () => void;
};

/**
 * Creates a unique schema, applies the reviewed catalogue migrations into it,
 * and drops only that schema on close. `public` is never dropped or rewritten
 * on disk. A `public` qualifier inside a migration is rewritten only in the
 * SQL string sent to this schema.
 */
export function openIsolatedCatalogueDatabase(options: {
  databaseUrl: string;
  psql: string;
}): IsolatedCatalogueDatabase {
  assertLocalDatabase(options.databaseUrl);
  const before = publicRelationSignature(options);
  const schema = `catalogue_run_${randomBytes(8).toString("hex")}`;
  quoteRunSchema(schema);
  runPsql({
    databaseUrl: options.databaseUrl,
    psql: options.psql,
    sql: `create schema ${quoteRunSchema(schema)};`,
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    runPsql({
      databaseUrl: options.databaseUrl,
      psql: options.psql,
      sql: `set client_min_messages to warning;\ndrop schema if exists ${quoteRunSchema(schema)} cascade;`,
    });
    const after = publicRelationSignature(options);
    if (after !== before) {
      throw new Error(
        "The catalogue test changed relations in the public schema. It only drops its own schema.",
      );
    }
  };

  try {
    runPsql({
      databaseUrl: options.databaseUrl,
      psql: options.psql,
      schema,
      sql: prepareCatalogueMigrations(schema),
    });
  } catch (error) {
    close();
    throw error;
  }

  return {
    schema,
    client: createPsqlNeonClient({ ...options, schema }),
    close,
  };
}

export function readCatalogueMigrationSql(): string {
  const folders = readdirSync(migrationDirectory)
    .filter((name) => existsSync(join(migrationDirectory, name, "migration.sql")))
    .sort();
  if (folders.length === 0) throw new Error("The catalogue migration is missing.");
  return folders
    .map((name) => readFileSync(join(migrationDirectory, name, "migration.sql"), "utf8"))
    .join("\n");
}

/** Rewrites migration text for one isolated schema. Does not write the files. */
export function rewriteCatalogueMigrationSql(sql: string, schema: string): string {
  return sql
    .replaceAll("--> statement-breakpoint", "\n")
    .replaceAll('"public".', `${quoteRunSchema(schema)}.`);
}

export function prepareCatalogueMigrations(schema: string): string {
  return rewriteCatalogueMigrationSql(readCatalogueMigrationSql(), schema);
}

function assertLocalDatabase(databaseUrl: string): void {
  let host = "";
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("The catalogue test database URL is not a postgres URL.");
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Catalogue tests only open a database on localhost.");
  }
}

function publicRelationSignature(options: { databaseUrl: string; psql: string }): string {
  return runPsql({
    databaseUrl: options.databaseUrl,
    psql: options.psql,
    sql: `select coalesce(string_agg(c.relkind::text || ':' || c.relname, ',' order by c.relkind::text, c.relname), '')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm', 'i', 'S', 'f');`,
  }).trim();
}
