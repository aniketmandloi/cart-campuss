import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PublishingRejected, runOperatorCommand } from "@cart-campuss/api/publishing";
import { appRouter } from "@cart-campuss/api/routers/index";
import { commitNeonHttpBatch, type Database } from "@cart-campuss/db";
import {
  publishingPublishedAssertion,
  publishingProjectionGeneration,
  publishingProjectionPointer,
  publishingSourcePolicy,
  publishingStagedRecord,
} from "@cart-campuss/db/schema/publishing";

import { createApp, type AppDeps } from "../src/app";
import { startPublishingDatabase } from "./ephemeral-postgres";

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
let stopDatabase: (() => Promise<void>) | undefined;

before(async () => {
  const started = await startPublishingDatabase();
  db = started.db;
  stopDatabase = started.stop;
  app = createApp({
    db,
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
    const result = await runOperatorCommand({ db, operatorToken: OPERATOR_TOKEN }, JSON.stringify(input));
    assert.equal(result.status, "published");
    assert.equal(result.publishedSubjectIds.includes(OPERATOR_TOKEN), false);
    const detail = await caller(null).publishing.detail({ subjectId: "subject-command-published-coupe" });
    assert.equal(detail?.displayName, "Command Published Coupe");
    assert.equal(visitorText(result).includes(MARKERS.contract), false);
    assert.equal(visitorText(result).includes(MARKERS.payload), false);
  });
});

function caller(token: string | null) {
  return appRouter.createCaller({
    db,
    operatorToken: OPERATOR_TOKEN,
    presentedOperatorToken: token,
  });
}

function reviewedImport(name: string): {
  idempotencyKey: string;
  providerKey: string;
  publish: boolean;
  sourcePolicy: {
    providerKey: string;
    factPermission?: "denied" | "permitted";
    imagePermission?: "denied" | "permitted";
    permittedFields: string[];
    permittedGeographies: string[];
    attribution: string;
    retentionSeconds: number;
    derivativeRestriction: string;
    aggregationRestriction: string;
    refreshIntervalSeconds: number;
    permissionExpiresAt: string | null;
    takedownObligation: string;
    deletionObligation: string;
    contractText: string | null;
    suspended: boolean;
    reviewerRef: string | null;
    reviewedAt: string | null;
  };
  records: Array<{
    externalId: string;
    provenance: "manual" | "seed" | "import" | "fixture";
    privatePayload: { marker: string };
    document: {
      displayName: string;
      aliases: string[];
      canonicalSubjectId: string;
      salesMarket: string;
      modelYearLabel: string | null;
      facts: Array<{
        property: string;
        rawValue: string;
        normalizedValue: string | null;
        state: "known" | "unknown";
        unknownReason: string | null;
        unit: string | null;
        standard: string | null;
        sourceUrl: string | null;
        providerKey: string;
        observedAt: string | null;
        retrievedAt: string;
      }>;
      media: Array<{ sourceUrl: string; credit: string; altText: string }>;
    };
    identity: {
      outcome: "pending" | "certain" | "uncertain";
      canonicalSubjectId: string | null;
      reviewerRef: string | null;
      note: string;
    };
    factualReview: {
      outcome: "pending" | "passed" | "failed";
      reviewerRef: string | null;
      reviewedAt: string | null;
    };
    rightsReview: {
      outcome: "pending" | "passed" | "failed";
      reviewerRef: string | null;
      reviewedAt: string | null;
    };
  }>;
} {
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

async function requestJson(method: "GET" | "POST", path: string, input: unknown): Promise<{
  status: number;
  text: string;
}> {
  const headers = new Headers({ "content-type": "application/json" });
  const url = new URL(path, "http://127.0.0.1");
  if (method === "GET") url.searchParams.set("input", JSON.stringify(input));
  const response = await app.request(url, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(input) : undefined,
  });
  return { status: response.status, text: await response.text() };
}
