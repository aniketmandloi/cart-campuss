import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createCatalogueContextFromClient } from "@cart-campuss/api/catalogue-runtime";
import type { Context } from "@cart-campuss/api/context";
import { openIsolatedCatalogueDatabase, runPsql } from "@cart-campuss/api/psql-client";
import { appRouter } from "@cart-campuss/api/routers/index";

import { loadCatalogueListForContext } from "../src/catalogue/load-state";
import { CatalogueSearchView } from "../src/catalogue/views";
import { acquireCataloguePublicLock } from "./catalogue-public-lock";

const databaseUrl = process.env.CATALOGUE_TEST_DATABASE_URL ?? "";
const psql = process.env.PSQL ?? "";

describe(
  "shareable catalogue list",
  {
    concurrency: 1,
    timeout: 180_000,
    skip:
      databaseUrl && psql
        ? false
        : "Set CATALOGUE_TEST_DATABASE_URL to a localhost database and PSQL to the psql binary. The shareable catalogue journey was not run.",
  },
  () => {
    let caller: ReturnType<typeof appRouter.createCaller>;
    let context: Context;
    let schema = "";
    let closeDatabase: (() => void) | undefined;
    let releasePublicLock: (() => void) | undefined;

    before(async () => {
      releasePublicLock = acquireCataloguePublicLock();
      try {
        const isolated = openIsolatedCatalogueDatabase({ databaseUrl, psql });
        schema = isolated.schema;
        closeDatabase = isolated.close;
        try {
          runPsql({ databaseUrl, psql, schema, sql: listProbeSql });
          context = createCatalogueContextFromClient(isolated.client, false);
          caller = appRouter.createCaller(context);
        } catch (error) {
          isolated.close();
          throw error;
        }
      } catch (error) {
        releasePublicLock();
        releasePublicLock = undefined;
        throw error;
      }
    });

    after(() => {
      try {
        closeDatabase?.();
      } finally {
        releasePublicLock?.();
        releasePublicLock = undefined;
      }
    });

    test("exact aliases rank ahead of spelling suggestions, which do not establish identity", async () => {
      const before = aliasCount(schema);
      const exact = await caller.catalogue.search({ q: "harbor probe" });
      assert.equal(exact.hits[0]?.match, "exact");
      assert.equal(applicabilityId(exact.hits[0]), "app_a_harbor");
      assert.equal(exact.hits.some((hit) => applicabilityId(hit) === "app_b_harbro"), false);
      assert.equal(
        exact.suggestions.some((hit) => applicabilityId(hit) === "app_b_harbro" && hit.match === "suggestion"),
        true,
      );
      const typo = await caller.catalogue.search({ q: "harbro probe" });
      assert.equal(applicabilityId(typo.hits[0]), "app_b_harbro");
      assert.equal(typo.hits[0]?.match, "exact");
      assert.equal(
        typo.suggestions.some((hit) => applicabilityId(hit) === "app_a_harbor" && hit.match === "suggestion"),
        true,
      );
      assert.equal(aliasCount(schema), before);
      const injected = await caller.catalogue.search({ q: "harbor' or '1'='1" });
      assert.equal(injected.hits.length, 0);
      assert.equal(injected.suggestions.every((hit) => hit.match === "suggestion"), true);
      assert.equal(
        injected.suggestions.some((hit) => `${hit.brandName} ${hit.modelName}`.includes("'")),
        false,
      );

      const ranked = await caller.catalogue.search({ q: "open sheet" });
      assert.equal(ranked.hits[0]?.scope, "generation");
      assert.equal(ranked.hits[0]?.match, "exact");
      assert.equal(
        ranked.hits.some((hit) => hit.scope === "applicability" && hit.match === "prefix"),
        true,
      );

      const crowded = await caller.catalogue.search({ q: "padded name", brand: "harbro-probe" });
      assert.deepEqual(
        crowded.hits.flatMap((hit) => (hit.scope === "applicability" ? [hit.applicabilityId] : [])),
        ["app_b_harbro"],
      );
      assert.equal(crowded.total, 1);
    });

    test("ambiguity names generation, sales market, and model year, and a miss suggests published models", async () => {
      const found = await caller.catalogue.search({ q: "north" });
      assert.equal(found.ambiguous, true);
      assert.deepEqual(
        found.hits.flatMap((hit) => (hit.scope === "applicability" ? [hit.applicabilityId] : [])),
        ["app_a_harbor", "app_b_harbro"],
      );
      const html = renderToStaticMarkup(
        <CatalogueSearchView state={{ kind: "results", query: "north", privatePreview: false, result: found }} />,
      );
      assert.match(html, /More than one published record matches/);
      assert.match(html, /Mark One/);
      assert.match(html, /Mark Two/);
      assert.match(html, /Probe market/);
      assert.match(html, /Other market/);
      assert.match(html, /model year 2024/);
      assert.match(html, /model year 2025/);
      assert.match(html, /data-catalogue-list=/);

      const missed = await caller.catalogue.search({ q: "zzzz-not-a-car" });
      assert.equal(missed.hits.length, 0);
      assert.equal(missed.suggestions.length, 0);
      assert.equal(missed.miss?.publishedModels.some((model) => model.modelName === "Plain Sedan"), true);
      assert.equal(
        missed.miss?.publishedModels.some((model) => model.modelName.toLowerCase().includes("zzzz")),
        false,
      );
      const missHtml = renderToStaticMarkup(
        <CatalogueSearchView
          state={{ kind: "results", query: "zzzz-not-a-car", privatePreview: false, result: missed }}
        />,
      );
      assert.match(missHtml, /No published record matches this search/);
      assert.match(missHtml, /These counts describe this catalogue only/);
      assert.match(missHtml, /No record was added for this search/);
      assert.match(missHtml, /Plain Sedan/);
    });

    test("filters narrow approved records, keep a car with an unknown price, and share a stable page URL", async () => {
      const sedan = await caller.catalogue.search({ q: "north", body: "sedan" });
      assert.deepEqual(
        sedan.hits.flatMap((hit) => (hit.scope === "applicability" ? [hit.applicabilityId] : [])),
        ["app_a_harbor"],
      );
      const wagon = await caller.catalogue.search({ body: "wagon", coverage: "applicability" });
      assert.deepEqual(
        wagon.hits.flatMap((hit) => (hit.scope === "applicability" ? [hit.applicabilityId] : [])),
        ["app_b_harbro"],
      );
      const priced = await caller.catalogue.search({ coverage: "applicability" });
      const ids = priced.hits.flatMap((hit) => (hit.scope === "applicability" ? [hit.applicabilityId] : []));
      assert.equal(ids.includes("app_a_harbor"), true);
      assert.equal(ids.includes("app_b_harbro"), true);
      const generation = await caller.catalogue.search({ coverage: "generation" });
      assert.equal(
        generation.hits.some((hit) => hit.scope === "generation" && hit.generationId === "gen_open_sheet"),
        true,
      );
      assert.equal(generation.hits.some((hit) => hit.scope === "applicability"), false);

      const brand = await caller.catalogue.search({
        brand: "harbor-probe",
        powertrain: "petrol",
        transmission: "automatic",
      });
      assert.deepEqual(
        brand.hits.flatMap((hit) => (hit.scope === "applicability" ? [hit.applicabilityId] : [])),
        ["app_a_harbor"],
      );
      const sedanChip = brand.chips.find((chip) => chip.dimension === "body" && chip.value === "sedan");
      assert.equal(sedanChip?.count, 1);
      assert.match(sedanChip?.href ?? "", /body=sedan/);
      assert.equal(sedanChip?.href.includes("loan"), false);

      const page = await caller.catalogue.search({ q: "north", page: 2 });
      assert.equal(page.total, 2);
      assert.equal(page.hits.length, 0);
      assert.match(page.href, /\/cars\?q=north&page=2/);

      const html = renderToStaticMarkup(
        <CatalogueSearchView state={{ kind: "results", query: "north", privatePreview: false, result: sedan }} />,
      );
      assert.match(html, /Apply/);
      assert.match(html, /Reset/);
      assert.match(html, /1 published record in this catalogue/);
      assert.match(html, /sedan \(1\)/);

      const shared = await loadCatalogueListForContext(context, { q: "north", loan: "10", body: "sedan" });
      assert.equal(shared.kind, "results");
      if (shared.kind !== "results") return;
      assert.equal(shared.result.href.includes("loan"), false);
      assert.match(shared.result.href, /body=sedan/);
      await assert.rejects(() => caller.catalogue.search({ brand: "Harbor Probe" }));
    });
  },
);

