import assert from "node:assert/strict";
import { test } from "node:test";

import {
  prepareCatalogueMigrations,
  readCatalogueMigrationSql,
  rewriteCatalogueMigrationSql,
  runPsql,
} from "@cart-campuss/api/psql-client";

const schema = "catalogue_run_0123456789abcdef";

test("migration files stay unqualified while the test runner rewrites a public qualifier", () => {
  const committed = readCatalogueMigrationSql();
  assert.doesNotMatch(committed, /catalogue_run_/);
  assert.doesNotMatch(committed, /drop\s+schema/i);
  assert.match(committed, /CREATE TABLE "catalogue_alias"/);

  const prepared = prepareCatalogueMigrations(schema);
  assert.doesNotMatch(prepared, /statement-breakpoint/);
  assert.equal(readCatalogueMigrationSql(), committed);

  const rewritten = rewriteCatalogueMigrationSql(
    'ALTER TABLE "public"."catalogue_price_reference" ADD COLUMN "source_title" text;\n--> statement-breakpoint\n',
    schema,
  );
  assert.match(rewritten, new RegExp(`"${schema}"\\."catalogue_price_reference"`));
  assert.doesNotMatch(rewritten, /"public"|statement-breakpoint/);
  assert.throws(
    () => prepareCatalogueMigrations("public"),
    /isolated catalogue schema/,
  );
});

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
