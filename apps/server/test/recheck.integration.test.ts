import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";

import { cleanupPublishingCopies, PublishingRejected } from "@cart-campuss/api/publishing";
import { runScheduledRecheck } from "@cart-campuss/api/recheck";
import { appRouter } from "@cart-campuss/api/routers/index";
import { sql, type Database } from "@cart-campuss/db";
import {
  publishingAuditEvent,
  publishingPublishedAssertion,
  publishingRecheckTarget,
  publishingSourcePolicy,
} from "@cart-campuss/db/schema/publishing";

import { createApp, type AppDeps } from "../src/app";
import { startPublishingDatabase } from "./ephemeral-postgres";

const requireFromWeb = createRequire(new URL("../../web/package.json", import.meta.url));
Object.assign(globalThis, { React: requireFromWeb("react") });
const { createElement } = requireFromWeb("react") as {
  createElement: (type: (props: { state: unknown }) => unknown, props: { state: unknown }) => unknown;
};
const { renderToStaticMarkup } = requireFromWeb("react-dom/server") as {
  renderToStaticMarkup: (element: unknown) => string;
};

const REVIEWED = "2026-10-22T00:00:00.000Z";
const NOON = "2026-10-22T12:00:00.000Z";
const SPEC_DUE = "2027-01-20T00:00:00.000Z";
const SPEC_NEXT = "2027-04-20T00:00:00.000Z";
const PRICE_DUE = "2026-10-29T00:00:00.000Z";
const DIRECTORY_DUE = "2026-11-21T00:00:00.000Z";
const FEED_DUE = "2026-10-23T00:00:00.000Z";
const OPERATOR_TOKEN = "test-operator-token-32-characters-min";
const LONG_RETENTION = 60 * 60 * 24 * 365 * 10;
const PRIVATE = {
  contract: "CONTRACT-TEXT-NOT-PUBLIC",
  payload: "PAYLOAD-NOT-PUBLIC",
  takedown: "TAKEDOWN-OBLIGATION-NOT-PUBLIC",
  deletion: "DELETION-OBLIGATION-NOT-PUBLIC",
  derivative: "DERIVATIVE-RESTRICTION-NOT-PUBLIC",
  aggregation: "AGGREGATION-RESTRICTION-NOT-PUBLIC",
};

let db: Database;
let app: ReturnType<typeof createApp>;
let holdAdvisoryLock: Awaited<ReturnType<typeof startPublishingDatabase>>["holdAdvisoryLock"];
let stopDatabase: (() => Promise<void>) | undefined;

before(async () => {
  const started = await startPublishingDatabase();
  db = started.db;
  holdAdvisoryLock = started.holdAdvisoryLock;
  stopDatabase = started.stop;
  app = createApp({
    db,
    now: () => new Date(NOON),
    operatorToken: OPERATOR_TOKEN,
    corsOrigin: "http://localhost:3001",
    log: false,
  } satisfies AppDeps);
});

after(async () => {
  await stopDatabase?.();
});

