import { openIsolatedCatalogueDatabase } from "@cart-campuss/db/isolated-catalogue";
import { explainQuery, runPsql } from "@cart-campuss/db/psql-client";

import { catalogueSearchStatement } from "./catalogue";
import { insertSyntheticPreviewFixture } from "./catalogue-fixture";
import { createCatalogueContextFromClient } from "./catalogue-runtime";

const databaseUrl =
  process.env.CATALOGUE_TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
const psql = process.env.PSQL?.trim() ?? "";

if (!databaseUrl || !psql) {
  console.error(
    "Set CATALOGUE_TEST_DATABASE_URL or DATABASE_URL to a localhost database, and PSQL to the psql binary. This diagnostic does not drop the public schema.",
  );
  process.exit(1);
}

const isolated = openIsolatedCatalogueDatabase({ databaseUrl, psql });
let failed = false;
try {
  if (!/^catalogue_run_[0-9a-f]{16}$/.test(isolated.schema)) {
    throw new Error("Unexpected isolated schema name.");
  }
  const preview = createCatalogueContextFromClient(isolated.client, true);
  await insertSyntheticPreviewFixture(preview.db);
  const statement = catalogueSearchStatement(preview.db, preview.access, "kestrel");
  const plan = explainQuery({
    databaseUrl,
    psql,
    schema: isolated.schema,
    sql: statement.sql,
    params: statement.params,
  });
  const listed = runPsql({
    databaseUrl,
    psql,
    schema: isolated.schema,
    sql: `select indexdef from pg_indexes where schemaname = '${isolated.schema}' and indexname = 'catalogue_alias_name_idx'`,
  });
  if (!plan.includes("catalogue_alias_name_idx")) {
    console.error("The prefix search plan did not use catalogue_alias_name_idx.");
    console.error(plan.trim());
    failed = true;
  }
  if (!listed.includes("text_pattern_ops")) {
    console.error("catalogue_alias_name_idx is missing text_pattern_ops.");
    console.error(listed.trim());
    failed = true;
  }
} finally {
  isolated.close();
}

if (failed) process.exit(1);
console.log(
  `Search index diagnostic passed in schema ${isolated.schema}. The prefix plan can use catalogue_alias_name_idx with text_pattern_ops. The public schema was not dropped.`,
);
