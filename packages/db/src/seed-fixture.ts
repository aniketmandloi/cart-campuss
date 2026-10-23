import { createDbFromClient } from "./index";
import { createPsqlNeonClient } from "./psql-client";
import { insertSyntheticPreviewFixture } from "./synthetic-fixture";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const psql = process.env.PSQL?.trim() ?? "";

if (!databaseUrl || !psql) {
  throw new Error(
    "DATABASE_URL and PSQL are required. PSQL is the psql binary. The connection string is not printed.",
  );
}

const db = createDbFromClient(createPsqlNeonClient({ databaseUrl, psql }));
await insertSyntheticPreviewFixture(db);
console.log(
  "Inserted the synthetic catalogue fixture. Public reads exclude it until CATALOGUE_ALLOW_FIXTURES=true.",
);