describe("recheck, expiry, and withdrawal", { timeout: 120_000 }, () => {
  it("records recheck times and a missed interval keeps the last review without turning an unknown into zero", async () => {
    const input = catalogueImport("Harbor Coupe");
    input.sourcePolicy.refreshIntervalSeconds = 86_400;
    const record = input.records[0];
    assert.ok(record);
    record.document.sourceDirectory = [
      {
        title: "Harbor maker page",
        url: "https://example.test/sources/harbor-directory",
        observedAt: REVIEWED,
        retrievedAt: REVIEWED,
        reviewedAt: REVIEWED,
      },
    ];
    record.document.listings = [
      listing("lot-harbor", "Harbor asking card", "active"),
      listing("lot-inland", "Inland asking card", "active"),
    ];
    assert.equal((await caller().publishing.submit(input)).status, "published");

    const seeded = await runScheduledRecheck(deps(), OPERATOR_TOKEN, null);
    assert.equal(JSON.stringify(seeded).includes(PRIVATE.payload), false);
    assert.equal(JSON.stringify(seeded).includes(PRIVATE.contract), false);
    const power = seeded.targets.find((target) => target.targetKey === "power");
    const price = seeded.targets.find((target) => target.kind === "model-price");
    const directory = seeded.targets.find((target) => target.kind === "source-directory-url");
    const feed = seeded.targets.find((target) => target.targetKey === "lot-harbor");
    assert.equal(power?.nextRecheckAt, SPEC_DUE);
    assert.equal(power?.lastReviewedAt, REVIEWED);
    assert.equal(power?.fetchedAt, REVIEWED);
    assert.equal(power?.lastSuccessfulProviderSyncAt, REVIEWED);
    assert.equal(power?.freshness, "current");
    assert.equal(price?.nextRecheckAt, PRICE_DUE);
    assert.equal(directory?.nextRecheckAt, DIRECTORY_DUE);
    assert.equal(feed?.nextRecheckAt, FEED_DUE);
    assert.equal(feed?.freshness, "current");

    let html = await renderCar("harbor coupe");
    assert.match(html, /Next recheck 2027-01-20T00:00:00.000Z/);
    assert.match(html, /Next recheck 2026-10-29T00:00:00.000Z/);
    assert.match(html, /Next recheck 2026-11-21T00:00:00.000Z/);
    assert.match(html, /Last provider sync 2026-10-22T00:00:00.000Z/);
    assert.match(html, /Search official and marketplace sources/);
    assert.match(html, /Harbor maker page/);
    assert.match(html, /Active as last observed 2026-10-22T00:00:00.000Z/);
    assert.match(html, /100 PS/);
    assert.match(html, /The labelled test does not include a measured torque/);
    assert.doesNotMatch(html, /not-a-measurement|invented-unit|Sold|0 available/);

    const missed = await runScheduledRecheck(deps(() => new Date(SPEC_DUE)), OPERATOR_TOKEN, null);
    assert.equal(missed.audits.some((audit) => audit.kind === "recheck-missed" && audit.targetKey === "power"), true);
    assert.equal(missed.audits.some((audit) => /sold/i.test(audit.summary)), false);
    html = await renderCar("harbor coupe");
    assert.match(html, /Stale\. Last reviewed 2026-10-22T00:00:00\.000Z/);
    assert.match(html, /100 PS/);
    assert.match(html, /250000 INR minor units/);
    assert.match(html, /The labelled test does not include a measured torque/);
    assert.match(html, /Not a current listing\. Last observed 2026-10-22T00:00:00\.000Z/);
    assert.doesNotMatch(html, /Active as last observed|Sold|0 available|not-a-measurement/);

    const refreshed = await runScheduledRecheck(deps(() => new Date(SPEC_DUE)), OPERATOR_TOKEN, {
      outcomes: [
        {
          providerKey: "manual-test",
          externalId: "ext-harbor-coupe",
          kind: "editorial-specification",
          targetKey: "power",
          outcome: "succeeded",
          observedAt: SPEC_DUE,
          fetchedAt: SPEC_DUE,
          reviewedAt: SPEC_DUE,
        },
      ],
    });
    const refreshedPower = refreshed.targets.find((target) => target.targetKey === "power");
    const refreshedTorque = refreshed.targets.find((target) => target.targetKey === "torque");
    assert.equal(refreshedPower?.freshness, "current");
    assert.equal(refreshedPower?.nextRecheckAt, SPEC_NEXT);
    assert.equal(refreshedPower?.lastSuccessfulProviderSyncAt, SPEC_DUE);
    assert.equal(refreshedTorque?.freshness, "stale");
    assert.equal(refreshedTorque?.lastReviewedAt, REVIEWED);
    html = await renderCar("harbor coupe");
    assert.match(html, /Next recheck 2027-04-20T00:00:00.000Z/);
    assert.match(html, /Stale\. Last reviewed 2026-10-22T00:00:00\.000Z/);
    assert.match(html, /100 PS/);
    assert.match(html, /The labelled test does not include a measured torque/);
  });

  it("keeps permitted history when a provider fails and does not mark the catalogue sold", async () => {
    const input = catalogueImport("Outage Coupe");
    input.sourcePolicy.refreshIntervalSeconds = 86_400;
    const record = input.records[0];
    assert.ok(record);
    record.document.listings = [
      listing("lot-outage", "Outage asking card", "active"),
      listing("lot-steady", "Steady asking card", "active"),
    ];
    input.sourcePolicy.permittedFields = [...input.sourcePolicy.permittedFields, "approvedFeed"];
    const survivor = catalogueImport("Steady Wagon");
    assert.equal((await caller().publishing.submit(input)).status, "published");
    assert.equal((await caller().publishing.submit(survivor)).status, "published");
    await runScheduledRecheck(deps(), OPERATOR_TOKEN, null);

    const failed = await runScheduledRecheck(deps(), OPERATOR_TOKEN, {
      outcomes: [
        {
          providerKey: "manual-test",
          externalId: "ext-outage-coupe",
          kind: "approved-feed",
          targetKey: "lot-outage",
          outcome: "failed",
          confirmedLifecycle: "ended",
        },
        {
          providerKey: "manual-test",
          externalId: "ext-outage-coupe",
          kind: "editorial-specification",
          targetKey: "power",
          outcome: "failed",
        },
      ],
    });
    assert.equal(failed.audits.some((audit) => audit.kind === "provider-failure"), true);
    assert.equal(failed.targets.find((target) => target.targetKey === "lot-outage")?.lifecycle, "active");
    assert.equal(failed.targets.find((target) => target.targetKey === "lot-steady")?.freshness, "current");
    const html = await renderCar("outage coupe");
    assert.match(html, /Status unknown\. Last observed 2026-10-22T00:00:00\.000Z/);
    assert.match(html, /Not checked\. Last reviewed 2026-10-22T00:00:00\.000Z/);
    assert.match(html, /Active as last observed 2026-10-22T00:00:00\.000Z/);
    assert.match(html, /100 PS/);
    assert.match(html, /1800000 INR minor units/);
    assert.doesNotMatch(html, /Sold|Ended\.|0 available/);
    assert.equal((await caller().catalogue.search({ q: "steady wagon" })).hits.length, 1);
  });

  it("does not add a public result from a suspended source", async () => {
    const quiet = catalogueImport("Quiet Saloon");
    const steady = catalogueImport("Parked Estate");
    assert.equal((await caller().publishing.submit(quiet)).status, "published");
    assert.equal((await caller().publishing.submit(steady)).status, "published");
    await runScheduledRecheck(deps(), OPERATOR_TOKEN, null);
    await db
      .update(publishingSourcePolicy)
      .set({ suspended: true })
      .where(sql`${publishingSourcePolicy.id} = ${quiet.sourcePolicy.id ?? ""}`);
    const result = await runScheduledRecheck(deps(), OPERATOR_TOKEN, {
      outcomes: [
        {
          providerKey: "manual-test",
          externalId: "ext-quiet-saloon",
          kind: "editorial-specification",
          targetKey: "power",
          outcome: "succeeded",
          reviewedAt: "2027-01-20T00:00:00.000Z",
          fetchedAt: "2027-01-20T00:00:00.000Z",
        },
      ],
    });
    assert.equal(result.rejected[0]?.code, "suspended");
    assert.equal(result.targets.find((target) => target.externalId === "ext-quiet-saloon" && target.targetKey === "power")?.lastReviewedAt, REVIEWED);
    assert.equal(JSON.stringify(result).includes(PRIVATE.contract), false);
    assert.equal((await caller().catalogue.search({ q: "quiet saloon" })).hits.length, 0);
    assert.equal((await caller().catalogue.search({ q: "parked estate" })).hits.length, 1);
    assert.equal((await auditsFor("subject-quiet-saloon")).some((audit) => audit.kind === "suspension"), true);
    assert.equal((await auditsFor("subject-quiet-saloon")).some((audit) => /sold/i.test(audit.summary)), false);
  });

  it("hides a listing whose rights do not permit a live claim", async () => {
    const input = catalogueImport("Unlicensed Feed");
    input.sourcePolicy.permittedFields = input.sourcePolicy.permittedFields.filter(
      (field) => field !== "approvedFeed" && field !== "sourceDirectory",
    );
    const record = input.records[0];
    assert.ok(record);
    record.document.listings = [listing("lot-secret", "Secret stock card", "active")];
    assert.equal((await caller().publishing.submit(input)).status, "published");
    const html = await renderCar("unlicensed feed");
    assert.match(html, /No market data/);
    assert.doesNotMatch(html, /Secret stock card|Active as last observed/);
  });

  it("withdraws one source from search, detail, and a later replay without restoring it", async () => {
    const departed = catalogueImport("Departed Roadster");
    const remaining = catalogueImport("Remaining Hatch");
    assert.equal((await caller().publishing.submit(departed)).status, "published");
    assert.equal((await caller().publishing.submit(remaining)).status, "published");
    const before = await requestJson("GET", "/api/trpc/catalogue.search", { q: "departed roadster" });
    assert.equal(before.cacheControl, "private, no-store");
    assert.match(before.text, /Departed Roadster/);

    const withdrawn = await caller().publishing.withdraw({
      providerKey: "manual-test",
      externalId: "ext-departed-roadster",
    });
    assert.equal(withdrawn.withdrawn > 0, true);
    assert.equal(withdrawn.audits[0]?.kind, "withdrawal");
    assert.equal(JSON.stringify(withdrawn).includes(PRIVATE.payload), false);
    assert.equal((await caller().catalogue.search({ q: "departed roadster" })).hits.length, 0);
    assert.equal(await caller().publishing.detail({ subjectId: "subject-departed-roadster" }), null);
    assert.equal((await caller().catalogue.search({ q: "remaining hatch" })).hits.length, 1);
    const page = await renderAddress("model-departed-roadster", "var-departed-roadster");
    assert.match(page, /not in the public catalogue/i);
    assert.doesNotMatch(page, /example\.test\/images\/departed-roadster|100 PS/);

    const replay = await caller().publishing.submit(departed);
    assert.equal(replay.status, "replayed");
    assert.equal(await caller().publishing.detail({ subjectId: "subject-departed-roadster" }), null);
    const after = await requestJson("GET", "/api/trpc/catalogue.search", { q: "departed roadster" });
    assert.equal(after.cacheControl, "private, no-store");
    assert.doesNotMatch(after.text, /Departed Roadster/);
  });

  it("audits expiry without turning the remaining catalogue into a sale", async () => {
    const captured = () => new Date("2026-10-22T00:00:01.000Z");
    const ephemeral = catalogueImport("Ephemeral Copy");
    ephemeral.sourcePolicy.retentionSeconds = 60;
    const durable = catalogueImport("Durable Copy");
    assert.equal((await caller(captured).publishing.submit(ephemeral)).status, "published");
    assert.equal((await caller(captured).publishing.submit(durable)).status, "published");
    await cleanupPublishingCopies(
      { db, operatorToken: OPERATOR_TOKEN, now: () => new Date("2026-10-22T00:02:01.000Z") },
      OPERATOR_TOKEN,
    );
    assert.equal((await caller().publishing.search({ q: "Ephemeral Copy" })).length, 0);
    assert.equal((await caller().publishing.search({ q: "Durable Copy" })).length, 1);
    const audits = await auditsFor("subject-ephemeral-copy");
    assert.equal(audits.some((audit) => audit.kind === "expiry"), true);
    assert.equal(audits.some((audit) => /sold/i.test(audit.summary)), false);
    assert.equal(JSON.stringify(audits).includes(PRIVATE.payload), false);
  });

  it("does not restore source copies when the record is withdrawn while recheck waits for the lock", async () => {
    const input = catalogueImport("Raced Withdrawal");
    const record = input.records[0];
    assert.ok(record);
    record.document.sourceDirectory = [
      {
        title: "Raced directory page",
        url: "https://example.test/sources/raced-directory",
        observedAt: REVIEWED,
        retrievedAt: REVIEWED,
        reviewedAt: REVIEWED,
      },
    ];
    assert.equal((await caller().publishing.submit(input)).status, "published");
    const release = await holdAdvisoryLock(1128354388);
    const pending = runScheduledRecheck(deps(), OPERATOR_TOKEN, null).then(
      (value) => ({ value, error: null as null }),
      (error: unknown) => ({ value: null, error }),
    );
    try {
      await until(async () => {
        const [row] = await db
          .select({
            waiting: sql<boolean>`exists (
              select 1 from pg_locks where locktype = 'advisory' and objid = ${1128354388} and not granted
            )`,
          })
          .from(sql`(select 1) as lock_probe`);
        return row?.waiting === true;
      });
      await db
        .delete(publishingPublishedAssertion)
        .where(sql`${publishingPublishedAssertion.externalId} = ${"ext-raced-withdrawal"}`);
    } finally {
      await release();
    }
    const finished = await pending;
    assert.equal(finished.error, null);
    await cleanupPublishingCopies(deps(), OPERATOR_TOKEN);
    const copies = await db
      .select({ id: publishingRecheckTarget.id, targetKey: publishingRecheckTarget.targetKey })
      .from(publishingRecheckTarget)
      .where(sql`${publishingRecheckTarget.externalId} = ${"ext-raced-withdrawal"}`);
    assert.deepEqual(copies, []);
    assert.equal(await caller().publishing.detail({ subjectId: "subject-raced-withdrawal" }), null);
    const search = await requestJson("GET", "/api/trpc/catalogue.search", { q: "raced withdrawal" });
    assert.doesNotMatch(search.text, /Raced directory page|example\.test\/sources\/raced-directory/);
  });

  it("hides a directory URL after its source permission is removed", async () => {
    const input = catalogueImport("Revoked Directory");
    const record = input.records[0];
    assert.ok(record);
    record.document.sourceDirectory = [
      {
        title: "Revoked maker page",
        url: "https://example.test/directories/revoked-maker",
        observedAt: REVIEWED,
        retrievedAt: REVIEWED,
        reviewedAt: REVIEWED,
      },
    ];
    record.document.listings = [listing("lot-revoked", "Revoked asking card", "active")];
    assert.equal((await caller().publishing.submit(input)).status, "published");
    await runScheduledRecheck(deps(), OPERATOR_TOKEN, null);
    const before = await caller().publishing.detail({ subjectId: "subject-revoked-directory" });
    assert.match(JSON.stringify(before), /example\.test\/directories\/revoked-maker/);
    await db
      .update(publishingSourcePolicy)
      .set({
        permittedFields: input.sourcePolicy.permittedFields.filter((field) => field !== "sourceDirectory"),
      })
      .where(sql`${publishingSourcePolicy.id} = ${input.sourcePolicy.id ?? ""}`);
    const after = await caller().publishing.detail({ subjectId: "subject-revoked-directory" });
    const body = JSON.stringify(after);
    assert.deepEqual(after?.marketAccess?.sourceDirectory, []);
    assert.doesNotMatch(body, /example\.test\/directories\/revoked-maker|Revoked maker page/);
    assert.match(body, /Revoked asking card/);
    const html = await renderCar("revoked directory");
    assert.doesNotMatch(html, /example\.test\/directories\/revoked-maker|Revoked maker page/);
    assert.match(html, /Revoked asking card/);
  });

  it("follows a revised feed contract instead of the previous refresh interval", async () => {
    const input = catalogueImport("Hourly Feed");
    input.sourcePolicy.refreshIntervalSeconds = 86_400;
    const record = input.records[0];
    assert.ok(record);
    record.document.listings = [listing("lot-hourly", "Hourly asking card", "active")];
    assert.equal((await caller().publishing.submit(input)).status, "published");
    const first = await runScheduledRecheck(deps(), OPERATOR_TOKEN, null);
    assert.equal(first.targets.find((target) => target.targetKey === "lot-hourly")?.intervalSeconds, 86_400);
    assert.equal(first.targets.find((target) => target.targetKey === "lot-hourly")?.nextRecheckAt, FEED_DUE);

    const revised = structuredClone(input);
    revised.idempotencyKey = "recheck-hourly-feed-hour";
    revised.sourcePolicy.id = crypto.randomUUID();
    revised.sourcePolicy.refreshIntervalSeconds = 3_600;
    assert.equal((await caller().publishing.submit(revised)).status, "published");
    const second = await runScheduledRecheck(deps(), OPERATOR_TOKEN, null);
    const feed = second.targets.find((target) => target.targetKey === "lot-hourly");
    assert.equal(feed?.intervalSeconds, 3_600);
    assert.equal(feed?.nextRecheckAt, "2026-10-22T01:00:00.000Z");
    assert.equal(feed?.freshness, "stale");
    assert.equal(feed?.suppressed, true);
    const html = await renderCar("hourly feed");
    assert.match(html, /Not a current listing/);
    assert.doesNotMatch(html, /Active as last observed/);
  });

  it("shows a republished listing as ended when that end is confirmed", async () => {
    const input = catalogueImport("Ended Lot");
    const record = input.records[0];
    assert.ok(record);
    record.document.listings = [listing("lot-ended", "Ended asking card", "active")];
    assert.equal((await caller().publishing.submit(input)).status, "published");
    await runScheduledRecheck(deps(), OPERATOR_TOKEN, null);

    const revised = structuredClone(input);
    revised.idempotencyKey = "recheck-ended-lot-confirmed";
    revised.sourcePolicy.id = crypto.randomUUID();
    const revisedRecord = revised.records[0];
    assert.ok(revisedRecord?.document.listings?.[0]);
    revisedRecord.document.listings[0].lifecycle = "ended";
    revisedRecord.document.listings[0].observedAt = "2026-10-22T06:00:00.000Z";
    assert.equal((await caller().publishing.submit(revised)).status, "published");
    const checked = await runScheduledRecheck(deps(), OPERATOR_TOKEN, null);
    const feed = checked.targets.find((target) => target.targetKey === "lot-ended");
    assert.equal(feed?.lifecycle, "ended");
    assert.equal(feed?.observedAt, "2026-10-22T06:00:00.000Z");
    const html = await renderCar("ended lot");
    assert.match(html, /Ended\. Last observed 2026-10-22T06:00:00\.000Z/);
    assert.doesNotMatch(html, /Active as last observed/);
  });

  it("rejects an unauthorised recheck", async () => {
    await assert.rejects(() => runScheduledRecheck(deps(), undefined, null), PublishingRejected);
  });
});

