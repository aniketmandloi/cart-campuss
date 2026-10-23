import {
  publishingImportBatch,
  publishingProjectionGeneration,
  publishingProjectionPointer,
  publishingPublishedAssertion,
  publishingSourcePolicy,
  publishingStagedRecord,
} from "@cart-campuss/db/schema/publishing";
import { and, eq, max, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";

import { commitNeonHttpBatch, type Database } from "@cart-campuss/db";

const IDENTITY_FACT_PROPERTIES = new Set([
  "displayName",
  "alias",
  "name",
  "salesMarket",
  "modelYearLabel",
]);

const MINIMUM_OPERATOR_TOKEN_LENGTH = 32;

export class PublishingRejected extends Error {
  readonly code:
    | "unauthorized"
    | "validation"
    | "rights"
    | "identity"
    | "factual"
    | "fixture"
    | "names-only"
    | "expired"
    | "suspended"
    | "idempotency-conflict"
    | "partial";

  constructor(code: PublishingRejected["code"], message: string) {
    super(message);
    this.name = "PublishingRejected";
    this.code = code;
  }
}

export type PublishingDeps = {
  db: Database;
  operatorToken: string | null;
  now?: () => Date;
};

export type PublicFact = {
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
  sourcePolicyId: string;
  factualReviewerRef: string;
  rightsReviewerRef: string;
};

export type PublicMedia = {
  sourceUrl: string;
  credit: string;
  altText: string;
  sourcePolicyId: string;
  rightsReviewerRef: string;
};

export type PublicSearchHit = {
  canonicalSubjectId: string;
  displayName: string;
  salesMarket: string;
  modelYearLabel: string | null;
  publishedAt: string;
};

export type PublicDetail = PublicSearchHit & {
  aliases: string[];
  attribution: string;
  sourcePolicyId: string;
  factualReviewerRef: string;
  rightsReviewerRef: string;
  reviewedAt: string;
  facts: PublicFact[];
  media: PublicMedia[];
};

export type OperatorResult = {
  status: "staged" | "held" | "published" | "replayed";
  idempotencyKey: string;
  publishedSubjectIds: string[];
  rejection?: {
    code: string;
    message: string;
    externalIds: string[];
  };
};

const sourcedFactSchema = z
  .object({
    property: z.string().trim().min(1),
    rawValue: z.string().min(1),
    normalizedValue: z.string().min(1).nullable(),
    state: z.enum(["known", "unknown"]),
    unknownReason: z.string().min(1).nullable(),
    unit: z.string().min(1).nullable(),
    standard: z.string().min(1).nullable(),
    sourceUrl: z.url().nullable(),
    providerKey: z.string().trim().min(1),
    observedAt: z.iso.datetime().nullable(),
    retrievedAt: z.iso.datetime(),
  })
  .superRefine((fact, ctx) => {
    if (fact.state === "unknown" && !fact.unknownReason) {
      ctx.addIssue({ code: "custom", path: ["unknownReason"] });
    }
    if (fact.state === "known" && fact.unknownReason) {
      ctx.addIssue({ code: "custom", path: ["unknownReason"] });
    }
  });

const mediaSchema = z.object({
  sourceUrl: z.url(),
  credit: z.string().trim().min(1),
  altText: z.string().trim().min(1),
});

const sourcePolicySchema = z.object({
  id: z.uuid().optional(),
  providerKey: z.string().trim().min(1),
  factPermission: z.enum(["denied", "permitted"]).default("denied"),
  imagePermission: z.enum(["denied", "permitted"]).default("denied"),
  permittedFields: z.array(z.string().trim().min(1)).default([]),
  permittedGeographies: z.array(z.string().regex(/^[A-Z]{2}$/)).default([]),
  attribution: z.string().default(""),
  retentionSeconds: z.number().int().nonnegative(),
  derivativeRestriction: z.string().trim().min(1),
  aggregationRestriction: z.string().trim().min(1),
  refreshIntervalSeconds: z.number().int().positive(),
  permissionExpiresAt: z.iso.datetime().nullable().default(null),
  takedownObligation: z.string().trim().min(1),
  deletionObligation: z.string().trim().min(1),
  contractText: z.string().trim().min(1).nullable().default(null),
  suspended: z.boolean().default(false),
  reviewerRef: z.string().trim().min(1).nullable().default(null),
  reviewedAt: z.iso.datetime().nullable().default(null),
});

const recordSchema = z.object({
  externalId: z.string().trim().min(1),
  provenance: z.enum(["manual", "seed", "import", "fixture"]),
  privatePayload: z.record(z.string(), z.unknown()).default({}),
  document: z.object({
    displayName: z.string().trim().min(1),
    aliases: z.array(z.string().trim().min(1)).default([]),
    canonicalSubjectId: z.string().trim().min(1),
    salesMarket: z.string().regex(/^[A-Z]{2}$/),
    modelYearLabel: z.string().trim().min(1).nullable().default(null),
    facts: z.array(sourcedFactSchema).default([]),
    media: z.array(mediaSchema).default([]),
  }),
  identity: z.object({
    outcome: z.enum(["pending", "certain", "uncertain"]),
    canonicalSubjectId: z.string().trim().min(1).nullable().default(null),
    reviewerRef: z.string().trim().min(1).nullable().default(null),
    note: z.string().default(""),
  }),
  factualReview: z.object({
    outcome: z.enum(["pending", "passed", "failed"]),
    reviewerRef: z.string().trim().min(1).nullable().default(null),
    reviewedAt: z.iso.datetime().nullable().default(null),
  }),
  rightsReview: z.object({
    outcome: z.enum(["pending", "passed", "failed"]),
    reviewerRef: z.string().trim().min(1).nullable().default(null),
    reviewedAt: z.iso.datetime().nullable().default(null),
  }),
});

export const operatorImportSchema = z.object({
  idempotencyKey: z.string().trim().min(1),
  providerKey: z.string().trim().min(1),
  sourcePolicy: sourcePolicySchema,
  records: z.array(recordSchema).min(1),
  publish: z.boolean().default(false),
});

type OperatorImport = z.infer<typeof operatorImportSchema>;
type ImportRecord = OperatorImport["records"][number];
type SourcePolicyInput = OperatorImport["sourcePolicy"];

type GateCode = "fixture" | "identity" | "factual" | "rights" | "names-only" | "expired" | "suspended";

type GateFailure = {
  externalId: string;
  code: GateCode;
  message: string;
};

type CurrentAssertion = {
  providerKey: string;
  externalId: string;
  canonicalSubjectId: string;
  displayName: string;
  aliases: string[];
  salesMarket: string;
  modelYearLabel: string | null;
  facts: unknown;
  media: unknown;
  attribution: string;
  sourcePolicyId: string;
  factualReviewerRef: string;
  rightsReviewerRef: string;
  observedAt: string | null;
  reviewedAt: string;
};

const storedResultSchema = z.object({
  status: z.enum(["staged", "held", "published"]),
  idempotencyKey: z.string(),
  publishedSubjectIds: z.array(z.string()),
  rejection: z
    .object({
      code: z.string(),
      message: z.string(),
      externalIds: z.array(z.string()),
    })
    .optional(),
});

export function readPresentedOperatorToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer (\S+)$/.exec(authorizationHeader);
  const token = match?.[1];
  return token ? token : null;
}

