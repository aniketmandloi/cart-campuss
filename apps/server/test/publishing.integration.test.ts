import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";

import { cleanupPublishingCopies, PublishingRejected, operatorImportSchema, runOperatorCommand } from "@cart-campuss/api/publishing";
import { z } from "zod";
import { appRouter } from "@cart-campuss/api/routers/index";
import { commitNeonHttpBatch, sql, type Database } from "@cart-campuss/db";
import {
  publishingPublishedAssertion,
  publishingProjectionGeneration,
  publishingProjectionPointer,
  publishingSourcePolicy,
  publishingStagedRecord,
} from "@cart-campuss/db/schema/publishing";

import { createApp, type AppDeps } from "../src/app";
import { startPublishingDatabase } from "./ephemeral-postgres";

const BASE_TIME = "2026-10-22T12:00:00.000Z";
const testClock = () => new Date(BASE_TIME);

const OPERATOR_TOKEN = "test-operator-token-32-characters-min";
const MARKERS = {
  contract: "CONTRACT-TEXT-NOT-PUBLIC",
  payload: "PAYLOAD-NOT-PUBLIC",
  takedown: "TAKEDOWN-OBLIGATION-NOT-PUBLIC",
  deletion: "DELETION-OBLIGATION-NOT-PUBLIC",
  derivative: "DERIVATIVE-RESTRICTION-NOT-PUBLIC",
  aggregation: "AGGREGATION-RESTRICTION-NOT-PUBLIC",
  deniedImage: "https://example.test/images/not-for-visitors",
};

let db: Database;
let app: ReturnType<typeof createApp>;
let holdAdvisoryLock: Awaited<ReturnType<typeof startPublishingDatabase>>["holdAdvisoryLock"];
let stopDatabase: (() => Promise<void>) | undefined;

before(async () => {
  const started = await startPublishingDatabase();
  db = started.db;
  stopDatabase = started.stop;
  holdAdvisoryLock = started.holdAdvisoryLock;
  app = createApp({
    db,
    now: testClock,
    operatorToken: OPERATOR_TOKEN,
    corsOrigin: "http://localhost:3001",
    log: false,
  } satisfies AppDeps);
});

after(async () => {
  await stopDatabase?.();
});