async function until(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, "Timed out waiting for the database synchronization condition");
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function deps(now: () => Date = () => new Date(NOON)) {
  return { db, operatorToken: OPERATOR_TOKEN, now };
}

function caller(now: () => Date = () => new Date(NOON)) {
  return appRouter.createCaller({
    db,
    now,
    operatorToken: OPERATOR_TOKEN,
    presentedOperatorToken: OPERATOR_TOKEN,
    access: { allowFixtures: false },
  });
}

async function auditsFor(subjectId: string) {
  return db
    .select({ kind: publishingAuditEvent.kind, summary: publishingAuditEvent.summary })
    .from(publishingAuditEvent)
    .where(sql`${publishingAuditEvent.canonicalSubjectId} = ${subjectId}`);
}

async function renderAddress(modelSlug: string, variantId: string): Promise<string> {
  const { loadCatalogueCarForContext } = await importCatalogueLoaders();
  const state = await loadCatalogueCarForContext(runtime(), {
    modelSlug,
    generationSlug: "mark",
    market: "mkt-labeled-in",
    year: "year-labeled-2026",
    variant: variantId,
  });
  const { CatalogueDetailView } = await importCatalogueViews();
  return renderToStaticMarkup(createElement(CatalogueDetailView, { state }));
}

async function renderCar(query: string): Promise<string> {
  const search = await caller().catalogue.search({ q: query });
  const hit = search.hits.find((item) => item.scope === "applicability");
  if (!hit || hit.scope !== "applicability") {
    const { loadCatalogueSearchForContext } = await importCatalogueLoaders();
    const state = await loadCatalogueSearchForContext(runtime(), query);
    const { CatalogueSearchView } = await importCatalogueViews();
    return renderToStaticMarkup(createElement(CatalogueSearchView, { state }));
  }
  const { loadCatalogueCarForContext } = await importCatalogueLoaders();
  const state = await loadCatalogueCarForContext(runtime(), {
    modelSlug: hit.modelSlug,
    generationSlug: hit.generationSlug,
    market: hit.salesMarketId,
    year: hit.modelYearId,
    variant: hit.variantId,
  });
  const { CatalogueDetailView } = await importCatalogueViews();
  return renderToStaticMarkup(createElement(CatalogueDetailView, { state }));
}