export function assertOperatorAuthorized(configured: string | null, presented: string | undefined): void {
  if (!configured || configured.length < MINIMUM_OPERATOR_TOKEN_LENGTH) {
    throw new PublishingRejected("unauthorized", "Operator authorization is not configured.");
  }
  if (!presented || !tokensMatch(configured, presented)) {
    throw new PublishingRejected("unauthorized", "Operator authorization was rejected.");
  }
}

export async function searchPublishedCatalogue(
  db: Database,
  query: { q?: string },
): Promise<PublicSearchHit[]> {
  const term = query.q?.trim() ?? "";
  const pattern = likePattern(term);
  const match = sql`(
    ${publishingPublishedAssertion.displayName} ilike ${pattern} escape '\\'
    or exists (
      select 1 from jsonb_array_elements_text(${publishingPublishedAssertion.aliases}) as alias(value)
      where alias.value ilike ${pattern} escape '\\'
    )
  )`;
  const rows = await db
    .select({
      canonicalSubjectId: publishingPublishedAssertion.canonicalSubjectId,
      displayName: publishingPublishedAssertion.displayName,
      salesMarket: publishingPublishedAssertion.salesMarket,
      modelYearLabel: publishingPublishedAssertion.modelYearLabel,
      publishedAt: publishingProjectionGeneration.publishedAt,
    })
    .from(publishingPublishedAssertion)
    .innerJoin(
      publishingProjectionPointer,
      and(
        eq(publishingPublishedAssertion.generationId, publishingProjectionPointer.generationId),
        eq(publishingProjectionPointer.id, 1),
      ),
    )
    .innerJoin(
      publishingProjectionGeneration,
      eq(publishingProjectionGeneration.id, publishingProjectionPointer.generationId),
    )
    .where(term.length > 0 ? and(eq(publishingProjectionPointer.id, 1), match) : eq(publishingProjectionPointer.id, 1))
    .orderBy(publishingPublishedAssertion.displayName, publishingPublishedAssertion.canonicalSubjectId);

  return rows.map((row) => ({
    canonicalSubjectId: row.canonicalSubjectId,
    displayName: row.displayName,
    salesMarket: row.salesMarket,
    modelYearLabel: row.modelYearLabel,
    publishedAt: toIso(row.publishedAt),
  }));
}