describe("reviewed catalogue publishing", { concurrency: 1, timeout: 120_000 }, () => {
  it("shows a reviewed record on search and detail without private material", async () => {
    const input = reviewedImport("Reviewed Sample Coupe");
    const published = await caller(OPERATOR_TOKEN).publishing.submit(input);
    assert.equal(published.status, "published");
    assert.deepEqual(published.publishedSubjectIds, ["subject-reviewed-sample-coupe"]);

    const hits = await caller(null).publishing.search({ q: "Reviewed Sample Coupe" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.canonicalSubjectId, "subject-reviewed-sample-coupe");
    assert.equal(hits[0]?.salesMarket, "IN");
    assert.equal(hits[0]?.modelYearLabel, "2026");

    const aliasHits = await caller(null).publishing.search({ q: "Sample Alias Coupe" });
    assert.equal(aliasHits.length, 1);

    const detail = await caller(null).publishing.detail({
      subjectId: "subject-reviewed-sample-coupe",
    });
    assert.ok(detail);
    assert.equal(detail.attribution, "Reviewed sample attribution");
    assert.equal(detail.factualReviewerRef, "fact-reviewer");
    assert.equal(detail.rightsReviewerRef, "rights-reviewer");
    assert.equal(detail.facts.length, 1);
    assert.equal(detail.facts[0]?.property, "power");
    assert.equal(detail.facts[0]?.rawValue, "100 PS");
    assert.equal(detail.facts[0]?.normalizedValue, "100");
    assert.equal(detail.facts[0]?.unit, "PS");
    assert.equal(detail.facts[0]?.standard, "PS");
    assert.equal(detail.facts[0]?.sourcePolicyId, detail.sourcePolicyId);
    assert.equal(detail.facts[0]?.factualReviewerRef, "fact-reviewer");
    assert.equal(detail.media.length, 1);
    assert.equal(detail.media[0]?.rightsReviewerRef, "rights-reviewer");
    assert.equal(detail.media[0]?.sourcePolicyId, detail.sourcePolicyId);
    assert.equal(visitorText(detail).includes(MARKERS.contract), false);
    assert.equal(visitorText(detail).includes(MARKERS.payload), false);
    assert.equal(visitorText(detail).includes(MARKERS.takedown), false);
    assert.equal(visitorText(detail).includes(OPERATOR_TOKEN), false);

    const httpDetail = await requestJson(
      "GET",
      "/api/trpc/publishing.detail",
      { subjectId: "subject-reviewed-sample-coupe" },
    );
    assert.equal(httpDetail.status, 200);
    assert.equal(httpDetail.text.includes("100 PS"), true);
    assert.equal(httpDetail.text.includes(MARKERS.contract), false);
    assert.equal(httpDetail.text.includes(MARKERS.payload), false);
    assert.equal(httpDetail.text.includes(MARKERS.takedown), false);
    assert.equal(httpDetail.text.includes(MARKERS.deletion), false);
    assert.equal(httpDetail.text.includes(MARKERS.derivative), false);
    assert.equal(httpDetail.text.includes(MARKERS.aggregation), false);
    assert.equal(httpDetail.text.includes(OPERATOR_TOKEN), false);

    const policies = await db.select().from(publishingSourcePolicy);
    const policy = policies.find((row) => row.id === detail.sourcePolicyId);
    assert.ok(policy);
    assert.equal(policy.factPermission, "permitted");
    assert.equal(policy.imagePermission, "permitted");
    assert.deepEqual(policy.permittedGeographies, ["IN"]);
    assert.equal(policy.retentionSeconds, 86_400);
    assert.equal(policy.refreshIntervalSeconds, 7_776_000);
    assert.equal(policy.derivativeRestriction, MARKERS.derivative);
    assert.equal(policy.aggregationRestriction, MARKERS.aggregation);
    assert.equal(policy.takedownObligation, MARKERS.takedown);
    assert.equal(policy.deletionObligation, MARKERS.deletion);
    assert.equal(policy.contractText, MARKERS.contract);

    const stagedRows = await db
      .select({
        externalId: publishingStagedRecord.externalId,
        privatePayload: publishingStagedRecord.privatePayload,
      })
      .from(publishingStagedRecord);
    const staged = stagedRows.find((row) => row.externalId === "ext-reviewed-sample-coupe");
    assert.deepEqual(staged?.privatePayload, { marker: MARKERS.payload });
  });

  it("keeps an earlier publication when a later one is added", async () => {
    await caller(OPERATOR_TOKEN).publishing.submit(reviewedImport("First Kept Coupe"));
    await caller(OPERATOR_TOKEN).publishing.submit(reviewedImport("Second Kept Coupe"));
    const first = await caller(null).publishing.detail({ subjectId: "subject-first-kept-coupe" });
    const second = await caller(null).publishing.search({ q: "Second Kept Coupe" });
    assert.ok(first);
    assert.equal(first.facts[0]?.rawValue, "100 PS");
    assert.equal(first.facts[0]?.factualReviewerRef, "fact-reviewer");
    assert.equal(first.sourcePolicyId.length > 0, true);
    assert.equal(second.length, 1);
    assert.equal((await caller(null).publishing.search({ q: "First Kept Coupe" })).length, 1);
  });

  it("rejects an operator who does not present the server token", async () => {
    const input = reviewedImport("Unauthorized Coupe");
    await assert.rejects(() => caller(null).publishing.submit(input), /unauthorized/);
    await assert.rejects(() => caller("wrong-operator-token-000000000000").publishing.submit(input), /unauthorized/);
    const http = await requestJson("POST", "/api/trpc/publishing.submit", input);
    assert.equal(http.status, 401);
    assert.equal(http.text.includes(MARKERS.contract), false);
    assert.equal(http.text.includes(OPERATOR_TOKEN), false);
    const planted = await requestJson("POST", "/api/trpc/publishing.submit", {
      ...input,
      idempotencyKey: "import-body-token-coupe",
      operatorToken: OPERATOR_TOKEN,
      records: input.records.map((record) => ({
        ...record,
        externalId: "ext-body-token-coupe",
        document: { ...record.document, displayName: "Body Token Coupe", canonicalSubjectId: "subject-body-token-coupe" },
      })),
    });
    assert.equal(planted.status, 401);
    assert.equal((await caller(null).publishing.search({ q: "Unauthorized Coupe" })).length, 0);
    assert.equal((await caller(null).publishing.search({ q: "Body Token Coupe" })).length, 0);
    await assert.rejects(
      () => runOperatorCommand({ db, operatorToken: null }, JSON.stringify(input)),
      (error: unknown) => error instanceof PublishingRejected && error.code === "unauthorized",
    );
  });

  it("rejects denied rights, expiry, and suspension without publishing", async () => {
    const denied = reviewedImport("Rights Denied Coupe");
    denied.sourcePolicy.factPermission = "denied";
    const deniedResult = await caller(OPERATOR_TOKEN).publishing.submit(denied);
    assert.equal(deniedResult.status, "held");
    assert.equal(deniedResult.rejection?.code, "rights");

    const omitted = reviewedImport("Default Deny Coupe");
    delete omitted.sourcePolicy.factPermission;
    delete omitted.sourcePolicy.imagePermission;
    const omittedResult = await caller(OPERATOR_TOKEN).publishing.submit(omitted);
    assert.equal(omittedResult.status, "held");
    assert.equal(omittedResult.rejection?.code, "rights");

    const geography = reviewedImport("Outside Geography Coupe");
    geography.records[0]!.document.salesMarket = "JP";
    const geographyResult = await caller(OPERATOR_TOKEN).publishing.submit(geography);
    assert.equal(geographyResult.status, "held");
    assert.equal(geographyResult.rejection?.code, "rights");

    const expired = reviewedImport("Expired Permission Coupe");
    expired.sourcePolicy.permissionExpiresAt = "2020-01-01T00:00:00.000Z";
    assert.equal((await caller(OPERATOR_TOKEN).publishing.submit(expired)).rejection?.code, "expired");

    const suspended = reviewedImport("Suspended Source Coupe");
    suspended.sourcePolicy.suspended = true;
    assert.equal((await caller(OPERATOR_TOKEN).publishing.submit(suspended)).rejection?.code, "suspended");

    const imageDenied = reviewedImport("Image Denied Coupe");
    imageDenied.sourcePolicy.imagePermission = "denied";
    imageDenied.records[0]!.document.media = [
      { sourceUrl: MARKERS.deniedImage, credit: "Hidden credit", altText: "Neutral sample image" },
    ];
    const imageResult = await caller(OPERATOR_TOKEN).publishing.submit(imageDenied);
    assert.equal(imageResult.status, "published");
    const imageDetail = await caller(null).publishing.detail({ subjectId: "subject-image-denied-coupe" });
    assert.ok(imageDetail);
    assert.equal(imageDetail.facts.length, 1);
    assert.deepEqual(imageDetail.media, []);
    assert.equal(visitorText(imageDetail).includes(MARKERS.deniedImage), false);

    for (const name of [
      "Rights Denied Coupe",
      "Default Deny Coupe",
      "Outside Geography Coupe",
      "Expired Permission Coupe",
      "Suspended Source Coupe",
    ]) {
      assert.equal((await caller(null).publishing.search({ q: name })).length, 0);
    }
  });

  it("stages without publishing and rejects a repeated external id", async () => {
    await caller(OPERATOR_TOKEN).publishing.submit(reviewedImport("Stage Baseline Coupe"));
    const staged = reviewedImport("Staged Only Coupe");
    staged.publish = false;
    staged.records[0]!.provenance = "seed";
    const stagedResult = await caller(OPERATOR_TOKEN).publishing.submit(staged);
    assert.equal(stagedResult.status, "staged");
    assert.deepEqual(stagedResult.publishedSubjectIds, []);
    assert.equal((await caller(null).publishing.search({ q: "Staged Only Coupe" })).length, 0);
    assert.equal((await caller(null).publishing.search({ q: "Stage Baseline Coupe" })).length, 1);

    const duplicate = reviewedImport("Duplicate External Coupe");
    duplicate.records.push(structuredClone(duplicate.records[0]!));
    duplicate.records[1]!.document.displayName = "Duplicate External Other";
    duplicate.records[1]!.document.canonicalSubjectId = "subject-duplicate-external-other";
    duplicate.records[1]!.identity.canonicalSubjectId = "subject-duplicate-external-other";
    await assert.rejects(() => caller(OPERATOR_TOKEN).publishing.submit(duplicate), /external id/);
    assert.equal((await caller(null).publishing.search({ q: "Duplicate External Coupe" })).length, 0);
  });

  it("leaves an uncertain or factually unreviewed match unpublished", async () => {
    const input = reviewedImport("Uncertain Match Coupe");
    input.records[0]!.identity.outcome = "uncertain";
    const result = await caller(OPERATOR_TOKEN).publishing.submit(input);
    assert.equal(result.status, "held");
    assert.equal(result.rejection?.code, "identity");
    assert.equal((await caller(null).publishing.search({ q: "Uncertain Match Coupe" })).length, 0);
    assert.equal(
      await caller(null).publishing.detail({ subjectId: "subject-uncertain-match-coupe" }),
      null,
    );

    await caller(OPERATOR_TOKEN).publishing.submit(reviewedImport("Factual Baseline Coupe"));
    const factual = reviewedImport("Factual Failed Coupe");
    factual.records[0]!.factualReview.outcome = "failed";
    const factualResult = await caller(OPERATOR_TOKEN).publishing.submit(factual);
    assert.equal(factualResult.status, "held");
    assert.equal(factualResult.rejection?.code, "factual");
    assert.equal((await caller(null).publishing.search({ q: "Factual Failed Coupe" })).length, 0);
    assert.equal((await caller(null).publishing.search({ q: "Factual Baseline Coupe" })).length, 1);
  });

  it("replays an import once and keeps one public record", async () => {
    const input = reviewedImport("Replay Coupe");
    const first = await caller(OPERATOR_TOKEN).publishing.submit(input);
    const second = await caller(OPERATOR_TOKEN).publishing.submit(structuredClone(input));
    assert.equal(first.status, "published");
    assert.equal(second.status, "replayed");
    assert.deepEqual(second.publishedSubjectIds, first.publishedSubjectIds);
    assert.equal((await caller(null).publishing.search({ q: "Replay Coupe" })).length, 1);

    const changed = structuredClone(input);
    changed.records[0]!.document.facts[0]!.rawValue = "999 PS";
    await assert.rejects(() => caller(OPERATOR_TOKEN).publishing.submit(changed), /idempotency-conflict/);
    const unchanged = await caller(null).publishing.detail({ subjectId: "subject-replay-coupe" });
    assert.equal(unchanged?.facts[0]?.rawValue, "100 PS");

    const update = reviewedImport("Replay Coupe");
    update.idempotencyKey = "import-replay-coupe-revision";
    update.records[0]!.document.facts[0]!.rawValue = "110 PS";
    const updated = await caller(OPERATOR_TOKEN).publishing.submit(update);
    assert.equal(updated.status, "published");
    const detail = await caller(null).publishing.detail({ subjectId: "subject-replay-coupe" });
    assert.equal(detail?.facts[0]?.rawValue, "110 PS");
    assert.equal((await caller(null).publishing.search({ q: "Replay Coupe" })).length, 1);
  });

  it("does not replace the previous projection when part of an import cannot be published", async () => {
    await caller(OPERATOR_TOKEN).publishing.submit(reviewedImport("Preserved Coupe"));
    const mixed = reviewedImport("Partial Valid Coupe");
    const uncertain = reviewedImport("Partial Uncertain Coupe");
    uncertain.records[0]!.identity.outcome = "uncertain";
    mixed.idempotencyKey = "import-partial-batch";
    mixed.records.push(uncertain.records[0]!);
    const result = await caller(OPERATOR_TOKEN).publishing.submit(mixed);
    assert.equal(result.status, "held");
    assert.equal(result.rejection?.code, "partial");
    assert.equal((await caller(null).publishing.search({ q: "Preserved Coupe" })).length, 1);
    assert.equal((await caller(null).publishing.search({ q: "Partial Valid Coupe" })).length, 0);
    assert.equal((await caller(null).publishing.search({ q: "Partial Uncertain Coupe" })).length, 0);
  });

  it("keeps names-only records and fixtures out of the public catalogue", async () => {
    await caller(OPERATOR_TOKEN).publishing.submit(reviewedImport("Fixture Baseline Coupe"));
    const names = reviewedImport("Names Only Coupe");
    names.records[0]!.document.facts = [];
    assert.equal((await caller(OPERATOR_TOKEN).publishing.submit(names)).rejection?.code, "names-only");

    const fixture = reviewedImport("Fixture Labelled Coupe");
    fixture.records[0]!.provenance = "fixture";
    const valid = reviewedImport("Beside Fixture Coupe");
    fixture.idempotencyKey = "import-fixture-batch";
    fixture.records.push(valid.records[0]!);
    const result = await caller(OPERATOR_TOKEN).publishing.submit(fixture);
    assert.equal(result.status, "held");
    assert.equal((await caller(null).publishing.search({ q: "Names Only Coupe" })).length, 0);
    assert.equal((await caller(null).publishing.search({ q: "Fixture Labelled Coupe" })).length, 0);
    assert.equal((await caller(null).publishing.search({ q: "Beside Fixture Coupe" })).length, 0);
    assert.equal((await caller(null).publishing.search({ q: "Fixture Baseline Coupe" })).length, 1);
  });

  it("rolls back a failed Neon batch and leaves the previous projection in place", async () => {
    await caller(OPERATOR_TOKEN).publishing.submit(reviewedImport("Rollback Baseline Coupe"));
    const pointers = await db.select().from(publishingProjectionPointer);
    const pointer = pointers.find((row) => row.id === 1);
    assert.ok(pointer);
    const generations = await db.select().from(publishingProjectionGeneration);
    const generation = generations.find((row) => row.id === pointer.generationId);
    assert.ok(generation);
    const currentAssertions = await db.select().from(publishingPublishedAssertion);
    const existing = currentAssertions.find(
      (row) => row.generationId === pointer.generationId && row.displayName === "Rollback Baseline Coupe",
    );
    assert.ok(existing);

    const generationId = "generation-rollback-should-not-commit";
    const publishedAt = "2026-10-23T06:30:00.000Z";
    const conflictingBatch = [
      db.insert(publishingProjectionGeneration).values({
        id: generationId,
        generation: 1_900_000_000,
        publishedAt,
        batchId: generation.batchId,
      }),
      db.insert(publishingPublishedAssertion).values({
        id: "assertion-rollback-should-not-commit",
        generationId,
        providerKey: "manual-test",
        externalId: "ext-rollback-should-not-commit",
        canonicalSubjectId: "subject-rollback-should-not-commit",
        displayName: "Atomic Rollback Coupe",
        aliases: [],
        salesMarket: "IN",
        modelYearLabel: "2026",
        facts: [],
        media: [],
        attribution: "Rollback attribution",
        sourcePolicyId: existing.sourcePolicyId,
        factualReviewerRef: "fact-reviewer",
        rightsReviewerRef: "rights-reviewer",
        capturedAt: BASE_TIME,
        observedAt: null,
        reviewedAt: publishedAt,
      }),
      db
        .insert(publishingProjectionPointer)
        .values({ id: 1, generationId, updatedAt: publishedAt })
        .onConflictDoUpdate({
          target: publishingProjectionPointer.id,
          set: { generationId, updatedAt: publishedAt },
        }),
      db.insert(publishingProjectionGeneration).values({
        id: generationId,
        generation: 1_900_000_001,
        publishedAt,
        batchId: generation.batchId,
      }),
    ];
    await assert.rejects(
      () => db.transaction(async () => undefined),
      /No transactions support in neon-http driver/,
    );
    await assert.rejects(() => commitNeonHttpBatch(db, conflictingBatch));

    assert.equal((await caller(null).publishing.search({ q: "Atomic Rollback Coupe" })).length, 0);
    assert.equal((await caller(null).publishing.search({ q: "Rollback Baseline Coupe" })).length, 1);
    const pointerAfter = (await db.select().from(publishingProjectionPointer)).find((row) => row.id === 1);
    assert.equal(pointerAfter?.generationId, pointer.generationId);
    const leaked = (await db.select().from(publishingPublishedAssertion)).filter(
      (row) => row.displayName === "Atomic Rollback Coupe",
    );
    assert.equal(leaked.length, 0);
  });

  it("publishes from the operator command when the server token is configured", async () => {
    const input = reviewedImport("Command Published Coupe");
    input.records[0]!.provenance = "import";
    const result = await runOperatorCommand({ db, operatorToken: OPERATOR_TOKEN, now: testClock }, JSON.stringify(input));
    assert.equal(result.status, "published");
    assert.equal(result.publishedSubjectIds.includes(OPERATOR_TOKEN), false);
    const detail = await caller(null).publishing.detail({ subjectId: "subject-command-published-coupe" });
    assert.equal(detail?.displayName, "Command Published Coupe");
    assert.equal(visitorText(result).includes(MARKERS.contract), false);
    assert.equal(visitorText(result).includes(MARKERS.payload), false);
  });

  it("keeps both providers public when they share an external id", async () => {
    const providerA = reviewedImport("Provider A Coupe");
    providerA.providerKey = "provider-a";
    providerA.sourcePolicy.providerKey = "provider-a";
    const recordA = providerA.records[0];
    assert.ok(recordA);
    recordA.externalId = "123";
    recordA.document.canonicalSubjectId = "subject-provider-a-123";
    recordA.identity.canonicalSubjectId = "subject-provider-a-123";
    const factA = recordA.document.facts[0];
    assert.ok(factA);
    factA.providerKey = "provider-a";

    const providerB = reviewedImport("Provider B Coupe");
    providerB.providerKey = "provider-b";
    providerB.sourcePolicy.providerKey = "provider-b";
    const recordB = providerB.records[0];
    assert.ok(recordB);
    recordB.externalId = "123";
    recordB.document.canonicalSubjectId = "subject-provider-b-123";
    recordB.identity.canonicalSubjectId = "subject-provider-b-123";
    const factB = recordB.document.facts[0];
    assert.ok(factB);
    factB.providerKey = "provider-b";

    assert.equal((await caller(OPERATOR_TOKEN).publishing.submit(providerA)).status, "published");
    assert.equal((await caller(OPERATOR_TOKEN).publishing.submit(providerB)).status, "published");

    const first = await caller(null).publishing.detail({ subjectId: "subject-provider-a-123" });
    const second = await caller(null).publishing.detail({ subjectId: "subject-provider-b-123" });
    assert.equal(first?.displayName, "Provider A Coupe");
    assert.equal(second?.displayName, "Provider B Coupe");
    assert.equal(first?.facts[0]?.providerKey, "provider-a");
    assert.equal(second?.facts[0]?.providerKey, "provider-b");
    assert.equal((await caller(null).publishing.search({ q: "Provider A Coupe" })).length, 1);
    assert.equal((await caller(null).publishing.search({ q: "Provider B Coupe" })).length, 1);
  });

  it("does not publish a sales market the source policy does not allow", async () => {
    const input = reviewedImport("Market Field Withheld Coupe");
    input.sourcePolicy.permittedFields = ["displayName", "power"];
    const result = await caller(OPERATOR_TOKEN).publishing.submit(input);
    assert.equal(result.status, "held");
    assert.equal(result.rejection?.code, "rights");
    assert.equal((await caller(null).publishing.search({ q: "Market Field Withheld Coupe" })).length, 0);
    assert.equal(
      await caller(null).publishing.detail({ subjectId: "subject-market-field-withheld-coupe" }),
      null,
    );
  });

  it("withholds VINs, registration numbers, and private contacts from the public projection", async () => {
    const leaks: Array<{ name: string; marker: string; apply: (input: ReviewedImport) => void }> = [
      {
        name: "Allowed Vin Field Coupe",
        marker: "1HGCM82633A004352",
        apply: (input) => {
          input.sourcePolicy.permittedFields = [...input.sourcePolicy.permittedFields, "vin"];
          input.records[0]?.document.facts.push(fact(input, "vin", "1HGCM82633A004352"));
        },
      },
      {
        name: "Vin Alias Coupe",
        marker: "WVWZZZ3CZWE123456",
        apply: (input) => {
          input.records[0]?.document.facts.push(
            fact(input, "vehicle_identification_number", "WVWZZZ3CZWE123456"),
          );
        },
      },
      {
        name: "Plate Alias Coupe",
        marker: "MH01AB1234",
        apply: (input) => {
          input.sourcePolicy.permittedFields = [...input.sourcePolicy.permittedFields, "licence_plate"];
          input.records[0]?.document.facts.push(fact(input, "licence_plate", "MH-01-AB-1234"));
        },
      },
      {
        name: "Seller Email Coupe",
        marker: "private.seller@example.test",
        apply: (input) => {
          input.records[0]?.document.facts.push(fact(input, "sellerEmail", "private.seller@example.test"));
        },
      },
      {
        name: "Title Registration Coupe",
        marker: "DL8CAF5031",
        apply: (input) => {
          const record = input.records[0];
          assert.ok(record);
          record.document.displayName = "Title Registration Coupe DL8CAF5031";
        },
      },
      {
        name: "Source Url Vin Coupe",
        marker: "JH4KA4650MC000000",
        apply: (input) => {
          const sourced = input.records[0]?.document.facts[0];
          assert.ok(sourced);
          sourced.sourceUrl = "https://example.test/vehicles/JH4KA4650MC000000";
        },
      },
      {
        name: "Normalized Vin Coupe",
        marker: "1HGCM82633A004352",
        apply: (input) => { input.records[0]!.document.facts[0]!.normalizedValue = "1HGCM82633A004352"; },
      },
      {
        name: "Raw Vin Coupe",
        marker: "1HGCM82633A004352",
        apply: (input) => { input.records[0]!.document.facts[0]!.rawValue = "1HGCM82633A004352"; },
      },
      {
        name: "Metadata Seller Email Coupe",
        marker: "private.seller@example.test",
        apply: (input) => {
          const sourced = input.records[0]!.document.facts[0]!;
          sourced.state = "unknown";
          sourced.unknownReason = "Contact private.seller@example.test";
        },
      },
      {
        name: "Encoded Media Vin Coupe",
        marker: "1HGCM82633A004352",
        apply: (input) => {
          input.records[0]!.document.media[0]!.sourceUrl = "https://example.test/vehicles/%31%48%47%43%4D%38%32%36%33%33%41%30%30%34%33%35%32";
        },
      },
      {
        name: "Canonical Vin Coupe",
        marker: "1HGCM82633A004352",
        apply: (input) => {
          input.records[0]!.document.canonicalSubjectId = "1HGCM82633A004352";
          input.records[0]!.identity.canonicalSubjectId = "1HGCM82633A004352";
        },
      },
      {
        name: "Alt Phone Coupe",
        marker: "+919876543210",
        apply: (input) => {
          const image = input.records[0]?.document.media[0];
          assert.ok(image);
          image.altText = "Ask the seller on +91 98765 43210";
        },
      },
    ];

    for (const leak of leaks) {
      const input = reviewedImport(leak.name);
      leak.apply(input);
      const result = await caller(OPERATOR_TOKEN).publishing.submit(input);
      assert.equal(result.status, "held", leak.name);
      assert.equal(result.rejection?.code, "rights", leak.name);
      assert.equal((await caller(null).publishing.search({ q: leak.name })).length, 0, leak.name);
      assert.equal((await caller(null).publishing.search({ q: leak.marker })).length, 0, leak.name);
      const detail = await caller(null).publishing.detail({
        subjectId: `subject-${leak.name.toLowerCase().replaceAll(" ", "-")}`,
      });
      assert.equal(detail, null, leak.name);
    }

    const lot = reviewedImport("Published Lot Coupe");
    lot.sourcePolicy.permittedFields = [...lot.sourcePolicy.permittedFields, "lotId"];
    lot.records[0]?.document.facts.push(fact(lot, "lotId", "LOT-2026-0142"));
    const published = await caller(OPERATOR_TOKEN).publishing.submit(lot);
    assert.equal(published.status, "published");
    const detail = await caller(null).publishing.detail({ subjectId: "subject-published-lot-coupe" });
    assert.equal(
      detail?.facts.some((item) => item.property === "lotId" && item.rawValue === "LOT-2026-0142"),
      true,
    );
    assert.equal(visitorText(detail).includes("1HGCM82633A004352"), false);
    assert.equal(visitorText(detail).includes("private.seller@example.test"), false);
  });

  it("keeps reviewed policy revisions immutable across staged, held, and published imports", async () => {
    const input = reviewedImport("Immutable Policy Coupe");
    input.sourcePolicy.id = crypto.randomUUID();
    assert.equal((await caller(OPERATOR_TOKEN).publishing.submit(input)).status, "published");
    const before = await caller(null).publishing.detail({ subjectId: "subject-immutable-policy-coupe" });
    assert.ok(before);

    for (const change of ["provider", "permissions", "reviewer"] as const) {
      for (const mode of ["staged", "held", "published"] as const) {
        const changed = structuredClone(input);
        changed.idempotencyKey += `-${change}-${mode}`;
        changed.publish = mode !== "staged";
        if (mode === "held") changed.records[0]!.identity.outcome = "uncertain";
        if (change === "provider") {
          changed.providerKey = "other-provider";
          changed.sourcePolicy.providerKey = "other-provider";
          changed.records[0]!.document.facts[0]!.providerKey = "other-provider";
        }
        if (change === "permissions") changed.sourcePolicy.permittedFields.push("torque");
        if (change === "reviewer") changed.sourcePolicy.reviewerRef = "other-policy-reviewer";
        await assert.rejects(() => caller(OPERATOR_TOKEN).publishing.submit(changed), /policy-immutable/);
        assert.deepEqual(
          await caller(null).publishing.detail({ subjectId: "subject-immutable-policy-coupe" }),
          before,
        );
      }
    }
    const reuse = structuredClone(input);
    reuse.idempotencyKey += "-exact-reuse";
    assert.equal((await caller(OPERATOR_TOKEN).publishing.submit(reuse)).status, "published");
    assert.equal(
      (await caller(null).publishing.detail({ subjectId: "subject-immutable-policy-coupe" }))?.sourcePolicyId,
      input.sourcePolicy.id,
    );
  });

  it("withholds domestic contacts and common UK plates across public prose, metadata, and encoded URLs", async () => {
    const cases: Array<(input: ReviewedImport) => void> = [
      (input) => { input.records[0]!.document.media[0]!.altText = "Ask the private seller on 98765 43210"; },
      (input) => { input.records[0]!.document.media[0]!.altText = "Call 98765 43210"; },
      (input) => { input.sourcePolicy.attribution = "Seller phone: 09876543210"; },
      (input) => { input.records[0]!.document.facts[0]!.standard = "Contact 9876543210"; },
      (input) => { input.records[0]!.document.facts[0]!.sourceUrl = "https://example.test/?phone=%39%38%37%36%35%34%33%32%31%30"; },
      (input) => { input.records[0]!.document.media[0]!.sourceUrl = "https://example.test/contact/98765%2043210"; },
      (input) => { input.records[0]!.document.media[0]!.altText = "Vehicle AB12 CDE at the showroom"; },
      (input) => { input.records[0]!.document.facts[0]!.sourceUrl = "https://example.test/vehicle/AB12%20CDE"; },
      (input) => { input.records[0]!.document.media[0]!.sourceUrl = "https://example.test/vehicle/%41%42%31%32%43%44%45"; },
    ];
    for (const [index, change] of cases.entries()) {
      const input = reviewedImport(`Domestic Privacy Case ${index} Coupe`);
      change(input);
      const result = await caller(OPERATOR_TOKEN).publishing.submit(input);
      assert.equal(result.status, "held", `privacy case ${index}`);
      assert.equal(result.rejection?.code, "rights");
      assert.equal(await caller(null).publishing.detail({ subjectId: input.records[0]!.document.canonicalSubjectId }), null);
      assert.equal((await caller(null).publishing.search({ q: `Domestic Privacy Case ${index}` })).length, 0);
    }
    const valid = reviewedImport("Numeric Specifications Coupe");
    valid.sourcePolicy.permittedFields.push("price", "productionYear");
    valid.records[0]!.document.facts.push(fact(valid, "price", "9876543210"), fact(valid, "productionYear", "2026"));
    valid.records[0]!.document.facts[1]!.unit = "INR";
    valid.records[0]!.document.media[0]!.altText = "100 PS, INR 98,765,432.10, model years 2025 2026, WLTP Class 3";
    assert.equal((await caller(OPERATOR_TOKEN).publishing.submit(valid)).status, "published");
    assert.equal((await caller(null).publishing.detail({ subjectId: valid.records[0]!.document.canonicalSubjectId }))?.facts.length, 3);
  });

  it("rejects unsafe fact and media source URLs before staging and filters unsafe legacy URLs on reads", async () => {
    for (const [index, url] of ["javascript:alert(1)", "data:text/html,unsafe", "file:///private/source"].entries()) {
      for (const target of ["fact", "media"] as const) {
        const input = reviewedImport(`Unsafe Url ${target} ${index} Coupe`);
        const record = input.records[0]!;
        if (target === "fact") record.document.facts[0]!.sourceUrl = url;
        else record.document.media[0]!.sourceUrl = url;
        await assert.rejects(() => caller(OPERATOR_TOKEN).publishing.submit(input), /sourceUrl/);
        assert.equal((await db.select().from(publishingStagedRecord)).some((row) => row.externalId === record.externalId), false);
        assert.equal(await caller(null).publishing.detail({ subjectId: record.document.canonicalSubjectId }), null);
      }
    }
    for (const scheme of ["https", "http"]) {
      const input = reviewedImport(`Safe ${scheme} Url Coupe`);
      input.records[0]!.document.facts[0]!.sourceUrl = `${scheme}://example.test/source`;
      input.records[0]!.document.media[0]!.sourceUrl = `${scheme}://example.test/image`;
      assert.equal((await caller(OPERATOR_TOKEN).publishing.submit(input)).status, "published");
      const subjectId = input.records[0]!.document.canonicalSubjectId;
      const detail = await caller(null).publishing.detail({ subjectId });
      assert.equal(detail?.facts[0]?.sourceUrl, `${scheme}://example.test/source`);
      assert.equal(detail?.media[0]?.sourceUrl, `${scheme}://example.test/image`);
      assert.ok(detail);
      for (const url of ["javascript:alert(1)", "data:text/html,unsafe", "file:///private/source"]) {
        await db.update(publishingPublishedAssertion).set({
          facts: detail.facts.map((item) => ({ ...item, sourceUrl: url })),
          media: detail.media.map((item) => ({ ...item, sourceUrl: url })),
        }).where(sql`${publishingPublishedAssertion.canonicalSubjectId} = ${subjectId}`);
        const legacy = await caller(null).publishing.detail({ subjectId });
        assert.deepEqual(legacy?.facts, []);
        assert.deepEqual(legacy?.media, []);
      }
    }
  });

  it("allows concurrent exact policy reuse and rejects a concurrent policy rewrite", async () => {
    const first = reviewedImport("Policy Race First Coupe");
    first.publish = false;
    first.sourcePolicy.id = crypto.randomUUID();
    const second = reviewedImport("Policy Race Second Coupe");
    second.publish = false;
    second.sourcePolicy = structuredClone(first.sourcePolicy);
    second.sourcePolicy.reviewerRef = "different-reviewer";
    const results = await Promise.allSettled([
      caller(OPERATOR_TOKEN).publishing.submit(first),
      caller(OPERATOR_TOKEN).publishing.submit(second),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const failure = results.find((result) => result.status === "rejected");
    assert.ok(failure && failure.status === "rejected");
    assert.match(String(failure.reason), /policy-immutable/);
    const policies = await db.select().from(publishingSourcePolicy);
    const stored = policies.find((policy) => policy.id === first.sourcePolicy.id);
    assert.ok(stored);
    const winner = stored.reviewerRef === first.sourcePolicy.reviewerRef ? first : second;
    const staged = await db.select().from(publishingStagedRecord);
    assert.equal(staged.filter((record) => record.sourcePolicyId === stored.id).length, 1);
    assert.equal(staged.find((record) => record.sourcePolicyId === stored.id)?.externalId, winner.records[0]!.externalId);

    const exact = structuredClone(winner);
    exact.idempotencyKey += "-exact";
    const another = structuredClone(exact);
    another.idempotencyKey += "-another";
    const reused = await Promise.all([
      caller(OPERATOR_TOKEN).publishing.submit(exact),
      caller(OPERATOR_TOKEN).publishing.submit(another),
    ]);
    assert.deepEqual(reused.map((result) => result.status), ["staged", "staged"]);
  });

  it("withholds expired permissions on HTTP search and detail after later publications", async () => {
    const input = reviewedImport("Read Expiry Coupe");
    input.sourcePolicy.id = crypto.randomUUID();
    input.sourcePolicy.permissionExpiresAt = "2026-10-22T13:00:00.000Z";
    assert.equal((await caller(OPERATOR_TOKEN).publishing.submit(input)).status, "published");
    const clock = () => new Date("2026-10-22T12:30:00.000Z");
    assert.equal((await caller(OPERATOR_TOKEN, clock).publishing.submit(reviewedImport("After Expiry Source Coupe"))).status, "published");
    assert.ok(await caller(null, clock).publishing.detail({ subjectId: "subject-read-expiry-coupe" }));

    const expiredApp = createApp({ db, operatorToken: OPERATOR_TOKEN, corsOrigin: "http://localhost:3001", log: false,
      now: () => new Date("2026-10-22T13:00:00.000Z") });
    const search = await requestJson("GET", "/api/trpc/publishing.search", { q: "Read Expiry" }, expiredApp);
    assert.equal(search.status, 200);
    assert.equal(search.text.includes("Read Expiry Coupe"), false);
    assert.equal((await caller(null, expiredAppClock).publishing.search({ q: "Read Expiry Alias Coupe" })).length, 0);
    const detail = await requestJson("GET", "/api/trpc/publishing.detail", { subjectId: "subject-read-expiry-coupe" }, expiredApp);
    assert.equal(detail.status, 200);
    assert.equal(detail.text.includes('"data":null'), true);
    assert.equal(detail.text.includes("100 PS"), false);

    function expiredAppClock() { return new Date("2026-10-22T13:00:00.000Z"); }
  });

  it("keeps original source capture deadlines when assertions are copied or reimported", async () => {
    const input = reviewedImport("Read Retention Coupe");
    input.sourcePolicy.id = crypto.randomUUID();
    input.sourcePolicy.permissionExpiresAt = null;
    input.sourcePolicy.retentionSeconds = 200;
    input.records[0]!.document.facts[0]!.retrievedAt = "2026-10-22T11:58:20.000Z";
    assert.equal((await caller(OPERATOR_TOKEN).publishing.submit(input)).status, "published");
    const later = () => new Date("2026-10-22T12:00:50.000Z");
    assert.equal((await caller(OPERATOR_TOKEN, later).publishing.submit(reviewedImport("Retention Copy Trigger Coupe"))).status, "published");
    const before = await caller(null, later).publishing.detail({ subjectId: "subject-read-retention-coupe" });
    assert.ok(before);
    assert.equal(before.publishedAt, later().toISOString());
    const copies = (await db.select().from(publishingPublishedAssertion)).filter((row) => row.sourcePolicyId === input.sourcePolicy.id);
    assert.ok(copies.length >= 2);
    assert.ok(copies.every((row) => new Date(row.capturedAt).toISOString() === input.records[0]!.document.facts[0]!.retrievedAt));

    const reuse = structuredClone(input);
    reuse.idempotencyKey += "-reimport";
    assert.equal((await caller(OPERATOR_TOKEN, later).publishing.submit(reuse)).status, "published");
    const cutoff = () => new Date("2026-10-22T12:01:40.000Z");
    assert.equal((await caller(null, cutoff).publishing.search({ q: "Read Retention" })).length, 0);
    assert.equal(await caller(null, cutoff).publishing.detail({ subjectId: "subject-read-retention-coupe" }), null);
    reuse.idempotencyKey += "-too-old";
    await assert.rejects(() => caller(OPERATOR_TOKEN, cutoff).publishing.submit(reuse), /expired/);

    const noStorage = reviewedImport("Zero Retention Coupe");
    noStorage.publish = false;
    noStorage.sourcePolicy.retentionSeconds = 0;
    await assert.rejects(() => caller(OPERATOR_TOKEN).publishing.submit(noStorage), /expired/);
    assert.equal((await db.select().from(publishingStagedRecord)).some((row) => row.externalId === noStorage.records[0]!.externalId), false);
  });

  it("expires unchanged private payloads at their original deadline despite repeated document corrections", async () => {
    const input = reviewedImport("Private Capture Deadline Coupe");
    input.publish = false;
    input.sourcePolicy.id = crypto.randomUUID();
    input.sourcePolicy.retentionSeconds = 60;
    input.records[0]!.document.facts = [];
    await caller(OPERATOR_TOKEN).publishing.submit(input);
    for (const seconds of [30, 50]) {
      input.idempotencyKey += `-${seconds}`;
      input.records[0]!.document.displayName = `Corrected Private Capture ${seconds} Coupe`;
      await caller(OPERATOR_TOKEN, () => new Date(testClock().getTime() + seconds * 1000)).publishing.submit(input);
      const row = (await db.select().from(publishingStagedRecord)).find((item) => item.externalId === input.records[0]!.externalId);
      assert.equal(new Date(row!.capturedAt).toISOString(), BASE_TIME);
    }
    await cleanupPublishingCopies({ db, operatorToken: OPERATOR_TOKEN, now: () => new Date(testClock().getTime() + 60_000) }, OPERATOR_TOKEN);
    assert.equal((await db.select().from(publishingStagedRecord)).some((row) => row.externalId === input.records[0]!.externalId), false);

    const stricter = reviewedImport("Older Document Capture Coupe");
    stricter.publish = false;
    stricter.sourcePolicy.retentionSeconds = 60;
    stricter.records[0]!.document.facts[0]!.retrievedAt = new Date(testClock().getTime() - 30_000).toISOString();
    await caller(OPERATOR_TOKEN).publishing.submit(stricter);
    stricter.idempotencyKey += "-changed-private";
    stricter.records[0]!.privatePayload.marker += "-changed";
    await caller(OPERATOR_TOKEN).publishing.submit(stricter);
    await cleanupPublishingCopies({ db, operatorToken: OPERATOR_TOKEN, now: () => new Date(testClock().getTime() + 30_000) }, OPERATOR_TOKEN);
    assert.equal((await db.select().from(publishingStagedRecord)).some((row) => row.externalId === stricter.records[0]!.externalId), false);
  });

  it("withholds existing assertions when their policy is suspended", async () => {
    const input = reviewedImport("Read Suspension Coupe");
    input.sourcePolicy.id = crypto.randomUUID();
    await caller(OPERATOR_TOKEN).publishing.submit(input);
    assert.equal((await caller(null).publishing.search({ q: "Read Suspension" })).length, 1);
    // Simulates the operator's database suspension; imports cannot rewrite a reviewed revision.
    await db.update(publishingSourcePolicy).set({ suspended: true }).where(sql`${publishingSourcePolicy.id} = ${input.sourcePolicy.id}`);
    assert.equal((await caller(null).publishing.search({ q: "Read Suspension" })).length, 0);
    assert.equal(await caller(null).publishing.detail({ subjectId: "subject-read-suspension-coupe" }), null);
  });

  it("authorizes cleanup and purges expired staging and all historical copies while preserving permitted content", async () => {
    const staged = reviewedImport("Cleanup Staged Private Coupe");
    staged.sourcePolicy.id = crypto.randomUUID();
    staged.publish = false;
    staged.sourcePolicy.retentionSeconds = 60;
    staged.records[0]!.document.facts = [];
    await caller(OPERATOR_TOKEN).publishing.submit(staged);
    const repeated = structuredClone(staged);
    repeated.idempotencyKey += "-restaged";
    repeated.records[0]!.identity.note = "A later review does not recapture the source.";
    await caller(OPERATOR_TOKEN, () => new Date("2026-10-22T12:00:30.000Z")).publishing.submit(repeated);
    const stagedRow = (await db.select().from(publishingStagedRecord)).find((row) => row.externalId === staged.records[0]!.externalId);
    assert.ok(stagedRow);
    assert.equal(new Date(stagedRow.capturedAt).toISOString(), BASE_TIME);

    const cutoff = () => new Date("2026-10-22T13:00:00.000Z");
    const deps = { db, operatorToken: OPERATOR_TOKEN, now: cutoff };
    await assert.rejects(() => cleanupPublishingCopies(deps, undefined), /authorization/);
    await assert.rejects(() => cleanupPublishingCopies({ ...deps, operatorToken: null }, OPERATOR_TOKEN), /authorization/);
    assert.ok((await db.select().from(publishingStagedRecord)).some((row) => row.id === stagedRow.id));
    const baseline = await caller(null, cutoff).publishing.detail({ subjectId: "subject-reviewed-sample-coupe" });
    assert.ok(baseline);
    await db.execute(sql`create function test_cleanup_failure() returns trigger language plpgsql as $$
      begin raise exception 'private cleanup detail: %', row_to_json(OLD); end $$`);
    await db.execute(sql`create trigger test_cleanup_failure before delete on ${publishingPublishedAssertion}
      for each row execute function test_cleanup_failure()`);
    try {
      await assert.rejects(() => cleanupPublishingCopies(deps, OPERATOR_TOKEN), (error: unknown) => {
        assert.ok(error instanceof PublishingRejected);
        assert.match(error.message, /cleanup did not commit/);
        assert.doesNotMatch(error.message, /PAYLOAD-NOT-PUBLIC|CONTRACT-TEXT-NOT-PUBLIC|private cleanup detail|params:/);
        return true;
      });
      assert.ok((await db.select().from(publishingStagedRecord)).some((row) => row.id === stagedRow.id));
    } finally {
      await db.execute(sql`drop trigger test_cleanup_failure on ${publishingPublishedAssertion}`);
      await db.execute(sql`drop function test_cleanup_failure()`);
    }
    const result = await cleanupPublishingCopies(deps, OPERATOR_TOKEN);
    assert.ok(result.stagedDeleted >= 4);
    assert.ok(result.assertionsDeleted >= 4);
    const policies = await db.select().from(publishingSourcePolicy);
    const duePolicies = new Set(policies.filter((policy) => policy.suspended || policy.retentionSeconds <= 200 ||
      (policy.permissionExpiresAt && new Date(policy.permissionExpiresAt) <= cutoff())).map((policy) => policy.id));
    const remainingStaged = await db.select().from(publishingStagedRecord);
    const remainingAssertions = await db.select().from(publishingPublishedAssertion);
    assert.equal(remainingStaged.some((row) => duePolicies.has(row.sourcePolicyId)), false);
    assert.equal(remainingAssertions.some((row) => duePolicies.has(row.sourcePolicyId)), false);
    assert.deepEqual(await caller(null, cutoff).publishing.detail({ subjectId: "subject-reviewed-sample-coupe" }), baseline);
    assert.deepEqual(await cleanupPublishingCopies(deps, OPERATOR_TOKEN), { stagedDeleted: 0, assertionsDeleted: 0 });
    assert.equal(visitorText(result).includes(MARKERS.payload), false);
    assert.equal(visitorText(result).includes(MARKERS.contract), false);
  });

  it("returns a replay when identical imports are submitted together", async () => {
    const input = reviewedImport("Concurrent Replay Coupe");
    const [first, second] = await Promise.all([
      caller(OPERATOR_TOKEN).publishing.submit(structuredClone(input)),
      caller(OPERATOR_TOKEN).publishing.submit(structuredClone(input)),
    ]);
    assert.deepEqual([first.status, second.status].sort(), ["published", "replayed"]);
    assert.equal((await caller(null).publishing.search({ q: "Concurrent Replay Coupe" })).length, 1);
    const detail = await caller(null).publishing.detail({ subjectId: "subject-concurrent-replay-coupe" });
    assert.equal(detail?.facts[0]?.rawValue, "100 PS");
  });

  it("rejects a different import that loses the race for an idempotency key", async () => {
    const original = reviewedImport("Concurrent Conflict Coupe");
    const changed = structuredClone(original);
    const changedFact = changed.records[0]?.document.facts[0];
    assert.ok(changedFact);
    changedFact.rawValue = "999 PS";
    const settled = await Promise.allSettled([
      caller(OPERATOR_TOKEN).publishing.submit(original),
      caller(OPERATOR_TOKEN).publishing.submit(changed),
    ]);
    const fulfilled = settled.filter((result) => result.status === "fulfilled");
    const rejected = settled.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const published = fulfilled[0];
    const conflict = rejected[0];
    assert.ok(published && published.status === "fulfilled");
    assert.equal(published.value.status, "published");
    assert.ok(conflict && conflict.status === "rejected");
    assert.match(String(conflict.reason), /idempotency-conflict/);
    assert.doesNotMatch(String(conflict.reason), /did not commit/);
    assert.equal((await caller(null).publishing.search({ q: "Concurrent Conflict Coupe" })).length, 1);
    const detail = await caller(null).publishing.detail({ subjectId: "subject-concurrent-conflict-coupe" });
    const rawValue = detail?.facts[0]?.rawValue;
    assert.ok(rawValue === "100 PS" || rawValue === "999 PS");
  });
  it("keeps database error details and private bound parameters out of operator/API errors", async () => {
    const input = reviewedImport("Error Reporting Coupe");
    await db.execute(sql`create function test_private_failure() returns trigger language plpgsql as $$
      begin raise exception 'private database detail: %', NEW.private_payload; end $$`);
    await db.execute(sql`create trigger test_private_failure before insert on ${publishingStagedRecord}
      for each row execute function test_private_failure()`);
    try {
      await assert.rejects(
        () => runOperatorCommand({ db, operatorToken: OPERATOR_TOKEN, now: testClock }, JSON.stringify(input)),
        (error: unknown) => {
          assert.ok(error instanceof PublishingRejected);
          assert.equal(error.code, "partial");
          assert.doesNotMatch(error.message, /PAYLOAD-NOT-PUBLIC|CONTRACT-TEXT-NOT-PUBLIC|private database detail|insert into|params:/);
          return true;
        },
      );
      const response = await requestJson("POST", "/api/trpc/publishing.submit", input, app, OPERATOR_TOKEN);
      assert.equal(response.status, 412);
      assert.equal(response.text.includes("previous public projection was left unchanged"), true);
      for (const marker of [MARKERS.payload, MARKERS.contract, OPERATOR_TOKEN, "private database detail"]) {
        assert.equal(response.text.includes(marker), false, marker);
      }
      assert.equal((await caller(null).publishing.search({ q: "Error Reporting Coupe" })).length, 0);
    } finally {
      await db.execute(sql`drop trigger test_private_failure on ${publishingStagedRecord}`);
      await db.execute(sql`drop function test_private_failure()`);
    }
  });

  it("serializes cleanup with protected import writes", async () => {
    const input = reviewedImport("Serialized Cleanup Private Coupe");
    input.publish = false;
    input.sourcePolicy.retentionSeconds = 60;
    input.records[0]!.document.facts = [];
    await caller(OPERATOR_TOKEN).publishing.submit(input);
    const release = await holdAdvisoryLock(1128354388);
    const cleaning = cleanupPublishingCopies({ db, operatorToken: OPERATOR_TOKEN, now: () => new Date(testClock().getTime() + 60_000) }, OPERATOR_TOKEN);
    try {
      await until(async () => {
        const [row] = await db.select({ waiting: sql<boolean>`exists (
          select 1 from pg_locks where locktype = 'advisory' and objid = 1128354388 and not granted
        )` }).from(sql`(select 1) as lock_probe`);
        return row?.waiting === true;
      });
      assert.equal((await db.select().from(publishingStagedRecord)).some((row) => row.externalId === input.records[0]!.externalId), true);
    } finally { await release(); }
    assert.ok((await cleaning).stagedDeleted >= 1);
    assert.equal((await db.select().from(publishingStagedRecord)).some((row) => row.externalId === input.records[0]!.externalId), false);
  });

  it("rejects an in-flight restage after cleanup deletes its original private copy", async () => {
    const input = reviewedImport("In Flight Private Copy Coupe");
    input.publish = false;
    input.sourcePolicy.retentionSeconds = 60;
    input.records[0]!.document.facts = [];
    await caller(OPERATOR_TOKEN).publishing.submit(input);
    input.idempotencyKey += "-correction";
    input.records[0]!.document.displayName += " Corrected";
    let currentTime = new Date(testClock().getTime() + 30_000);
    const paused = pauseNextBatch(db);
    const importing = runOperatorCommand({ db: paused.db, operatorToken: OPERATOR_TOKEN, now: () => currentTime }, JSON.stringify(input));
    const outcome = importing.then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    try {
      await paused.entered;
      currentTime = new Date(testClock().getTime() + 60_000);
      await cleanupPublishingCopies({ db, operatorToken: OPERATOR_TOKEN, now: () => currentTime }, OPERATOR_TOKEN);
      assert.equal((await db.select().from(publishingStagedRecord)).some((row) => row.externalId === input.records[0]!.externalId), false);
    } finally { paused.release(); }
    const result = await outcome;
    assert.ok(result.error instanceof PublishingRejected);
    assert.equal(result.error.code, "partial");
    assert.doesNotMatch(result.error.message, /PAYLOAD-NOT-PUBLIC|CONTRACT-TEXT-NOT-PUBLIC|params:/);
    assert.equal((await db.select().from(publishingStagedRecord)).some((row) => row.externalId === input.records[0]!.externalId), false);
  });

  it("does not resurrect deleted assertions from a projection planned before cleanup", async () => {
    const expiring = reviewedImport("In Flight Expiring Assertion Coupe");
    expiring.sourcePolicy.retentionSeconds = 60;
    expiring.records[0]!.document.facts[0]!.retrievedAt = BASE_TIME;
    await caller(OPERATOR_TOKEN).publishing.submit(expiring);
    const added = reviewedImport("In Flight Surviving Assertion Coupe");
    const paused = pauseNextBatch(db);
    const importing = runOperatorCommand({ db: paused.db, operatorToken: OPERATOR_TOKEN, now: () => new Date(testClock().getTime() + 30_000) }, JSON.stringify(added));
    try {
      await paused.entered;
      await cleanupPublishingCopies({ db, operatorToken: OPERATOR_TOKEN, now: () => new Date(testClock().getTime() + 60_000) }, OPERATOR_TOKEN);
    } finally { paused.release(); }
    assert.equal((await importing).status, "published");
    assert.equal((await db.select().from(publishingPublishedAssertion)).some((row) => row.externalId === expiring.records[0]!.externalId), false);
    assert.ok(await caller(null).publishing.detail({ subjectId: added.records[0]!.document.canonicalSubjectId }));
  });

  it("checks actual database time after waiting for the publishing lock", async () => {
    for (const deadline of ["permission", "retention"] as const) {
      const lockKey = 1128354388;
      const [clock] = await db.select({ currentTime: sql<string>`clock_timestamp()` }).from(sql`(select 1) as clock_probe`);
      assert.ok(clock);
      const input = reviewedImport(`Database Clock ${deadline} Deadline Coupe`);
      const expiry = new Date(new Date(clock.currentTime).getTime() + 2000).toISOString();
      input.sourcePolicy.permissionExpiresAt = deadline === "permission" ? expiry : null;
      input.sourcePolicy.retentionSeconds = deadline === "retention" ? 2 : 86_400;
      input.records[0]!.document.facts[0]!.retrievedAt = new Date(clock.currentTime).toISOString();
      const before = await db.select().from(publishingProjectionPointer);
      const release = await holdAdvisoryLock(lockKey);
      // No deps.now: this exercises the production database clock after a real lock wait.
      const outcome = runOperatorCommand({ db, operatorToken: OPERATOR_TOKEN }, JSON.stringify(input))
        .then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
      try {
        await until(async () => {
          const [row] = await db.select({ waiting: sql<boolean>`exists (
            select 1 from pg_locks where locktype = 'advisory' and objid = ${lockKey} and not granted
          )` }).from(sql`(select 1) as lock_probe`);
          return row?.waiting === true;
        });
        await until(async () => {
          const [row] = await db.select({ due: sql<boolean>`clock_timestamp() >= cast(${expiry} as timestamptz)` }).from(sql`(select 1) as clock_probe`);
          return row?.due === true;
        });
      } finally { await release(); }
      const result = await outcome;
      assert.ok(result.error instanceof PublishingRejected);
      assert.equal(result.error.code, "partial");
      assert.deepEqual(await db.select().from(publishingProjectionPointer), before);
      assert.equal((await db.select().from(publishingStagedRecord)).some((row) => row.externalId === input.records[0]!.externalId), false);
      assert.equal(await caller(null).publishing.detail({ subjectId: input.records[0]!.document.canonicalSubjectId }), null);
    }
  });

  it("backfills source capture time on populated legacy tables without resetting their retention", async () => {
    const before = (await db.select().from(publishingPublishedAssertion)).find((row) => row.displayName === "Reviewed Sample Coupe");
    assert.ok(before);
    const staged = reviewedImport("Legacy Unfetched Stage Coupe");
    staged.sourcePolicy.id = crypto.randomUUID();
    staged.publish = false;
    staged.records[0]!.document.facts = [];
    await caller(OPERATOR_TOKEN).publishing.submit(staged);
    const restaged = structuredClone(staged);
    restaged.idempotencyKey += "-later";
    await caller(OPERATOR_TOKEN, () => new Date("2026-10-22T12:05:00.000Z")).publishing.submit(restaged);

    await db.execute(sql`alter table ${publishingPublishedAssertion} drop column captured_at`);
    await db.execute(sql`alter table ${publishingStagedRecord} drop column captured_at`);
    const migration = await readFile(new URL("../../../packages/db/src/migrations/20261023130303_publishing_retention/migration.sql", import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").filter((part) => part.trim())) {
      await db.execute(sql.raw(statement));
    }
    const after = (await db.select().from(publishingPublishedAssertion)).find((row) => row.id === before.id);
    assert.ok(after);
    assert.equal(new Date(after.capturedAt).toISOString(), "2026-10-22T00:00:00.000Z");
    const backfilledStage = (await db.select().from(publishingStagedRecord)).find((row) => row.sourcePolicyId === staged.sourcePolicy.id);
    assert.ok(backfilledStage);
    assert.equal(new Date(backfilledStage.capturedAt).toISOString(), BASE_TIME);
    assert.equal(new Date(backfilledStage.updatedAt).toISOString(), "2026-10-22T12:05:00.000Z");
  });

});

function pauseNextBatch(database: Database) {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const paused = new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "batch") return Reflect.get(target, property, receiver);
      return async (...args: Parameters<Database["batch"]>) => {
        enter();
        await released;
        return target.batch(...args);
      };
    },
  });
  return { db: paused, entered, release };
}

