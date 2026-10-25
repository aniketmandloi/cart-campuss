import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { insertSyntheticPreviewFixture } from "@cart-campuss/api/catalogue-fixture";
import { createCatalogueContextFromClient } from "@cart-campuss/api/catalogue-runtime";
import type { Context } from "@cart-campuss/api/context";
import { openIsolatedCatalogueDatabase, runPsql } from "@cart-campuss/api/psql-client";

import { CatalogueBrandView } from "../src/catalogue/browse-view";
import { loadCatalogueBrandForContext, loadCatalogueHomeForContext } from "../src/catalogue/load-state";
import { CatalogueSearchView } from "../src/catalogue/views";
import { acquireCataloguePublicLock } from "./catalogue-public-lock";

const databaseUrl = process.env.CATALOGUE_TEST_DATABASE_URL ?? "";
const psql = process.env.PSQL ?? "";
const hidden = /Kestrel Fixture|Sample Hatch|Secret Shelf|Preview Shelf|Bypass Probe|provider-secret-do-not-project|secret bypass fact|geolocation|navigator/;

describe(
  "home and brand browse",
  {
    concurrency: 1,
    timeout: 180_000,
    skip:
      databaseUrl && psql
        ? false
        : "Set CATALOGUE_TEST_DATABASE_URL to a localhost database and PSQL to the psql binary. The home and brand journey was not run.",
  },
  () => {
    let emptyContext: Context;
    let publicContext: Context;
    let previewContext: Context;
    const closers: Array<() => void> = [];
    let releasePublicLock: (() => void) | undefined;

    before(async () => {
      releasePublicLock = acquireCataloguePublicLock();
      try {
        const empty = openIsolatedCatalogueDatabase({ databaseUrl, psql });
        closers.push(empty.close);
        emptyContext = createCatalogueContextFromClient(empty.client, false);

        const populated = openIsolatedCatalogueDatabase({ databaseUrl, psql });
        closers.push(populated.close);
        const preview = createCatalogueContextFromClient(populated.client, true);
        await insertSyntheticPreviewFixture(preview.db);
        runPsql({ databaseUrl, psql, schema: populated.schema, sql: browseProbeSql });
        publicContext = createCatalogueContextFromClient(populated.client, false);
        previewContext = preview;
      } catch (error) {
        for (const close of closers) close();
        closers.length = 0;
        releasePublicLock();
        releasePublicLock = undefined;
        throw error;
      }
    });

    after(() => {
      try {
        for (const close of closers) close();
      } finally {
        releasePublicLock?.();
        releasePublicLock = undefined;
      }
    });

    test("an empty public catalogue explains that nothing is published", async () => {
      const { home, html } = await renderHome(emptyContext);
      assert.equal(home.kind, "ready");
      if (home.kind !== "ready") return;
      assert.equal(home.home.coverage.publishedOn, null);
      assert.equal(home.home.coverage.brands, 0);
      assert.equal(home.home.coverage.models, 0);
      assert.equal(home.home.coverage.applicabilityRecords, 0);
      assert.equal(home.home.jurisdictions.length, 36);
      assert.match(html, /Search the catalogue/);
      assert.match(html, /Car name/);
      assert.match(html, /No public projection is published/);
      assert.match(html, /0 brands, 0 models, and 0 applicability records in this catalogue/);
      assert.match(html, /These counts are not production totals, seller stock, or worldwide completeness/);
      assert.match(html, /No public records are published/);
      assert.match(html, /Unpublished records are omitted/);
      assert.match(html, /Registration jurisdiction/);
      assert.match(html, /Maharashtra/);
      assert.match(html, /This site does not request your location/);
      assert.match(html, /No published brand is in this catalogue/);
      assert.match(html, /No curated collection is published/);
      assert.equal(html.match(/<option /g)?.length, 37);
      assert.doesNotMatch(html, hidden);
    });

    test("home lists published brands and collections without fixtures or an invented variant", async () => {
      const { home, html } = await renderHome(publicContext);
      assert.equal(home.kind, "ready");
      if (home.kind !== "ready") return;
      assert.equal(home.home.coverage.publishedOn, "2026-10-23");
      assert.equal(home.home.coverage.brands, 1);
      assert.equal(home.home.coverage.models, 2);
      assert.equal(home.home.coverage.applicabilityRecords, 1);
      assert.equal(home.home.brands.length, 1);
      assert.equal(home.home.fixtureBrands.length, 0);
      assert.equal(home.home.collections.length, 1);
      assert.equal(home.home.collections[0]?.members.length, 1);
      assert.equal(home.home.collections[0]?.members[0]?.href, "/cars/plain-sedan/mark-one");
      assert.match(html, /Public projection published 2026-10-23/);
      assert.match(html, /1 brand, 2 models, and 1 applicability record in this catalogue/);
      assert.match(html, /href="\/brands\/harbor-probe"/);
      assert.match(html, /Harbor Probe/);
      assert.match(html, /2 models in this catalogue/);
      assert.match(html, /India Desk/);
      assert.match(html, /href="\/cars\/plain-sedan\/mark-one"/);
      assert.match(html, /Mark One\. No variant is selected/);
      assert.doesNotMatch(html, /market=|year=|variant=/);
      assert.doesNotMatch(html, hidden);
    });

    test("the chosen registration jurisdiction carries through links and an unknown place does not", async () => {
      const chosen = await renderHome(publicContext, "in-mh");
      assert.equal(chosen.home.kind, "ready");
      if (chosen.home.kind !== "ready") return;
      assert.equal(chosen.home.home.registration?.name, "Maharashtra");
      assert.match(chosen.html, /Registration jurisdiction: Maharashtra/);
      assert.match(chosen.html, /href="\/brands\/harbor-probe\?registration=in-mh"/);
      assert.match(chosen.html, /href="\/cars\/plain-sedan\/mark-one\?registration=in-mh"/);
      assert.match(chosen.html, /name="registration" value="in-mh"/);
      assert.doesNotMatch(chosen.html, /income|debt|deposit|take-home|emi|market=|year=|variant=/);
      assert.doesNotMatch(chosen.html, hidden);

      const dropped = await renderHome(publicContext, "income");
      assert.equal(dropped.home.kind, "ready");
      if (dropped.home.kind !== "ready") return;
      assert.equal(dropped.home.home.registration, null);
      assert.doesNotMatch(dropped.html, /income|debt|deposit|take-home|emi/);
    });

    test("a brand page groups published models by generation and status", async () => {
      const page = await renderBrand(publicContext, { brandSlug: "harbor-probe" });
      assert.equal(page.state.kind, "page");
      if (page.state.kind !== "page" || page.state.page.availability !== "visible") {
        assert.fail("Harbor Probe is not a visible brand");
      }
      assert.equal(page.state.page.publicGroups.length, 2);
      const sedan = page.state.page.publicGroups.find((group) => group.modelSlug === "plain-sedan");
      const note = page.state.page.publicGroups.find((group) => group.modelSlug === "margin-note");
      assert.equal(sedan?.status, "applicability");
      assert.equal(sedan?.recordCount, 1);
      assert.equal(sedan?.href, "/cars/plain-sedan/mark-one");
      assert.equal(note?.status, "generation");
      assert.equal(note?.href, "/cars/margin-note/open-sheet");
      assert.match(page.html, /Harbor Probe/);
      assert.match(page.html, /2 records in this catalogue/);
      assert.match(page.html, /Not a production total, seller stock, or worldwide completeness/);
      assert.match(records(page.html), /Plain Sedan/);
      assert.match(records(page.html), /Mark One/);
      assert.match(records(page.html), /Applicability records/);
      assert.match(records(page.html), /Margin Note/);
      assert.match(records(page.html), /Open Sheet/);
      assert.match(records(page.html), /Generation record/);
      assert.match(records(page.html), /href="\/cars\/plain-sedan\/mark-one"/);
      assert.match(records(page.html), /href="\/cars\/margin-note\/open-sheet"/);
      assert.doesNotMatch(page.html, /market=|year=|variant=/);
      assert.doesNotMatch(page.html, hidden);

      const generationOnly = await renderBrand(publicContext, {
        brandSlug: "harbor-probe",
        status: "generation",
      });
      assert.match(records(generationOnly.html), /Margin Note/);
      assert.doesNotMatch(records(generationOnly.html), /Plain Sedan/);
      assert.match(generationOnly.html, /1 record in this catalogue/);

      const oneGeneration = await renderBrand(publicContext, {
        brandSlug: "harbor-probe",
        generation: "gen_mark_one",
      });
      assert.match(records(oneGeneration.html), /Plain Sedan/);
      assert.doesNotMatch(records(oneGeneration.html), /Margin Note/);

      const noModelShell = await renderBrand(publicContext, {
        brandSlug: "harbor-probe",
        status: "model",
      });
      assert.match(noModelShell.html, /No published record matches this narrowing/);
      assert.doesNotMatch(records(noModelShell.html), /Plain Sedan|Margin Note/);

      const missing = await renderBrand(publicContext, { brandSlug: "missing-brand" });
      assert.match(missing.html, /Not in the public catalogue/);
      assert.doesNotMatch(missing.html, /Harbor Probe|Plain Sedan/);

      const fixture = await renderBrand(publicContext, { brandSlug: "kestrel-fixture" });
      assert.match(fixture.html, /Not in the public catalogue/);
      assert.doesNotMatch(fixture.html, hidden);
    });

    test("private preview labels fixtures and leaves them out of the public counts", async () => {
      const { home, html } = await renderHome(previewContext);
      assert.equal(home.kind, "ready");
      if (home.kind !== "ready") return;
      assert.equal(home.home.coverage.brands, 1);
      assert.equal(home.home.coverage.models, 2);
      assert.equal(home.home.coverage.applicabilityRecords, 1);
      assert.equal(home.home.fixtureBrands.length, 1);
      assert.equal(home.home.fixtureBrands[0]?.name, "Kestrel Fixture");
      assert.match(html, /1 brand, 2 models, and 1 applicability record in this catalogue/);
      assert.match(html, /id="published-brands"[\s\S]*Harbor Probe/);
      assert.match(html, /id="fixture-brands"[\s\S]*Kestrel Fixture/);
      assert.match(html, /Synthetic fixture\. Not a manufacturer publication/);
      assert.match(html, /Not included in the public counts/);
      assert.match(html, /Preview Shelf/);
      assert.match(html, /href="\/cars\/sample-hatch\/series-one"/);
      assert.doesNotMatch(html, /Secret Shelf|provider-secret-do-not-project|market=|year=|variant=/);

      const brand = await renderBrand(previewContext, { brandSlug: "kestrel-fixture" });
      assert.match(brand.html, /Kestrel Fixture/);
      assert.match(brand.html, /Sample Hatch/);
      assert.match(brand.html, /Synthetic fixture/);
      assert.match(brand.html, /Not included in the public counts/);
      assert.match(brand.html, /0 records in this catalogue/);
      assert.match(brand.html, /href="\/cars\/sample-hatch\/series-one"/);
      assert.doesNotMatch(brand.html, /market=|year=|variant=|provider-secret-do-not-project/);
    });
  },
);