function applicabilityId(hit: { scope: string; applicabilityId?: string | null } | undefined): string | null {
  return hit?.scope === "applicability" ? hit.applicabilityId ?? null : null;
}

function aliasCount(schema: string): string {
  return runPsql({
    databaseUrl,
    psql,
    schema,
    sql: "select count(*) from catalogue_alias",
  }).trim();
}

function fact(property: string, value: string): string {
  return `{"property":"${property}","rawValue":"${value}","normalizedValue":"${value}","state":"known","unknownReason":null,"unit":null,"standard":"list-${property.toLowerCase()}","sourceUrl":null,"sourceTitle":"Reviewed list dossier","providerKey":"list-probe","observedAt":"2026-10-22T00:00:00.000Z","retrievedAt":"2026-10-23T00:00:00.000Z","sourcePolicyId":"policy_list_probe","factualReviewerRef":"fact-reviewer","rightsReviewerRef":"rights-reviewer"}`;
}

const sedanFacts = `'[${fact("Body", "sedan")},${fact("Powertrain", "petrol")},${fact("Transmission", "automatic")}]'`;
const wagonFacts = `'[${fact("Body", "wagon")},${fact("Powertrain", "diesel")},${fact("Transmission", "manual")}]'`;
const openFacts = `'[${fact("Body", "note")}]'`;