async function until(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, "Timed out waiting for the database synchronization condition");
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function caller(token: string | null, now: () => Date = testClock) {
  return appRouter.createCaller({
    db,
    now,
    operatorToken: OPERATOR_TOKEN,
    presentedOperatorToken: token,
  });
}

type OperatorImportInput = z.input<typeof operatorImportSchema>;
type InputRecord = NonNullable<OperatorImportInput["records"]>[number];
type InputFact = NonNullable<NonNullable<InputRecord["document"]["facts"]>[number]>;
type InputMedia = NonNullable<NonNullable<InputRecord["document"]["media"]>[number]>;
type ReviewedRecord = Omit<InputRecord, "privatePayload" | "document"> & {
  privatePayload: { marker: string };
  document: Omit<InputRecord["document"], "aliases" | "facts" | "media"> & {
    aliases: string[];
    facts: InputFact[];
    media: InputMedia[];
  };
};
type ReviewedImport = Omit<OperatorImportInput, "records" | "sourcePolicy"> & {
  sourcePolicy: Omit<OperatorImportInput["sourcePolicy"], "permittedFields" | "permittedGeographies"> & {
    permittedFields: string[];
    permittedGeographies: string[];
  };
  records: ReviewedRecord[];
};

function fact(input: ReviewedImport, property: string, rawValue: string): InputFact {
  const template = input.records[0]?.document.facts[0];
  assert.ok(template);
  return {
    ...template,
    property,
    rawValue,
    normalizedValue: rawValue,
    unit: null,
    standard: null,
  };
}