export async function readPublishedCatalogueDetail(
  db: Database,
  subjectId: string,
): Promise<PublicDetail | null> {
  const [row] = await db
    .select({
      canonicalSubjectId: publishingPublishedAssertion.canonicalSubjectId,
      displayName: publishingPublishedAssertion.displayName,
      aliases: publishingPublishedAssertion.aliases,
      salesMarket: publishingPublishedAssertion.salesMarket,
      modelYearLabel: publishingPublishedAssertion.modelYearLabel,
      facts: publishingPublishedAssertion.facts,
      media: publishingPublishedAssertion.media,
      attribution: publishingPublishedAssertion.attribution,
      sourcePolicyId: publishingPublishedAssertion.sourcePolicyId,
      factualReviewerRef: publishingPublishedAssertion.factualReviewerRef,
      rightsReviewerRef: publishingPublishedAssertion.rightsReviewerRef,
      reviewedAt: publishingPublishedAssertion.reviewedAt,
      publishedAt: publishingProjectionGeneration.publishedAt,
    })
    .from(publishingPublishedAssertion)
    .innerJoin(
      publishingProjectionPointer,
      and(
        eq(publishingPublishedAssertion.generationId, publishingProjectionPointer.generationId),
        eq(publishingProjectionPointer.id, 1),
      ),
    )
    .innerJoin(
      publishingProjectionGeneration,
      eq(publishingProjectionGeneration.id, publishingProjectionPointer.generationId),
    )
    .where(
      and(
        eq(publishingProjectionPointer.id, 1),
        eq(publishingPublishedAssertion.canonicalSubjectId, subjectId),
      ),
    )
    .limit(1);

  if (!row) return null;
  return {
    canonicalSubjectId: row.canonicalSubjectId,
    displayName: row.displayName,
    aliases: asStringArray(row.aliases),
    salesMarket: row.salesMarket,
    modelYearLabel: row.modelYearLabel,
    publishedAt: toIso(row.publishedAt),
    attribution: row.attribution,
    sourcePolicyId: row.sourcePolicyId,
    factualReviewerRef: row.factualReviewerRef,
    rightsReviewerRef: row.rightsReviewerRef,
    reviewedAt: toIso(row.reviewedAt),
    facts: asPublicFacts(row.facts),
    media: asPublicMedia(row.media),
  };
}

