import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { openIsolatedCatalogueDatabase, runPsql } from "@cart-campuss/api/psql-client";

import { acquireCataloguePublicLock } from "./catalogue-public-lock";

const databaseUrl = process.env.CATALOGUE_TEST_DATABASE_URL ?? "";
const psql = process.env.PSQL ?? "";

test(
  "an isolated catalogue migration preserves a preexisting public sentinel",
  {
    skip:
      databaseUrl && psql
        ? false
        : "Set CATALOGUE_TEST_DATABASE_URL to a localhost database and PSQL to the psql binary. The public-sentinel preservation check was not run.",
  },
  () => {
    const sentinel = `cc_sentinel_${randomBytes(8).toString("hex")}`;
    const release = acquireCataloguePublicLock();
    let database: ReturnType<typeof openIsolatedCatalogueDatabase> | undefined;
    try {
      runPsql({
        databaseUrl,
        psql,
        sql: `create table ${publicSentinel(sentinel)} (marker text);\ninsert into ${publicSentinel(sentinel)} (marker) values ('${sentinelMarker(sentinel)}');`,
      });
      const before = readPublicSentinel(sentinel);
      assert.match(before, sentinelSignature(sentinel));

      database = openIsolatedCatalogueDatabase({ databaseUrl, psql });
      assert.equal(readPublicSentinel(sentinel), before);
      const schema = database.schema;
      assert.equal(temporarySchemaCount(schema), "1");
      database.close();
      database = undefined;

      assert.equal(temporarySchemaCount(schema), "0");
      assert.equal(readPublicSentinel(sentinel), before);
    } finally {
      try {
        database?.close();
      } finally {
        try {
          dropPublicSentinel(sentinel);
        } finally {
          release();
        }
      }
    }
  },
);

test("the psql adapter refuses to drop the public schema", () => {
  assert.throws(
    () =>
      runPsql({
        databaseUrl: "postgres://127.0.0.1:1/catalogue",
        psql: "psql",
        sql: "drop schema if exists public cascade;",
      }),
    /Refusing to drop the public schema/,
  );
});

function publicSentinel(sentinel: string): string {
  if (!/^cc_sentinel_[0-9a-f]{16}$/.test(sentinel)) {
    throw new Error("Refusing to touch a public relation outside this test sentinel.");
  }
  return `public."${sentinel}"`;
}

function sentinelMarker(sentinel: string): string {
  publicSentinel(sentinel);
  return `preexisting-${sentinel}`;
}

function sentinelSignature(sentinel: string): RegExp {
  return new RegExp(`^\\d+:${sentinelMarker(sentinel)}$`);
}

function readPublicSentinel(sentinel: string): string {
  const relation = publicSentinel(sentinel);
  return runPsql({
    databaseUrl,
    psql,
    sql: `select c.oid::text || ':' || (select marker from ${relation})
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = '${sentinel}';`,
  }).trim();
}

function temporarySchemaCount(schema: string): string {
  if (!/^catalogue_run_[0-9a-f]{16}$/.test(schema)) {
    throw new Error("Refusing to inspect a schema outside an isolated catalogue run.");
  }
  return runPsql({
    databaseUrl,
    psql,
    sql: `select count(*)::text from pg_namespace where nspname = '${schema}';`,
  }).trim();
}

function dropPublicSentinel(sentinel: string): void {
  runPsql({
    databaseUrl,
    psql,
    sql: `drop table if exists ${publicSentinel(sentinel)};`,
  });
}