function runtime() {
  return {
    db,
    now: () => new Date(NOON),
    operatorToken: OPERATOR_TOKEN,
    presentedOperatorToken: null,
    access: { allowFixtures: false },
  };
}

async function requestJson(method: "GET" | "POST", path: string, input: unknown) {
  const url = new URL(path, "http://127.0.0.1");
  if (method === "GET") url.searchParams.set("input", JSON.stringify(input));
  const response = await app.request(url, { method, headers: { "content-type": "application/json" } });
  return { text: await response.text(), cacheControl: response.headers.get("cache-control") };
}

type CatalogueView = (props: { state: unknown }) => unknown;

type CatalogueRuntime = ReturnType<typeof runtime>;

async function importCatalogueLoaders(): Promise<{
  loadCatalogueSearchForContext: (context: CatalogueRuntime, query: string) => Promise<unknown>;
  loadCatalogueCarForContext: (
    context: CatalogueRuntime,
    input: { modelSlug: string; generationSlug: string; market: string; year: string; variant: string },
  ) => Promise<unknown>;
}> {
  return import(["..", "..", "web", "src", "catalogue", "load-state.ts"].join("/"));
}

async function importCatalogueViews(): Promise<{ CatalogueSearchView: CatalogueView; CatalogueDetailView: CatalogueView }> {
  return import(["..", "..", "web", "src", "catalogue", "views.tsx"].join("/"));
}

