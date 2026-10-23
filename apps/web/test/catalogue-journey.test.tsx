import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { insertSyntheticPreviewFixture } from "@cart-campuss/api/catalogue-fixture";
import { createCatalogueContextFromClient } from "@cart-campuss/api/catalogue-runtime";
import { openIsolatedCatalogueDatabase, runPsql } from "@cart-campuss/api/psql-client";
import { appRouter } from "@cart-campuss/api/routers/index";

import { CatalogueDetailView, CatalogueSearchView } from "../src/catalogue/views";
import { acquireCataloguePublicLock } from "./catalogue-public-lock";

const databaseUrl = process.env.CATALOGUE_TEST_DATABASE_URL ?? "";
const psql = process.env.PSQL ?? "";
const hiddenSentinel = "provider-secret-do-not-project";
const probeSentinel = "probe-secret-do-not-project";

describe(
  "catalogue database journey",
  {
    concurrency: 1,
    skip:
      databaseUrl && psql
        ? false
        : "Set CATALOGUE_TEST_DATABASE_URL to a localhost database and PSQL to the psql binary. The search-to-sourced-HTML journey was not run.",
  },
  () => {
    let publicCaller: ReturnType<typeof appRouter.createCaller>;
    let previewCaller: ReturnType<typeof appRouter.createCaller>;
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
          const preview = createCatalogueContextFromClient(isolated.client, true);
          await insertSyntheticPreviewFixture(preview.db);
          await insertSyntheticPreviewFixture(preview.db);
          runPsql({ databaseUrl, psql, schema, sql: publishedProbeSql });
          runPsql({ databaseUrl, psql, schema, sql: rankProbeSql });

          publicCaller = appRouter.createCaller(
            createCatalogueContextFromClient(isolated.client, false),
          );
          previewCaller = appRouter.createCaller(preview);
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

    test("public search and the sourced page exclude the synthetic fixture", async () => {
      const hidden = await publicCaller.catalogue.search({ q: "kestrel" });
      assert.equal(hidden.hits.length, 0);
      const hiddenHtml = renderToStaticMarkup(
        <CatalogueSearchView
          state={{ kind: "results", query: "kestrel", privatePreview: false, result: hidden }}
        />,
      );
      assert.doesNotMatch(hiddenHtml, fixtureLeak);
      assert.match(hiddenHtml, /No published record matches this search/);

      const blocked = await publicCaller.catalogue.read({
        modelSlug: "sample-hatch",
        generationSlug: "series-one",
        market: "mkt_fixture_in",
        year: "year_2026_model",
        variant: "var_base",
      });
      assert.equal(blocked.availability, "not-in-public-catalogue");
      assert.doesNotMatch(JSON.stringify(blocked), fixtureLeak);
      const blockedHtml = renderToStaticMarkup(
        <CatalogueDetailView state={{ kind: "page", page: blocked }} />,
      );
      assert.match(blockedHtml, /Not in the public catalogue/);
      assert.doesNotMatch(blockedHtml, fixtureLeak);
    });

    test("public search opens a reviewed record as sourced HTML", async () => {
      const found = await publicCaller.catalogue.search({ q: "harbor probe" });
      assert.equal(found.hits.length, 1);
      assert.equal(found.hits[0]?.match, "exact");
      const href = found.hits[0]?.href ?? "";
      const html = renderToStaticMarkup(
        <CatalogueSearchView
          state={{ kind: "results", query: "harbor probe", privatePreview: false, result: found }}
        />,
      );
      assert.match(html, /Exact name/);
      assert.match(html, hrefPattern(href));

      const page = await publicCaller.catalogue.read(readInput(href));
      assert.equal(page.availability, "visible");
      const detail = renderToStaticMarkup(
        <CatalogueDetailView state={{ kind: "page", page }} />,
      );
      assert.match(detail, /Harbor Probe/);
      assert.match(detail, /Plain Sedan/);
      assert.match(detail, /sedan/);
      assert.match(detail, /Reviewed public probe dossier/);
      assert.match(detail, /reviewed/);
      assert.match(detail, /₹1,000\.00/);
      assert.match(detail, /100000 INR minor units/);
      assert.match(detail, /Reviewed public probe price sheet/);
      assert.match(detail, /href="https:\/\/example\.invalid\/harbor-probe-price"/);
      assert.match(detail, /Source policy: Reviewed public policy/);
      assert.match(detail, /Not a listing/);
      assert.match(detail, /No market data/);
      assert.match(detail, /Not the calendar build year/);
      assert.match(detail, /No catalogue photograph/);
      assert.doesNotMatch(detail, /<img|Porsche|GT3|Sample Hatch|999 kW|Hidden output/);
      assert.doesNotMatch(detail, new RegExp(probeSentinel));

      const bypass = await publicCaller.catalogue.search({ q: "bypass probe" });
      assert.equal(bypass.hits.length, 0);
      assert.equal(JSON.stringify(bypass).includes("secret bypass fact"), false);
    });

    test("private preview finds one synthetic record and shows its sourced dossier", async () => {
      const exact = await previewCaller.catalogue.search({ q: "kestrel fixture" });
      assert.equal(exact.hits.length, 1);
      assert.equal(exact.hits[0]?.match, "exact");
      assert.equal(exact.hits[0]?.synthetic, true);

      const prefix = await previewCaller.catalogue.search({ q: "kestrel" });
      assert.equal(prefix.hits.length, 1);
      assert.equal(prefix.hits[0]?.match, "prefix");

      const href = exact.hits[0]?.href ?? "";
      const overview = await previewCaller.catalogue.read({
        modelSlug: "sample-hatch",
        generationSlug: "series-one",
      });
      assert.equal(overview.availability, "overview");
      const overviewHtml = renderToStaticMarkup(
        <CatalogueDetailView state={{ kind: "page", page: overview }} />,
      );
      assert.match(overviewHtml, /Synthetic fixture/);
      assert.match(overviewHtml, hrefPattern(href));
      assert.doesNotMatch(overviewHtml, /100 N·m|₹4,24,242\.42/);

      const page = await previewCaller.catalogue.read(readInput(href));
      assert.equal(page.availability, "visible");
      if (page.availability !== "visible") return;
      assert.equal(page.priceReference?.amountMinor, 42424242);
      const detail = renderToStaticMarkup(
        <CatalogueDetailView state={{ kind: "page", page }} />,
      );
      for (const text of [
        "Kestrel Fixture",
        "Sample Hatch",
        "Series One",
        "petrol inline-4 fixture",
        "fixture-petrol",
        "fixture-powertrain",
        "Synthetic fixture dossier",
        "Synthetic preview policy",
        "private-preview",
        "The synthetic fixture does not include a measured power figure.",
        "not documented",
        "100 N·m",
        "90 N·m",
        "Conflicting reading",
        "Normalized: 90",
        "Unit: N·m",
        "Standard: fixture-torque",
        "Synthetic fixture conflict note",
        "https://example.invalid/fixture-torque-conflict",
        "Conflicting source policy: Synthetic conflict policy",
        "Synthetic conflict note attribution. Not a manufacturer publication.",
        "The synthetic fixture keeps 100 N·m as the curated torque.",
        "₹4,24,242.42",
        "42424242 INR minor units",
        "Synthetic fixture price sheet",
        "Source identifier: fixture-price-kestrel-2026",
        "official price reference",
        "unspecified",
        "Not a listing",
        "No market data",
        "Not the calendar build year",
        "Synthetic fixture",
        "Private preview",
        "No catalogue photograph",
      ]) {
        assert.match(detail, new RegExp(escapeRegExp(text)));
      }
      assert.doesNotMatch(detail, /<img|Porsche|GT3|999 kW|Hidden output/);
      assert.doesNotMatch(detail, new RegExp(hiddenSentinel));
    });

    test("search keeps database order while collapsing aliases", async () => {
      const found = await publicCaller.catalogue.search({ q: "rank probe" });
      const listed = runPsql({
        databaseUrl,
        psql,
        schema,
        sql: `select applicability_id
from catalogue_alias
where normalized_name ~>=~ 'rank probe'
  and normalized_name ~<~ 'rank probf'
order by case when normalized_name = 'rank probe' then 0 else 1 end,
  applicability_id,
  id`,
      })
        .trim()
        .split("\n")
        .filter((id) => id.length > 0);
      const expected: string[] = [];
      for (const id of listed) {
        if (!expected.includes(id)) expected.push(id);
      }
      assert.deepEqual(
        found.hits.map((hit) => hit.applicabilityId),
        expected,
      );
      assert.deepEqual(
        [...expected].sort(),
        ["app_f_order", "app_é_order"].sort(),
      );
      assert.equal(found.hits.length, 2);
    });
  },
);