async function renderHome(runtime: Context, registration?: string) {
  const home = await loadCatalogueHomeForContext(runtime, { registration });
  const registrationId = home.kind === "ready" ? (home.home.registration?.id ?? null) : null;
  return {
    home,
    html: renderToStaticMarkup(
      <CatalogueSearchView
        state={{ kind: "idle", query: "", privatePreview: runtime.access.allowFixtures }}
        registrationId={registrationId}
        browse={home}
      />,
    ),
  };
}

async function renderBrand(
  runtime: Context,
  input: { brandSlug: string; generation?: string; status?: string; registration?: string },
) {
  const state = await loadCatalogueBrandForContext(runtime, input);
  return { state, html: renderToStaticMarkup(<CatalogueBrandView state={state} />) };
}

function records(html: string): string {
  const start = html.indexOf('id="brand-records"');
  if (start < 0) return "";
  const end = html.indexOf("</ul>", start);
  return end < 0 ? html.slice(start) : html.slice(start, end);
}

const browseProbeSql = `
insert into catalogue_source_policy (id, name, audience, permits_public_catalogue, rights_review, attribution, internal_note)
values
  ('policy_publishing_probe', 'Reviewed public policy', 'public', true, 'reviewed', 'Reviewed public probe attribution.', 'provider-secret-do-not-project'),
  ('policy_collection_probe', 'Reviewed collection policy', 'public', true, 'reviewed', 'Reviewed collection attribution.', 'collection-office-note');
insert into catalogue_sales_market (id, name, country_code) values ('mkt_probe', 'Probe market', 'IN');
insert into catalogue_brand (id, name, slug) values
  ('brand_harbor_probe', 'Harbor Probe', 'harbor-probe'),
  ('brand_bypass', 'Bypass Probe', 'bypass-probe');
insert into catalogue_model (id, brand_id, name, slug) values
  ('model_plain_sedan', 'brand_harbor_probe', 'Plain Sedan', 'plain-sedan'),
  ('model_margin_note', 'brand_harbor_probe', 'Margin Note', 'margin-note'),
  ('model_bypass', 'brand_bypass', 'Unreviewed Sedan', 'unreviewed-sedan');
insert into catalogue_generation (id, model_id, name, slug, publication_status, synthetic, source_policy_id) values
  ('gen_mark_one', 'model_plain_sedan', 'Mark One', 'mark-one', 'published', false, 'policy_publishing_probe'),
  ('gen_open_sheet', 'model_margin_note', 'Open Sheet', 'open-sheet', 'published', false, 'policy_publishing_probe'),
  ('gen_bypass', 'model_bypass', 'Mark', 'mark', 'published', false, 'policy_publishing_probe');
insert into catalogue_model_year (id, label, convention) values ('year_probe_2024', '2024', 'Manufacturer model-year label. Not the calendar build year.');
insert into catalogue_market_variant (id, generation_id, sales_market_id, name) values
  ('var_probe_base', 'gen_mark_one', 'mkt_probe', 'Base'),
  ('var_bypass', 'gen_bypass', 'mkt_probe', 'Base');
insert into catalogue_applicability (
  id, market_variant_id, model_year_id, sales_market_id, source_policy_id, publication_status, synthetic
) values
  ('app_harbor_probe', 'var_probe_base', 'year_probe_2024', 'mkt_probe', 'policy_publishing_probe', 'published', false),
  ('app_bypass_probe', 'var_bypass', 'year_probe_2024', 'mkt_probe', 'policy_publishing_probe', 'published', false);
insert into catalogue_collection (id, slug, name, summary, source_policy_id, publication_status, synthetic) values
  ('collection_india_desk', 'india-desk', 'India Desk', 'Published records from this catalogue.', 'policy_collection_probe', 'published', false),
  ('collection_secret_shelf', 'secret-shelf', 'Secret Shelf', 'This collection was not published.', 'policy_collection_probe', 'published', false),
  ('collection_preview_shelf', 'preview-shelf', 'Preview Shelf', 'A labelled fixture collection.', 'policy_synthetic_preview', 'fixture', true);
insert into catalogue_collection_member (id, collection_id, generation_id, sort_order) values
  ('member_india_harbor', 'collection_india_desk', 'gen_mark_one', 1),
  ('member_india_bypass', 'collection_india_desk', 'gen_bypass', 2),
  ('member_preview_kestrel', 'collection_preview_shelf', 'gen_series_one', 1);
insert into publishing_source_policy (
  id, provider_key, fact_permission, image_permission, permitted_fields, permitted_geographies,
  attribution, retention_seconds, derivative_restriction, aggregation_restriction,
  refresh_interval_seconds, permission_expires_at, takedown_obligation, deletion_obligation,
  contract_text, suspended, reviewer_ref, reviewed_at, created_at
) values
  (
    'policy_publishing_probe', 'probe', 'permitted', 'denied',
    '["displayName","alias","salesMarket","modelYearLabel","Body","brand","model","generation","marketVariant"]'::jsonb,
    '["IN"]'::jsonb,
    'Reviewed public probe attribution.',
    315360000, 'no derivatives', 'no aggregation', 86400,
    '2099-01-01T00:00:00.000Z', 'withdraw on request', 'delete on expiry',
    null, false, 'policy-reviewer', '2026-10-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z'
  ),
  (
    'policy_collection_probe', 'collection-probe', 'permitted', 'denied',
    '["displayName","collection"]'::jsonb,
    '["IN"]'::jsonb,
    'Reviewed collection attribution.',
    315360000, 'no derivatives', 'no aggregation', 86400,
    '2099-01-01T00:00:00.000Z', 'withdraw on request', 'delete on expiry',
    null, false, 'policy-reviewer', '2026-10-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z'
  );
insert into publishing_import_batch (id, idempotency_key, provider_key, payload_hash, status, result, created_at)
values (
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
  factual_reviewer_ref, rights_reviewer_ref, captured_at, observed_at, reviewed_at,
  identity_scope, rights_geographies
) values
  (
    'assertion_harbor_probe', 'generation_probe', 'probe', 'harbor-probe', 'app_harbor_probe',
    'Harbor Probe', '[]'::jsonb, 'IN', '2024',
    '[]'::jsonb, '[]'::jsonb, 'Reviewed public probe attribution.', 'policy_publishing_probe',
    'fact-reviewer', 'rights-reviewer', '2026-10-23T00:00:00.000Z', null, '2026-10-23T00:00:00.000Z',
    'applicability', '[]'::jsonb
  ),
  (
    'assertion_open_sheet', 'generation_probe', 'probe', 'open-sheet', 'gen_open_sheet',
    'Margin Note', '[]'::jsonb, 'IN', null,
    '[]'::jsonb, '[]'::jsonb, 'Reviewed public probe attribution.', 'policy_publishing_probe',
    'fact-reviewer', 'rights-reviewer', '2026-10-23T00:00:00.000Z', null, '2026-10-23T00:00:00.000Z',
    'generation', '["IN"]'::jsonb
  ),
  (
    'assertion_india_desk', 'generation_probe', 'collection-probe', 'india-desk', 'collection_india_desk',
    'India Desk', '[]'::jsonb, 'IN', null,
    '[]'::jsonb, '[]'::jsonb, 'Reviewed collection attribution.', 'policy_collection_probe',
    'fact-reviewer', 'rights-reviewer', '2026-10-23T00:00:00.000Z', null, '2026-10-23T00:00:00.000Z',
    'collection', '["IN"]'::jsonb
  );
`;