function listing(externalId: string, title: string, lifecycle: "active" | "ended" | "unknown") {
  return {
    externalId,
    title,
    url: `https://example.test/listings/${externalId}`,
    lifecycle,
    priceType: "asking" as const,
    amountMinor: 1_800_000,
    currency: "INR" as const,
    minorUnitExponent: 2,
    observedAt: REVIEWED,
    retrievedAt: REVIEWED,
    reviewedAt: REVIEWED,
  };
}

function catalogueImport(name: string) {
  const slug = name.toLowerCase().replaceAll(" ", "-");
  return {
    idempotencyKey: `recheck-${slug}`,
    providerKey: "manual-test",
    publish: true,
    sourcePolicy: {
      id: crypto.randomUUID(),
      providerKey: "manual-test",
      factPermission: "permitted" as const,
      imagePermission: "permitted" as const,
      permittedFields: [
        "displayName",
        "alias",
        "modelYearLabel",
        "power",
        "torque",
        "salesMarket",
        "priceReference",
        "brand",
        "model",
        "generation",
        "marketVariant",
        "sourceDirectory",
        "approvedFeed",
      ],
      permittedGeographies: ["IN"],
      attribution: "Reviewed sample attribution",
      retentionSeconds: LONG_RETENTION,
      derivativeRestriction: PRIVATE.derivative,
      aggregationRestriction: PRIVATE.aggregation,
      refreshIntervalSeconds: 86_400,
      permissionExpiresAt: "2030-01-01T00:00:00.000Z",
      takedownObligation: PRIVATE.takedown,
      deletionObligation: PRIVATE.deletion,
      contractText: PRIVATE.contract,
      suspended: false,
      reviewerRef: "policy-reviewer",
      reviewedAt: REVIEWED,
      displayName: "Labeled test policy",
    },
    records: [
      {
        externalId: `ext-${slug}`,
        provenance: "manual" as const,
        privatePayload: { marker: PRIVATE.payload },
        document: {
          displayName: `Unindexed ${name}`,
          aliases: [] as string[],
          canonicalSubjectId: `subject-${slug}`,
          salesMarket: "IN",
          modelYearLabel: "2026",
          facts: [
            {
              property: "power",
              rawValue: "100 PS",
              normalizedValue: "100",
              state: "known" as const,
              unknownReason: null,
              unit: "PS",
              standard: "PS",
              sourceUrl: `https://example.test/sources/${slug}`,
              sourceTitle: "Labeled test dossier",
              providerKey: "manual-test",
              observedAt: REVIEWED,
              retrievedAt: REVIEWED,
            },
            {
              property: "torque",
              rawValue: "",
              normalizedValue: null,
              state: "unknown" as const,
              unknownReason: "The labelled test does not include a measured torque.",
              unit: null,
              standard: null,
              sourceUrl: null,
              sourceTitle: "Labeled test dossier",
              providerKey: "manual-test",
              observedAt: null,
              retrievedAt: REVIEWED,
            },
          ],
          media: [
            {
              sourceUrl: `https://example.test/images/${slug}`,
              credit: "Reviewed sample credit",
              altText: "Neutral sample image",
            },
          ],
          sourceDirectory: [] as Array<{
            title: string;
            url: string;
            observedAt: string | null;
            retrievedAt: string;
            reviewedAt: string;
          }>,
          listings: [] as Array<ReturnType<typeof listing>>,
        },
        catalogue: {
          brand: { id: `brand-${slug}`, name, slug: `brand-${slug}` },
          model: { id: `model-${slug}`, name: `${name} Model`, slug: `model-${slug}` },
          generation: { id: `gen-${slug}`, name: "Labeled Mark", slug: "mark" },
          marketVariant: { id: `var-${slug}`, name: "Base" },
          salesMarket: { id: "mkt-labeled-in", name: "India", countryCode: "IN" },
          modelYear: {
            id: "year-labeled-2026",
            label: "2026",
            convention: "Manufacturer model-year label. Not the calendar build year.",
          },
          aliases: [],
          priceReference: {
            amountMinor: 250_000,
            currency: "INR",
            minorUnitExponent: 2,
            basis: "official price reference",
            taxInclusivity: "unspecified" as const,
            observedOn: "2026-10-22",
            retrievedOn: "2026-10-22",
            reviewedOn: "2026-10-22",
            sourceTitle: "Labeled test price sheet",
            sourceUrl: `https://example.test/prices/${slug}`,
            sourceIdentifier: null,
          },
        },
        identity: {
          outcome: "certain" as const,
          canonicalSubjectId: `subject-${slug}`,
          reviewerRef: "identity-reviewer",
          note: "Operator confirmed this labelled test subject.",
        },
        factualReview: { outcome: "passed" as const, reviewerRef: "fact-reviewer", reviewedAt: REVIEWED },
        rightsReview: { outcome: "passed" as const, reviewerRef: "rights-reviewer", reviewedAt: REVIEWED },
      },
    ],
  };
}