function readInput(href: string) {
  const url = new URL(href, "http://catalogue.local");
  const [, , modelSlug, generationSlug] = url.pathname.split("/");
  if (!modelSlug || !generationSlug) throw new Error("The catalogue link has no car path.");
  return {
    modelSlug,
    generationSlug,
    market: url.searchParams.get("market") ?? undefined,
    year: url.searchParams.get("year") ?? undefined,
    variant: url.searchParams.get("variant") ?? undefined,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hrefPattern(href: string): RegExp {
  return new RegExp(`href="${escapeRegExp(href.replaceAll("&", "&amp;"))}"`);
}

const fixtureLeak = /Sample Hatch|Kestrel Fixture|42424242|999 kW|Hidden output|provider-secret-do-not-project/;

const rankProbeSql = `
insert into catalogue_brand (id, name, slug) values
  ('brand_rank_f', 'Rank F', 'rank-f'),
  ('brand_rank_e', 'Rank E', 'rank-e');
insert into catalogue_model (id, brand_id, name, slug) values
  ('model_rank_f', 'brand_rank_f', 'Order F', 'order-f'),
  ('model_rank_e', 'brand_rank_e', 'Order E', 'order-e');
insert into catalogue_generation (id, model_id, name, slug) values
  ('gen_rank_f', 'model_rank_f', 'Mark', 'mark'),
  ('gen_rank_e', 'model_rank_e', 'Mark', 'mark');
insert into catalogue_market_variant (id, generation_id, sales_market_id, name) values
  ('var_rank_f', 'gen_rank_f', 'mkt_probe', 'Base'),
  ('var_rank_e', 'gen_rank_e', 'mkt_probe', 'Base');
insert into catalogue_applicability (
  id, market_variant_id, model_year_id, sales_market_id, source_policy_id, publication_status, synthetic
) values
  ('app_f_order', 'var_rank_f', 'year_probe_2024', 'mkt_probe', 'policy_publishing_probe', 'published', false),
  ('app_é_order', 'var_rank_e', 'year_probe_2024', 'mkt_probe', 'policy_publishing_probe', 'published', false);
insert into catalogue_alias (id, applicability_id, kind, normalized_name) values
  ('alias_rank_f_b', 'app_f_order', 'alias', 'rank probe ff'),
  ('alias_rank_f_a', 'app_f_order', 'alias', 'rank probe f'),
  ('alias_rank_e', 'app_é_order', 'alias', 'rank probe e');
insert into publishing_published_assertion (
  id, generation_id, provider_key, external_id, canonical_subject_id, display_name, aliases,
  sales_market, model_year_label, facts, media, attribution, source_policy_id,
  factual_reviewer_ref, rights_reviewer_ref, captured_at, observed_at, reviewed_at, price_reference
) values
  (
    'assertion_rank_f', 'generation_probe', 'probe', 'rank-f', 'app_f_order',
    'Rank F', '["rank probe f","rank probe ff"]'::jsonb, 'IN', '2024',
    '[{"property":"Rank","rawValue":"f","normalizedValue":"f","state":"known","unknownReason":null,"unit":null,"standard":null,"sourceUrl":null,"sourceTitle":"Rank probe note","providerKey":"probe","observedAt":null,"retrievedAt":"2026-10-23T00:00:00.000Z","sourcePolicyId":"policy_publishing_probe","factualReviewerRef":"fact-reviewer","rightsReviewerRef":"rights-reviewer"}]'::jsonb,
    '[]'::jsonb, 'Reviewed public probe attribution.', 'policy_publishing_probe',
    'fact-reviewer', 'rights-reviewer', '2026-10-23T00:00:00.000Z', null, '2026-10-23T00:00:00.000Z', null
  ),
  (
    'assertion_rank_e', 'generation_probe', 'probe', 'rank-e', 'app_é_order',
    'Rank E', '["rank probe e"]'::jsonb, 'IN', '2024',
    '[{"property":"Rank","rawValue":"e","normalizedValue":"e","state":"known","unknownReason":null,"unit":null,"standard":null,"sourceUrl":null,"sourceTitle":"Rank probe note","providerKey":"probe","observedAt":null,"retrievedAt":"2026-10-23T00:00:00.000Z","sourcePolicyId":"policy_publishing_probe","factualReviewerRef":"fact-reviewer","rightsReviewerRef":"rights-reviewer"}]'::jsonb,
    '[]'::jsonb, 'Reviewed public probe attribution.', 'policy_publishing_probe',
    'fact-reviewer', 'rights-reviewer', '2026-10-23T00:00:00.000Z', null, '2026-10-23T00:00:00.000Z', null
  );
`;

const publishedProbeSql = `
insert into catalogue_source_policy (id, name, audience, permits_public_catalogue, rights_review, attribution, internal_note)
values ('policy_publishing_probe', 'Reviewed public policy', 'public', true, 'reviewed', 'Reviewed public probe attribution.', '${probeSentinel}');
insert into catalogue_sales_market (id, name, country_code) values ('mkt_probe', 'Probe market', 'IN');
insert into catalogue_brand (id, name, slug) values ('brand_harbor_probe', 'Harbor Probe', 'harbor-probe');
insert into catalogue_model (id, brand_id, name, slug) values ('model_plain_sedan', 'brand_harbor_probe', 'Plain Sedan', 'plain-sedan');
insert into catalogue_generation (id, model_id, name, slug) values ('gen_mark_one', 'model_plain_sedan', 'Mark One', 'mark-one');
insert into catalogue_model_year (id, label, convention) values ('year_probe_2024', '2024', 'Manufacturer model-year label. Not the calendar build year.');
insert into catalogue_market_variant (id, generation_id, sales_market_id, name) values ('var_probe_base', 'gen_mark_one', 'mkt_probe', 'Base');
insert into catalogue_applicability (id, market_variant_id, model_year_id, sales_market_id, source_policy_id, publication_status, synthetic)
values ('app_harbor_probe', 'var_probe_base', 'year_probe_2024', 'mkt_probe', 'policy_publishing_probe', 'published', false);
insert into catalogue_alias (id, applicability_id, kind, normalized_name) values ('alias_harbor_probe', 'app_harbor_probe', 'brand', 'harbor probe');
insert into catalogue_brand (id, name, slug) values ('brand_bypass', 'Bypass Probe', 'bypass-probe');
insert into catalogue_model (id, brand_id, name, slug) values ('model_bypass', 'brand_bypass', 'Unreviewed Sedan', 'unreviewed-sedan');
insert into catalogue_generation (id, model_id, name, slug) values ('gen_bypass', 'model_bypass', 'Mark', 'mark');
insert into catalogue_market_variant (id, generation_id, sales_market_id, name) values ('var_bypass', 'gen_bypass', 'mkt_probe', 'Base');
insert into catalogue_applicability (
  id, market_variant_id, model_year_id, sales_market_id, source_policy_id, publication_status, synthetic
) values (
  'app_bypass_probe', 'var_bypass', 'year_probe_2024', 'mkt_probe', 'policy_publishing_probe', 'published', false
);
insert into catalogue_alias (id, applicability_id, kind, normalized_name) values ('alias_bypass_probe', 'app_bypass_probe', 'brand', 'bypass probe');
insert into catalogue_sourced_fact (
  id, applicability_id, source_policy_id, property, state, raw_value, normalized_value, unit, measurement_standard,
  source_title, source_url, observed_on, retrieved_on, reviewed_on, review_status, publication_status, curated,
  curated_reason, unknown_reason, conflicts_with_fact_id, sort_order
) values (
  'fact_bypass', 'app_bypass_probe', 'policy_publishing_probe', 'Body', 'known', 'secret bypass fact', 'secret bypass fact', null, null,
  'Bypass dossier', null, '2026-10-22', '2026-10-23', '2026-10-23', 'reviewed', 'published', true,
  null, null, null, 1
);
insert into catalogue_sourced_fact (
  id, applicability_id, source_policy_id, property, state, raw_value, normalized_value, unit, measurement_standard,
  source_title, source_url, observed_on, retrieved_on, reviewed_on, review_status, publication_status, curated,
  curated_reason, unknown_reason, conflicts_with_fact_id, sort_order
) values (
  'fact_harbor_body', 'app_harbor_probe', 'policy_publishing_probe', 'Body', 'known', 'sedan', 'sedan', null, 'probe-body',
  'Reviewed public probe dossier', null, '2026-10-22', '2026-10-23', '2026-10-23', 'reviewed', 'published', true,
  null, null, null, 1
);
insert into catalogue_price_reference (
  id, applicability_id, source_policy_id, sales_market_id, amount_minor, currency, minor_unit_exponent, basis,
  tax_inclusivity, observed_on, review_status, publication_status, source_title, source_url, source_identifier,
  retrieved_on, reviewed_on
) values (
  'price_harbor_probe', 'app_harbor_probe', 'policy_publishing_probe', 'mkt_probe', 100000, 'INR', 2, 'official price reference',
  'unspecified', '2026-10-22', 'reviewed', 'published', 'Reviewed public probe price sheet',
  'https://example.invalid/harbor-probe-price', null, '2026-10-23', '2026-10-23'
);
insert into publishing_source_policy (
  id, provider_key, fact_permission, image_permission, permitted_fields, permitted_geographies,
  attribution, retention_seconds, derivative_restriction, aggregation_restriction,
  refresh_interval_seconds, permission_expires_at, takedown_obligation, deletion_obligation,
  contract_text, suspended, reviewer_ref, reviewed_at, created_at
) values (
  'policy_publishing_probe', 'probe', 'permitted', 'denied',
  '["displayName","alias","salesMarket","modelYearLabel","Body","Rank","priceReference","brand","model","generation","marketVariant"]'::jsonb,
  '["IN"]'::jsonb,
  'Reviewed public probe attribution.',
  315360000, 'no derivatives', 'no aggregation', 86400,
  '2099-01-01T00:00:00.000Z', 'withdraw on request', 'delete on expiry',
  null, false, 'policy-reviewer', '2026-10-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z'
);
insert into publishing_import_batch (
  id, idempotency_key, provider_key, payload_hash, status, result, created_at
) values (
  'batch_probe', 'probe-batch', 'probe', 'probe-hash', 'published',
  '{"status":"published","idempotencyKey":"probe-batch","publishedSubjectIds":["app_harbor_probe"]}'::jsonb,
  '2026-10-23T00:00:00.000Z'
);
insert into publishing_projection_generation (id, generation, published_at, batch_id)
values ('generation_probe', 1, '2026-10-23T00:00:00.000Z', 'batch_probe');
insert into publishing_projection_pointer (id, generation_id, updated_at)
values (1, 'generation_probe', '2026-10-23T00:00:00.000Z');
insert into publishing_published_assertion (
  id, generation_id, provider_key, external_id, canonical_subject_id, display_name, aliases,
  sales_market, model_year_label, facts, media, attribution, source_policy_id,
  factual_reviewer_ref, rights_reviewer_ref, captured_at, observed_at, reviewed_at, price_reference
) values (
  'assertion_harbor_probe', 'generation_probe', 'probe', 'harbor-probe', 'app_harbor_probe',
  'Harbor Probe', '[]'::jsonb, 'IN', '2024',
  '[{"property":"Body","rawValue":"sedan","normalizedValue":"sedan","state":"known","unknownReason":null,"unit":null,"standard":"probe-body","sourceUrl":null,"sourceTitle":"Reviewed public probe dossier","providerKey":"probe","observedAt":"2026-10-22T00:00:00.000Z","retrievedAt":"2026-10-23T00:00:00.000Z","sourcePolicyId":"policy_publishing_probe","factualReviewerRef":"fact-reviewer","rightsReviewerRef":"rights-reviewer"}]'::jsonb,
  '[]'::jsonb, 'Reviewed public probe attribution.', 'policy_publishing_probe',
  'fact-reviewer', 'rights-reviewer', '2026-10-23T00:00:00.000Z', '2026-10-22T00:00:00.000Z', '2026-10-23T00:00:00.000Z',
  '{"amountMinor":100000,"currency":"INR","minorUnitExponent":2,"basis":"official price reference","taxInclusivity":"unspecified","observedOn":"2026-10-22","retrievedOn":"2026-10-23","reviewedOn":"2026-10-23","sourceTitle":"Reviewed public probe price sheet","sourceUrl":"https://example.invalid/harbor-probe-price","sourceIdentifier":null}'::jsonb
);
`;
