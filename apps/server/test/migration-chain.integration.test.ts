import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { startPublishingDatabase } from "./ephemeral-postgres";

const migrationsFolder = fileURLToPath(new URL("../../../packages/db/src/migrations", import.meta.url));

describe("catalogue and publishing migrations", { concurrency: 1, timeout: 120_000 }, () => {
  const stops: Array<() => Promise<void>> = [];

  after(async () => {
    for (const stop of stops) await stop();
  });

  it("applies both schemas on a fresh database without dropping the starter todo table", async () => {
    const started = await startPublishingDatabase();
    stops.push(started.stop);
    const names = await started.withSession((query) =>
      query("select name from drizzle.__drizzle_migrations order by id"),
    );
    assert.deepEqual(
      names.rows.map((row) => row[0]),
      [
        "20261023065345_publishing",
        "20261023083647_catalogue_search",
        "20261023130303_publishing_retention",
        "20261023132821_price_reference_source",
        "20261023142856_projection_price_reference",
        "20261023160000_price_capture_retention",
        "20261024130000_dossier_reader",
        "20261024143000_projection_components",
        "20261024150000_scoped_identity",
      ],
    );
    assert.equal(await relation(started, "catalogue_applicability"), "catalogue_applicability");
    assert.equal(await relation(started, "publishing_published_assertion"), "publishing_published_assertion");
    assert.equal(await relation(started, "todo"), "todo");
    assert.equal(await column(started, "publishing_published_assertion", "price_reference"), "price_reference");
    assert.equal(await column(started, "catalogue_price_reference", "source_title"), "source_title");
    assert.equal(await column(started, "publishing_published_assertion", "captured_at"), "captured_at");
  });

  it("rolls back a failed publishing apply and keeps an existing catalogue row", async () => {
    const started = await startPublishingDatabase({ migrate: false });
    stops.push(started.stop);
    const folders = (await readdir(migrationsFolder)).filter((name) => /^\d{14}_/.test(name)).sort();
    const catalogue = folders.filter((name) => name.includes("catalogue") || name.includes("price_reference_source"));
    const publishing = folders.filter((name) => !catalogue.includes(name));
    assert.deepEqual(catalogue, ["20261023083647_catalogue_search", "20261023132821_price_reference_source"]);
    assert.ok(publishing.includes("20261023065345_publishing"));
    assert.ok(publishing.includes("20261023142856_projection_price_reference"));

    await started.withSession(async (query) => {
      await query("BEGIN");
      for (const folder of catalogue) {
        for (const statement of await migrationStatements(folder)) await query(statement);
      }
      await query(
        "insert into catalogue_brand (id, name, slug) values ('brand_sentinel', 'Sentinel', 'sentinel')",
      );
      await query("COMMIT");
    });

    await started.withSession(async (query) => {
      await query("BEGIN");
      try {
        for (const statement of await migrationStatements("20261023065345_publishing")) await query(statement);
        await query("select 1/0");
        await query("COMMIT");
        assert.fail("The failing publishing transaction committed");
      } catch (error) {
        await query("ROLLBACK");
        if (!(error instanceof Error) || !/division by zero/.test(error.message)) throw error;
      }
    });

    assert.equal(await scalar(started, "select name from catalogue_brand where id = 'brand_sentinel'"), "Sentinel");
    assert.equal(await relation(started, "publishing_source_policy"), null);
    assert.equal(await relation(started, "publishing_published_assertion"), null);

    await started.withSession(async (query) => {
      await query("BEGIN");
      for (const folder of publishing) {
        for (const statement of await migrationStatements(folder)) await query(statement);
      }
      await query("COMMIT");
    });

    assert.equal(await scalar(started, "select name from catalogue_brand where id = 'brand_sentinel'"), "Sentinel");
    assert.equal(await relation(started, "catalogue_applicability"), "catalogue_applicability");
    assert.equal(await column(started, "publishing_published_assertion", "price_reference"), "price_reference");
    assert.equal(await column(started, "publishing_published_assertion", "captured_at"), "captured_at");
    assert.equal(await column(started, "catalogue_price_reference", "source_title"), "source_title");
  });
});

async function migrationStatements(folder: string): Promise<string[]> {
  const sql = await readFile(join(migrationsFolder, folder, "migration.sql"), "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function relation(
  started: Awaited<ReturnType<typeof startPublishingDatabase>>,
  name: string,
): Promise<string | null> {
  return scalar(started, `select to_regclass('public.${name}')::text`);
}

async function column(
  started: Awaited<ReturnType<typeof startPublishingDatabase>>,
  table: string,
  name: string,
): Promise<string | null> {
  return scalar(
    started,
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = '${table}' and column_name = '${name}'`,
  );
}

async function scalar(
  started: Awaited<ReturnType<typeof startPublishingDatabase>>,
  statement: string,
): Promise<string | null> {
  const result = await started.withSession((query) => query(statement));
  return result.rows[0]?.[0] ?? null;
}