export async function applyOperatorImport(
  deps: PublishingDeps,
  presentedToken: string | undefined,
  input: unknown,
): Promise<OperatorResult> {
  assertOperatorAuthorized(deps.operatorToken, presentedToken);
  const parsed = parseImport(input);
  const payloadHash = await sha256(canonicalJson(parsed));
  const now = (deps.now ?? (() => new Date()))();

  const [existing] = await deps.db
    .select({
      payloadHash: publishingImportBatch.payloadHash,
      result: publishingImportBatch.result,
    })
    .from(publishingImportBatch)
    .where(eq(publishingImportBatch.idempotencyKey, parsed.idempotencyKey))
    .limit(1);

  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new PublishingRejected(
        "idempotency-conflict",
        "This idempotency key was already used for a different import.",
      );
    }
    const stored = storedResultSchema.parse(existing.result);
    return { ...stored, status: "replayed" };
  }

  const current = await readCurrentProjection(deps.db);
  const failures = parsed.publish ? collectFailures(parsed, current, now) : [];
  const publishable = parsed.publish && failures.length === 0 ? parsed.records : [];
  const status = !parsed.publish ? "staged" : failures.length > 0 ? "held" : "published";
  const rejection = status === "held" ? rejectionFor(parsed.records, failures) : undefined;
  const publishedSubjectIds =
    status === "published" ? publishable.map((record) => record.document.canonicalSubjectId) : [];
  const stored = storedResultSchema.parse({
    status,
    idempotencyKey: parsed.idempotencyKey,
    publishedSubjectIds,
    ...(rejection ? { rejection } : {}),
  });

  const policyId = parsed.sourcePolicy.id ?? randomId();
  const batchId = randomId();
  const createdAt = now.toISOString();
  const statements: BatchItem<"pg">[] = [
    upsertPolicy(deps.db, parsed, policyId, createdAt),
    deps.db.insert(publishingImportBatch).values({
      id: batchId,
      idempotencyKey: parsed.idempotencyKey,
      providerKey: parsed.providerKey,
      payloadHash,
      status,
      result: stored,
      createdAt,
    }),
    ...(await stagedStatements(deps.db, parsed, batchId, policyId, createdAt)),
  ];

  if (status === "published") {
    const generationId = randomId();
    const nextGeneration = current.maxGeneration + 1;
    const replaced = new Set(publishable.map((record) => record.externalId));
    statements.push(
      deps.db.insert(publishingProjectionGeneration).values({
        id: generationId,
        generation: nextGeneration,
        publishedAt: createdAt,
        batchId,
      }),
    );
    for (const assertion of current.assertions) {
      if (replaced.has(assertion.externalId)) continue;
      statements.push(
        deps.db.insert(publishingPublishedAssertion).values({
          ...assertion,
          id: randomId(),
          generationId,
          observedAt: assertion.observedAt,
        }),
      );
    }
    for (const record of publishable) {
      statements.push(
        deps.db.insert(publishingPublishedAssertion).values(
          publicAssertion(record, parsed.sourcePolicy, policyId, generationId, createdAt),
        ),
      );
    }
    statements.push(
      deps.db
        .insert(publishingProjectionPointer)
        .values({ id: 1, generationId, updatedAt: createdAt })
        .onConflictDoUpdate({
          target: publishingProjectionPointer.id,
          set: { generationId, updatedAt: createdAt },
        }),
    );
  }

  try {
    await commitNeonHttpBatch(deps.db, statements);
  } catch (error) {
    const secrets = [
      deps.operatorToken ?? "",
      parsed.sourcePolicy.contractText ?? "",
      JSON.stringify(parsed.records.map((record) => record.privatePayload)),
    ];
    throw new PublishingRejected(
      "partial",
      `The publication did not commit, and the previous public projection was left unchanged. ${redact(errorText(error), secrets)}`,
    );
  }

  return stored;
}