const listProbeSql = `
insert into catalogue_source_policy (id, name, audience, permits_public_catalogue, rights_review, attribution, internal_note)
values ('policy_list_probe', 'Reviewed list policy', 'public', true, 'reviewed', 'Reviewed list attribution.', 'list-secret-do-not-project');
insert into catalogue_sales_market (id, name, country_code) values
  ('mkt_probe', 'Probe market', 'IN'),
  ('mkt_other', 'Other market', 'JP');
insert into catalogue_brand (id, name, slug) values
  ('brand_harbor_probe', 'Harbor Probe', 'harbor-probe'),
  ('brand_harbro_probe', 'Harbro Probe', 'harbro-probe');
insert into catalogue_model (id, brand_id, name, slug) values
  ('model_plain_sedan', 'brand_harbor_probe', 'Plain Sedan', 'plain-sedan'),
  ('model_near_sedan', 'brand_harbro_probe', 'Near Sedan', 'near-sedan'),
  ('model_margin_note', 'brand_harbor_probe', 'Margin Note', 'margin-note');
insert into catalogue_generation (id, model_id, name, slug, publication_status, synthetic, source_policy_id) values
  ('gen_mark_one', 'model_plain_sedan', 'Mark One', 'mark-one', 'published', false, 'policy_list_probe'),
  ('gen_mark_two', 'model_near_sedan', 'Mark Two', 'mark-two', 'published', false, 'policy_list_probe'),
  ('gen_open_sheet', 'model_margin_note', 'Open Sheet', 'open-sheet', 'published', false, 'policy_list_probe');
insert into catalogue_model_year (id, label, convention) values
  ('year_probe_2024', '2024', 'Manufacturer model-year label. Not the calendar build year.'),
  ('year_probe_2025', '2025', 'Manufacturer model-year label. Not the calendar build year.');
insert into catalogue_market_variant (id, generation_id, sales_market_id, name) values
  ('var_a', 'gen_mark_one', 'mkt_probe', 'Base'),
  ('var_b', 'gen_mark_two', 'mkt_other', 'Base');
insert into catalogue_applicability (
  id, market_variant_id, model_year_id, sales_market_id, source_policy_id, publication_status, synthetic
) values
  ('app_a_harbor', 'var_a', 'year_probe_2024', 'mkt_probe', 'policy_list_probe', 'published', false),
  ('app_b_harbro', 'var_b', 'year_probe_2025', 'mkt_other', 'policy_list_probe', 'published', false);
insert into catalogue_alias (id, applicability_id, kind, normalized_name) values
  ('alias_a_brand', 'app_a_harbor', 'brand', 'harbor probe'),
  ('alias_a_north', 'app_a_harbor', 'alias', 'north coupe'),
  ('alias_a_open', 'app_a_harbor', 'alias', 'open sheet base'),
  ('alias_b_brand', 'app_b_harbro', 'brand', 'harbro probe'),
  ('alias_b_north', 'app_b_harbro', 'alias', 'north wagon'),
  ('alias_b_padded', 'app_b_harbro', 'alias', 'padded name wagon');
insert into catalogue_alias (id, applicability_id, kind, normalized_name)
select 'alias_pad_' || g, 'app_a_harbor', 'alias', 'padded name ' || g
from generate_series(1, 120) as g;
insert into catalogue_generation_alias (id, generation_id, normalized_name)
values ('gen_alias_open_sheet', 'gen_open_sheet', 'open sheet');
insert into publishing_source_policy (
  id, provider_key, fact_permission, image_permission, permitted_fields, permitted_geographies,
  attribution, retention_seconds, derivative_restriction, aggregation_restriction,
  refresh_interval_seconds, permission_expires_at, takedown_obligation, deletion_obligation,
  contract_text, suspended, reviewer_ref, reviewed_at, created_at
) values (
  'policy_list_probe', 'list-probe', 'permitted', 'denied',
  '["displayName","alias","salesMarket","modelYearLabel","Body","Powertrain","Transmission","brand","model","generation","marketVariant"]'::jsonb,
  '["IN","JP"]'::jsonb,
  'Reviewed list attribution.',
  315360000, 'no derivatives', 'no aggregation', 86400,
  '2099-01-01T00:00:00.000Z', 'withdraw on request', 'delete on expiry',
  null, false, 'policy-reviewer', '2026-10-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z'
);
insert into publishing_import_batch (id, idempotency_key, provider_key, payload_hash, status, result, created_at)
values (
  'batch_list', 'list-batch', 'list-probe', 'list-hash', 'published',
  '{"status":"published","idempotencyKey":"list-batch","publishedSubjectIds":["app_a_harbor","app_b_harbro","gen_open_sheet"]}'::jsonb,
  '2026-10-23T00:00:00.000Z'
);
insert into publishing_projection_generation (id, generation, published_at, batch_id)
values ('generation_list', 1, '2026-10-23T00:00:00.000Z', 'batch_list');
insert into publishing_projection_pointer (id, generation_id, updated_at)
values (1, 'generation_list', '2026-10-23T00:00:00.000Z');
insert into publishing_published_assertion (
  id, generation_id, provider_key, external_id, canonical_subject_id, display_name, aliases,
  sales_market, model_year_label, facts, media, attribution, source_policy_id,
  factual_reviewer_ref, rights_reviewer_ref, captured_at, observed_at, reviewed_at, price_reference, identity_scope, rights_geographies
) values
  (
    'assertion_a', 'generation_list', 'list-probe', 'harbor', 'app_a_harbor',
    'Harbor Probe', '["north coupe","open sheet base"]'::jsonb, 'IN', '2024',
    ${sedanFacts}::jsonb,
    '[]'::jsonb, 'Reviewed list attribution.', 'policy_list_probe',
    'fact-reviewer', 'rights-reviewer', '2026-10-23T00:00:00.000Z', '2026-10-22T00:00:00.000Z', '2026-10-23T00:00:00.000Z',
    '{"amountMinor":100000,"currency":"INR","minorUnitExponent":2,"basis":"official price reference","taxInclusivity":"unspecified","observedOn":"2026-10-22","retrievedOn":"2026-10-23","reviewedOn":"2026-10-23","sourceTitle":"List price sheet","sourceUrl":null,"sourceIdentifier":null}'::jsonb,
    'applicability',
    '[]'::jsonb
  ),
  (
    'assertion_b', 'generation_list', 'list-probe', 'harbro', 'app_b_harbro',
    'Harbro Probe', '["north wagon","padded name wagon"]'::jsonb, 'JP', '2025',
    ${wagonFacts}::jsonb,
    '[]'::jsonb, 'Reviewed list attribution.', 'policy_list_probe',
    'fact-reviewer', 'rights-reviewer', '2026-10-23T00:00:00.000Z', null, '2026-10-23T00:00:00.000Z',
    null,
    'applicability',
    '[]'::jsonb
  ),
  (
    'assertion_open', 'generation_list', 'list-probe', 'open-sheet', 'gen_open_sheet',
    'Margin Note', '[]'::jsonb, 'IN', null,
    ${openFacts}::jsonb, '[]'::jsonb, 'Reviewed list attribution.', 'policy_list_probe',
    'fact-reviewer', 'rights-reviewer', '2026-10-23T00:00:00.000Z', null, '2026-10-23T00:00:00.000Z',
    null,
    'generation',
    '["IN"]'::jsonb
  );
`;