function reviewedImport(name: string): ReviewedImport {
  const slug = name.toLowerCase().replaceAll(" ", "-");
  return {
    idempotencyKey: `import-${slug}`,
    providerKey: "manual-test",
    publish: true,
    sourcePolicy: {
      providerKey: "manual-test",
      factPermission: "permitted",
      imagePermission: "permitted",
      permittedFields: ["displayName", "alias", "modelYearLabel", "power", "salesMarket"],
      permittedGeographies: ["IN"],
      attribution: "Reviewed sample attribution",
      retentionSeconds: 86_400,
      derivativeRestriction: MARKERS.derivative,
      aggregationRestriction: MARKERS.aggregation,
      refreshIntervalSeconds: 7_776_000,
      permissionExpiresAt: "2030-01-01T00:00:00.000Z",
      takedownObligation: MARKERS.takedown,
      deletionObligation: MARKERS.deletion,
      contractText: MARKERS.contract,
      suspended: false,
      reviewerRef: "policy-reviewer",
      reviewedAt: "2026-10-22T00:00:00.000Z",
    },
    records: [
      {
        externalId: `ext-${slug}`,
        provenance: "manual",
        privatePayload: { marker: MARKERS.payload },
        document: {
          displayName: name,
          aliases: [`${name} alias`.replace(" Coupe alias", " Alias Coupe")],
          canonicalSubjectId: `subject-${slug}`,
          salesMarket: "IN",
          modelYearLabel: "2026",
          facts: [
            {
              property: "power",
              rawValue: "100 PS",
              normalizedValue: "100",
              state: "known",
              unknownReason: null,
              unit: "PS",
              standard: "PS",
              sourceUrl: `https://example.test/sources/${slug}`,
              providerKey: "manual-test",
              observedAt: "2026-10-22T00:00:00.000Z",
              retrievedAt: "2026-10-22T00:00:00.000Z",
            },
          ],
          media: [
            {
              sourceUrl: `https://example.test/images/${slug}`,
              credit: "Reviewed sample credit",
              altText: "Neutral sample image",
            },
          ],
        },
        identity: {
          outcome: "certain",
          canonicalSubjectId: `subject-${slug}`,
          reviewerRef: "identity-reviewer",
          note: "Operator confirmed this is a distinct subject.",
        },
        factualReview: {
          outcome: "passed",
          reviewerRef: "fact-reviewer",
          reviewedAt: "2026-10-22T00:00:00.000Z",
        },
        rightsReview: {
          outcome: "passed",
          reviewerRef: "rights-reviewer",
          reviewedAt: "2026-10-22T00:00:00.000Z",
        },
      },
    ],
  };
}

function visitorText(value: unknown): string {
  return JSON.stringify(value);
}

async function requestJson(method: "GET" | "POST", path: string, input: unknown, targetApp = app, token?: string): Promise<{
  status: number;
  text: string;
}> {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  const url = new URL(path, "http://127.0.0.1");
  if (method === "GET") url.searchParams.set("input", JSON.stringify(input));
  const response = await targetApp.request(url, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(input) : undefined,
  });
  return { status: response.status, text: await response.text() };
}