export async function runOperatorCommand(deps: PublishingDeps, importText: string): Promise<OperatorResult> {
  assertOperatorAuthorized(deps.operatorToken, deps.operatorToken ?? undefined);
  let input: unknown;
  try {
    input = JSON.parse(importText);
  } catch {
    throw new PublishingRejected("validation", "Import file was not valid JSON.");
  }
  return applyOperatorImport(deps, deps.operatorToken ?? undefined, input);
}

function parseImport(input: unknown): OperatorImport {
  const parsed = operatorImportSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "import"}: ${issue.code}`)
      .join("; ");
    throw new PublishingRejected("validation", `Import data did not match the publishing schema. ${details}`);
  }
  const value = parsed.data;
  if (value.sourcePolicy.providerKey !== value.providerKey) {
    throw new PublishingRejected("validation", "The source policy provider does not match the import provider.");
  }
  const externalIds = new Set<string>();
  for (const record of value.records) {
    if (externalIds.has(record.externalId)) {
      throw new PublishingRejected("validation", "The import repeats a provider external id.");
    }
    externalIds.add(record.externalId);
    for (const fact of record.document.facts) {
      if (fact.providerKey !== value.providerKey) {
        throw new PublishingRejected("validation", "A sourced fact cites a different provider.");
      }
    }
  }
  return value;
}

function collectFailures(parsed: OperatorImport, current: CurrentProjection, now: Date): GateFailure[] {
  const subjectCounts = new Map<string, number>();
  for (const record of parsed.records) {
    const subjectId = record.document.canonicalSubjectId;
    subjectCounts.set(subjectId, (subjectCounts.get(subjectId) ?? 0) + 1);
  }
  const failures: GateFailure[] = [];
  for (const record of parsed.records) {
    const failure = evaluateRecord(record, parsed, current, subjectCounts, now);
    if (failure) failures.push(failure);
  }
  return failures;
}

function evaluateRecord(
  record: ImportRecord,
  parsed: OperatorImport,
  current: CurrentProjection,
  subjectCounts: Map<string, number>,
  now: Date,
): GateFailure | null {
  const externalId = record.externalId;
  const policy = parsed.sourcePolicy;
  const subjectId = record.document.canonicalSubjectId;
  if (record.provenance === "fixture") {
    return { externalId, code: "fixture", message: "Preview fixtures stay out of the public catalogue." };
  }
  if (record.identity.outcome === "uncertain") {
    return { externalId, code: "identity", message: "An uncertain identity match stays unpublished." };
  }
  if (record.identity.outcome !== "certain" || !record.identity.reviewerRef) {
    return { externalId, code: "identity", message: "Identity has not been decided." };
  }
  if (record.identity.canonicalSubjectId !== subjectId) {
    return { externalId, code: "identity", message: "The identity decision does not match the canonical subject." };
  }
  if ((subjectCounts.get(subjectId) ?? 0) > 1) {
    return { externalId, code: "identity", message: "Two records in this import use the same canonical subject." };
  }
  const sameSource = current.assertions.find(
    (assertion) => assertion.providerKey === parsed.providerKey && assertion.externalId === externalId,
  );
  if (sameSource && sameSource.canonicalSubjectId !== subjectId) {
    return {
      externalId,
      code: "identity",
      message: "That source record is already published under a different canonical subject.",
    };
  }
  const otherSource = current.assertions.find(
    (assertion) =>
      assertion.canonicalSubjectId === subjectId &&
      !(assertion.providerKey === parsed.providerKey && assertion.externalId === externalId),
  );
  if (otherSource) {
    return {
      externalId,
      code: "identity",
      message: "That canonical subject is already published for a different source record.",
    };
  }
  if (record.factualReview.outcome !== "passed" || !record.factualReview.reviewerRef) {
    return { externalId, code: "factual", message: "Factual review has not passed." };
  }
  if (record.rightsReview.outcome !== "passed" || !record.rightsReview.reviewerRef) {
    return { externalId, code: "rights", message: "Rights review has not passed." };
  }
  if (!policy.reviewerRef || !policy.reviewedAt) {
    return { externalId, code: "rights", message: "The source policy has not been reviewed." };
  }
  if (policy.suspended) {
    return { externalId, code: "suspended", message: "A suspended source cannot add public results." };
  }
  if (isExpired(policy.permissionExpiresAt, now)) {
    return { externalId, code: "expired", message: "The source permission has expired." };
  }
  if (policy.factPermission !== "permitted") {
    return { externalId, code: "rights", message: "Fact permission is denied." };
  }
  if (!policy.permittedGeographies.includes(record.document.salesMarket)) {
    return { externalId, code: "rights", message: "The sales market is outside the permitted geography." };
  }
  if (policy.attribution.trim().length === 0) {
    return { externalId, code: "rights", message: "A permitted fact needs attribution." };
  }
  if (!policy.permittedFields.includes("displayName")) {
    return { externalId, code: "rights", message: "The display name is not a permitted field." };
  }
  const specification = record.document.facts.filter((fact) => !IDENTITY_FACT_PROPERTIES.has(fact.property));
  if (specification.length === 0) {
    return { externalId, code: "names-only", message: "A public record needs a sourced fact, not only a name." };
  }
  const visible = specification.filter((fact) => policy.permittedFields.includes(fact.property));
  if (visible.length === 0) {
    return { externalId, code: "rights", message: "No permitted sourced fact remains." };
  }
  return null;
}

function rejectionFor(records: ImportRecord[], failures: GateFailure[]): NonNullable<OperatorResult["rejection"]> {
  const first = failures[0];
  const sameCode =
    first !== undefined &&
    failures.length === records.length &&
    failures.every((failure) => failure.code === first.code);
  return {
    code: sameCode && first ? first.code : "partial",
    message: failures.map((failure) => `${failure.externalId}: ${failure.message}`).join(" "),
    externalIds: failures.map((failure) => failure.externalId),
  };
}

type CurrentProjection = {
  maxGeneration: number;
  assertions: CurrentAssertion[];
};

async function readCurrentProjection(db: Database): Promise<CurrentProjection> {
  const [generation] = await db
    .select({ value: max(publishingProjectionGeneration.generation) })
    .from(publishingProjectionGeneration);
  const rows = await db
    .select({
      providerKey: publishingPublishedAssertion.providerKey,
      externalId: publishingPublishedAssertion.externalId,
      canonicalSubjectId: publishingPublishedAssertion.canonicalSubjectId,
      displayName: publishingPublishedAssertion.displayName,
      aliases: publishingPublishedAssertion.aliases,
      salesMarket: publishingPublishedAssertion.salesMarket,
      modelYearLabel: publishingPublishedAssertion.modelYearLabel,
      facts: publishingPublishedAssertion.facts,
      media: publishingPublishedAssertion.media,
      attribution: publishingPublishedAssertion.attribution,
      sourcePolicyId: publishingPublishedAssertion.sourcePolicyId,
      factualReviewerRef: publishingPublishedAssertion.factualReviewerRef,
      rightsReviewerRef: publishingPublishedAssertion.rightsReviewerRef,
      observedAt: publishingPublishedAssertion.observedAt,
      reviewedAt: publishingPublishedAssertion.reviewedAt,
    })
    .from(publishingPublishedAssertion)
    .innerJoin(
      publishingProjectionPointer,
      and(
        eq(publishingPublishedAssertion.generationId, publishingProjectionPointer.generationId),
        eq(publishingProjectionPointer.id, 1),
      ),
    );
  const maxGeneration = generationNumber(generation?.value);
  return {
    maxGeneration,
    assertions: rows.map((row) => ({
      ...row,
      aliases: asStringArray(row.aliases),
      observedAt: row.observedAt ? toIso(row.observedAt) : null,
      reviewedAt: toIso(row.reviewedAt),
    })),
  };
}

function upsertPolicy(db: Database, parsed: OperatorImport, policyId: string, createdAt: string) {
  const policy = parsed.sourcePolicy;
  const values = {
    id: policyId,
    providerKey: policy.providerKey,
    factPermission: policy.factPermission,
    imagePermission: policy.imagePermission,
    permittedFields: policy.permittedFields,
    permittedGeographies: policy.permittedGeographies,
    attribution: policy.attribution,
    retentionSeconds: policy.retentionSeconds,
    derivativeRestriction: policy.derivativeRestriction,
    aggregationRestriction: policy.aggregationRestriction,
    refreshIntervalSeconds: policy.refreshIntervalSeconds,
    permissionExpiresAt: policy.permissionExpiresAt,
    takedownObligation: policy.takedownObligation,
    deletionObligation: policy.deletionObligation,
    contractText: policy.contractText,
    suspended: policy.suspended,
    reviewerRef: policy.reviewerRef,
    reviewedAt: policy.reviewedAt,
    createdAt,
  };
  return db
    .insert(publishingSourcePolicy)
    .values(values)
    .onConflictDoUpdate({
      target: publishingSourcePolicy.id,
      set: {
        providerKey: values.providerKey,
        factPermission: values.factPermission,
        imagePermission: values.imagePermission,
        permittedFields: values.permittedFields,
        permittedGeographies: values.permittedGeographies,
        attribution: values.attribution,
        retentionSeconds: values.retentionSeconds,
        derivativeRestriction: values.derivativeRestriction,
        aggregationRestriction: values.aggregationRestriction,
        refreshIntervalSeconds: values.refreshIntervalSeconds,
        permissionExpiresAt: values.permissionExpiresAt,
        takedownObligation: values.takedownObligation,
        deletionObligation: values.deletionObligation,
        contractText: values.contractText,
        suspended: values.suspended,
        reviewerRef: values.reviewerRef,
        reviewedAt: values.reviewedAt,
      },
    });
}

async function stagedStatements(
  db: Database,
  parsed: OperatorImport,
  batchId: string,
  policyId: string,
  updatedAt: string,
): Promise<BatchItem<"pg">[]> {
  const statements: BatchItem<"pg">[] = [];
  for (const record of parsed.records) {
    const contentHash = await sha256(canonicalJson(record));
    statements.push(upsertStaged(db, parsed, record, batchId, policyId, updatedAt, contentHash));
  }
  return statements;
}

function upsertStaged(
  db: Database,
  parsed: OperatorImport,
  record: ImportRecord,
  batchId: string,
  policyId: string,
  updatedAt: string,
  contentHash: string,
) {
  const values = {
    id: randomId(),
    providerKey: parsed.providerKey,
    externalId: record.externalId,
    batchId,
    contentHash,
    privatePayload: record.privatePayload,
    provenance: record.provenance,
    document: record.document,
    identityOutcome: record.identity.outcome,
    identitySubjectId: record.identity.canonicalSubjectId,
    identityReviewerRef: record.identity.reviewerRef,
    identityNote: record.identity.note,
    factualOutcome: record.factualReview.outcome,
    factualReviewerRef: record.factualReview.reviewerRef,
    rightsOutcome: record.rightsReview.outcome,
    rightsReviewerRef: record.rightsReview.reviewerRef,
    sourcePolicyId: policyId,
    updatedAt,
  };
  return db
    .insert(publishingStagedRecord)
    .values(values)
    .onConflictDoUpdate({
      target: [publishingStagedRecord.providerKey, publishingStagedRecord.externalId],
      set: {
        batchId: values.batchId,
        contentHash: values.contentHash,
        privatePayload: values.privatePayload,
        provenance: values.provenance,
        document: values.document,
        identityOutcome: values.identityOutcome,
        identitySubjectId: values.identitySubjectId,
        identityReviewerRef: values.identityReviewerRef,
        identityNote: values.identityNote,
        factualOutcome: values.factualOutcome,
        factualReviewerRef: values.factualReviewerRef,
        rightsOutcome: values.rightsOutcome,
        rightsReviewerRef: values.rightsReviewerRef,
        sourcePolicyId: values.sourcePolicyId,
        updatedAt: values.updatedAt,
      },
    });
}

function publicAssertion(
  record: ImportRecord,
  policy: SourcePolicyInput,
  policyId: string,
  generationId: string,
  publishedAt: string,
) {
  const factualReviewerRef = record.factualReview.reviewerRef ?? "";
  const rightsReviewerRef = record.rightsReview.reviewerRef ?? "";
  const facts = record.document.facts
    .filter((fact) => !IDENTITY_FACT_PROPERTIES.has(fact.property))
    .filter((fact) => policy.permittedFields.includes(fact.property))
    .map((fact) => ({
      property: fact.property,
      rawValue: fact.rawValue,
      normalizedValue: fact.normalizedValue,
      state: fact.state,
      unknownReason: fact.unknownReason,
      unit: fact.unit,
      standard: fact.standard,
      sourceUrl: fact.sourceUrl,
      providerKey: fact.providerKey,
      observedAt: fact.observedAt,
      retrievedAt: fact.retrievedAt,
      sourcePolicyId: policyId,
      factualReviewerRef,
      rightsReviewerRef,
    }));
  const media =
    policy.imagePermission === "permitted"
      ? record.document.media.map((item) => ({
          sourceUrl: item.sourceUrl,
          credit: item.credit,
          altText: item.altText,
          sourcePolicyId: policyId,
          rightsReviewerRef,
        }))
      : [];
  const observedAt = facts
    .map((fact) => fact.observedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;
  const reviewedAt =
    [record.factualReview.reviewedAt, record.rightsReview.reviewedAt, policy.reviewedAt]
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? publishedAt;
  return {
    id: randomId(),
    generationId,
    providerKey: policy.providerKey,
    externalId: record.externalId,
    canonicalSubjectId: record.document.canonicalSubjectId,
    displayName: record.document.displayName,
    aliases: policy.permittedFields.includes("alias") ? record.document.aliases : [],
    salesMarket: record.document.salesMarket,
    modelYearLabel: policy.permittedFields.includes("modelYearLabel") ? record.document.modelYearLabel : null,
    facts,
    media,
    attribution: policy.attribution,
    sourcePolicyId: policyId,
    factualReviewerRef,
    rightsReviewerRef,
    observedAt,
    reviewedAt,
  };
}

function tokensMatch(expected: string, presented: string): boolean {
  const expectedBytes = new TextEncoder().encode(expected);
  const presentedBytes = new TextEncoder().encode(presented);
  const length = Math.max(expectedBytes.length, presentedBytes.length);
  let difference = expectedBytes.length === presentedBytes.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    difference |= (expectedBytes[index] ?? 0) ^ (presentedBytes[index] ?? 0);
  }
  return difference === 0;
}

function randomId(): string {
  return globalThis.crypto.randomUUID();
}

function generationNumber(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return 0;
}

function isExpired(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt).getTime();
  return Number.isNaN(expiry) || expiry <= now.getTime();
}

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value).filter((entry) => entry[1] !== undefined);
  entries.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toISOString();
  }
  return "";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return [];
}

function asPublicFacts(value: unknown): PublicFact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const fact = publicFactSchema.safeParse(item);
    return fact.success ? [fact.data] : [];
  });
}

function asPublicMedia(value: unknown): PublicMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const media = publicMediaSchema.safeParse(item);
    return media.success ? [media.data] : [];
  });
}

const publicFactSchema = z.object({
  property: z.string(),
  rawValue: z.string(),
  normalizedValue: z.string().nullable(),
  state: z.enum(["known", "unknown"]),
  unknownReason: z.string().nullable(),
  unit: z.string().nullable(),
  standard: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  providerKey: z.string(),
  observedAt: z.string().nullable(),
  retrievedAt: z.string(),
  sourcePolicyId: z.string(),
  factualReviewerRef: z.string(),
  rightsReviewerRef: z.string(),
});

const publicMediaSchema = z.object({
  sourceUrl: z.string(),
  credit: z.string(),
  altText: z.string(),
  sourcePolicyId: z.string(),
  rightsReviewerRef: z.string(),
});

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "database error";
}

function redact(message: string, secrets: string[]): string {
  let redacted = message;
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted.slice(0, 400);
}
