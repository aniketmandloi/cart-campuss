import {
  catalogueAlias,
  catalogueApplicability,
  catalogueBrand,
  catalogueGeneration,
  catalogueMarketVariant,
  catalogueModel,
  catalogueModelYear,
  catalogueSalesMarket,
  catalogueSourcePolicy,
} from "@cart-campuss/db/schema/catalogue";
import {
  publishingImportBatch,
  publishingProjectionGeneration,
  publishingProjectionPointer,
  publishingPublishedAssertion,
  publishingSourcePolicy,
  publishingStagedRecord,
  type PublishingPriceReference,
} from "@cart-campuss/db/schema/publishing";
import { and, eq, getTableColumns, inArray, max, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { normalizeCatalogueQuery } from "./catalogue-name";
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

const FORBIDDEN_IDENTIFIER_MESSAGE =
  "A full VIN, registration number, or private seller contact is not publishable.";

/** Property names that stay forbidden even when a source allowlist names them. */
const FORBIDDEN_PROPERTY_KEYS = new Set([
  "vin",
  "fullvin",
  "vehicleidentificationnumber",
  "vehicleidnumber",
  "registration",
  "registrationnumber",
  "registrationno",
  "regnumber",
  "regno",
  "vehicleregistration",
  "vehicleregistrationnumber",
  "licenseplate",
  "licenceplate",
  "licenseplatenumber",
  "licenceplatenumber",
  "numberplate",
  "platenumber",
  "vrn",
  "phone",
  "phonenumber",
  "mobile",
  "mobilenumber",
  "telephone",
  "tel",
  "email",
  "emailaddress",
  "sellerphone",
  "selleremail",
  "sellercontact",
  "privatecontact",
  "privatephone",
  "privateemail",
  "contactphone",
  "contactemail",
  "contactnumber",
  "whatsapp",
  "whatsappnumber",
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
    | "policy-immutable"
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
  sourceTitle: string | null;
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
  policyReviewerRef: string | null;
  facts: PublicFact[];
  media: PublicMedia[];
  priceReference: PublishingPriceReference | null;
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

const sourceUrlSchema = z.url({ protocol: /^https?$/ });

const sourcedFactSchema = z
  .object({
    property: z.string().trim().min(1),
    rawValue: z.string().min(1),
    normalizedValue: z.string().min(1).nullable(),
    state: z.enum(["known", "unknown"]),
    unknownReason: z.string().min(1).nullable(),
    unit: z.string().min(1).nullable(),
    standard: z.string().min(1).nullable(),
    sourceUrl: sourceUrlSchema.nullable(),
    sourceTitle: z.string().trim().min(1).nullable().default(null),
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
  sourceUrl: sourceUrlSchema,
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
  displayName: z.string().trim().min(1).max(200).optional(),
});

const catalogueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_-]+$/);
const catalogueSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/);
const catalogueNameSchema = z.string().trim().min(1).max(200);

const priceReferenceSchema = z
  .object({
    amountMinor: z.number().int().min(-9_007_199_254_740_991).max(9_007_199_254_740_991),
    currency: z.string().regex(/^[A-Z]{3}$/),
    minorUnitExponent: z.number().int().min(0).max(6),
    basis: z.string().trim().min(1).max(200),
    taxInclusivity: z.enum(["unspecified", "tax-inclusive", "tax-exclusive"]),
    observedOn: z.string().trim().min(1).max(40),
    retrievedOn: z.string().trim().min(1).max(40),
    reviewedOn: z.string().trim().min(1).max(40),
    sourceTitle: z.string().trim().min(1).max(200),
    sourceUrl: sourceUrlSchema.nullable().default(null),
    sourceIdentifier: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .superRefine((price, context) => {
    if (!price.sourceUrl && !price.sourceIdentifier) {
      context.addIssue({ code: "custom", path: ["sourceUrl"] });
    }
  });

const catalogueIdentitySchema = z.object({
  brand: z.object({ id: catalogueIdSchema, name: catalogueNameSchema, slug: catalogueSlugSchema }),
  model: z.object({ id: catalogueIdSchema, name: catalogueNameSchema, slug: catalogueSlugSchema }),
  generation: z.object({
    id: catalogueIdSchema,
    name: catalogueNameSchema,
    slug: catalogueSlugSchema,
  }),
  marketVariant: z.object({ id: catalogueIdSchema, name: catalogueNameSchema }),
  salesMarket: z.object({
    id: catalogueIdSchema,
    name: catalogueNameSchema,
    countryCode: z.string().regex(/^[A-Z]{2}$/),
  }),
  modelYear: z.object({
    id: catalogueIdSchema,
    label: z.string().trim().min(1).max(40),
    convention: z.string().trim().min(1).max(400),
  }),
  aliases: z
    .array(
      z.object({
        kind: z.enum(["brand", "model", "generation", "alias"]),
        name: catalogueNameSchema,
      }),
    )
    .default([]),
  priceReference: priceReferenceSchema.nullable().default(null),
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
  catalogue: catalogueIdentitySchema.optional(),
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

type CurrentAssertion = Pick<
  typeof publishingPublishedAssertion.$inferSelect,
  "id" | "providerKey" | "externalId" | "canonicalSubjectId"
>;

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
  now: () => Date = () => new Date(),
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
      aliases: publishingPublishedAssertion.aliases,
      facts: publishingPublishedAssertion.facts,
      attribution: publishingPublishedAssertion.attribution,
      providerKey: publishingPublishedAssertion.providerKey,
      factualReviewerRef: publishingPublishedAssertion.factualReviewerRef,
      rightsReviewerRef: publishingPublishedAssertion.rightsReviewerRef,
      policyReviewerRef: publishingSourcePolicy.reviewerRef,
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
      publishingSourcePolicy,
      eq(publishingSourcePolicy.id, publishingPublishedAssertion.sourcePolicyId),
    )
    .innerJoin(
      publishingProjectionGeneration,
      eq(publishingProjectionGeneration.id, publishingProjectionPointer.generationId),
    )
    .where(
      and(
        publicPolicyAllows(publishingPublishedAssertion.capturedAt, now()),
        term.length > 0 ? match : undefined,
      ),
    )
    .orderBy(publishingPublishedAssertion.displayName, publishingPublishedAssertion.canonicalSubjectId);

  return rows.filter(publicRecordEligible).map((row) => ({
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
  now: () => Date = () => new Date(),
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
      providerKey: publishingPublishedAssertion.providerKey,
      sourcePolicyId: publishingPublishedAssertion.sourcePolicyId,
      factualReviewerRef: publishingPublishedAssertion.factualReviewerRef,
      rightsReviewerRef: publishingPublishedAssertion.rightsReviewerRef,
      reviewedAt: publishingPublishedAssertion.reviewedAt,
      publishedAt: publishingProjectionGeneration.publishedAt,
      priceReference: publishingPublishedAssertion.priceReference,
      policyReviewerRef: publishingSourcePolicy.reviewerRef,
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
      publishingSourcePolicy,
      eq(publishingSourcePolicy.id, publishingPublishedAssertion.sourcePolicyId),
    )
    .innerJoin(
      publishingProjectionGeneration,
      eq(publishingProjectionGeneration.id, publishingProjectionPointer.generationId),
    )
    .where(
      and(
        eq(publishingProjectionPointer.id, 1),
        publicPolicyAllows(publishingPublishedAssertion.capturedAt, now()),
        eq(publishingPublishedAssertion.canonicalSubjectId, subjectId),
      ),
    )
    .limit(1);

  if (!row || !publicRecordEligible(row)) return null;
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
    policyReviewerRef: row.policyReviewerRef,
    facts: asPublicFacts(row.facts),
    media: asPublicMedia(row.media),
    priceReference: asPublicPrice(row.priceReference),
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

  const replay = await readIdempotentReplay(deps.db, parsed.idempotencyKey, payloadHash);
  if (replay) return replay;

  const stagedVersions = await readStagedVersions(deps.db, parsed);

  if (parsed.records.some((record) =>
    new Date(sourceCapturedAt(record, now.toISOString())).getTime() +
      parsed.sourcePolicy.retentionSeconds * 1000 <= now.getTime(),
  )) {
    throw new PublishingRejected("expired", "The source copy is already beyond its retention deadline.");
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
  if (await storedPolicyDiffers(deps.db, policyId, parsed.sourcePolicy)) {
    throw new PublishingRejected("policy-immutable", "A reviewed source policy cannot be changed.");
  }
  const batchId = randomId();
  const createdAt = now.toISOString();
  const writeTime = publishingWriteTime(deps);
  const statements: BatchItem<"pg">[] = [
    publishingWriteLock(deps.db),
    ...stagedVersions.map((version) => rejectStaleStaging(deps.db, version)),
    insertPolicy(deps.db, parsed, policyId, createdAt),
    rejectPolicyRewrite(deps.db, parsed.sourcePolicy, policyId),
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
    const replaced = new Set(
      publishable.map((record) => sourceKey(parsed.providerKey, record.externalId)),
    );
    statements.push(
      deps.db.insert(publishingProjectionGeneration).values({
        id: generationId,
        generation: nextGeneration,
        publishedAt: createdAt,
        batchId,
      }),
    );
    for (const assertion of current.assertions) {
      if (replaced.has(sourceKey(assertion.providerKey, assertion.externalId))) continue;
      statements.push(
        deps.db.insert(publishingPublishedAssertion).select(
          deps.db
            .select({
              ...getTableColumns(publishingPublishedAssertion),
              id: sql<string>`${randomId()}`.as("id"),
              generationId: sql<string>`${generationId}`.as("generation_id"),
            })
            .from(publishingPublishedAssertion)
            .innerJoin(
              publishingSourcePolicy,
              eq(publishingSourcePolicy.id, publishingPublishedAssertion.sourcePolicyId),
            )
            .where(
              and(
                eq(publishingPublishedAssertion.id, assertion.id),
                publicPolicyAllows(publishingPublishedAssertion.capturedAt, writeTime),
              ),
            ),
        ),
      );
    }
    for (const record of publishable) {
      statements.push(
        deps.db.insert(publishingPublishedAssertion).values({
          ...publicAssertion(record, parsed.sourcePolicy, policyId, generationId, createdAt),
          capturedAt: sql`(select ${publishingStagedRecord.capturedAt}
            from ${publishingStagedRecord}
            where ${publishingStagedRecord.batchId} = ${batchId}
              and ${publishingStagedRecord.providerKey} = ${parsed.providerKey}
              and ${publishingStagedRecord.externalId} = ${record.externalId})`,
        }),
      );
      statements.push(...catalogueIdentityStatements(deps.db, parsed, record, policyId));
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

  statements.push(rejectDueImport(deps.db, batchId, writeTime, status === "published"));
  if (status !== "published") {
    statements.push(deps.db.delete(publishingStagedRecord).where(and(
      eq(publishingStagedRecord.batchId, batchId),
      sql`exists (select 1 from ${publishingSourcePolicy}
        where ${publishingSourcePolicy.id} = ${publishingStagedRecord.sourcePolicyId}
          and ${sourceCopyDue(publishingStagedRecord.capturedAt, writeTime)})`,
    )));
  }

  try {
    await commitNeonHttpBatch(deps.db, statements);
  } catch {
    const raced = await readIdempotentReplay(deps.db, parsed.idempotencyKey, payloadHash);
    if (raced) return raced;
    if (await storedPolicyDiffers(deps.db, policyId, parsed.sourcePolicy)) {
      throw new PublishingRejected("policy-immutable", "A reviewed source policy cannot be changed.");
    }
    throw new PublishingRejected(
      "partial",
      "The publication did not commit, and the previous public projection was left unchanged.",
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

/** Purges source copies across staging and every projection generation; audit metadata stays. */
export async function cleanupPublishingCopies(
  deps: PublishingDeps,
  presentedToken: string | undefined,
): Promise<{ stagedDeleted: number; assertionsDeleted: number }> {
  assertOperatorAuthorized(deps.operatorToken, presentedToken);
  const now = publishingWriteTime(deps);
  try {
    const [, staged, assertions] = await deps.db.batch([
      publishingWriteLock(deps.db),
      deps.db.delete(publishingStagedRecord).where(sql`exists (
        select 1 from ${publishingSourcePolicy}
        where ${publishingSourcePolicy.id} = ${publishingStagedRecord.sourcePolicyId}
          and ${sourceCopyDue(publishingStagedRecord.capturedAt, now)}
      )`).returning({ id: publishingStagedRecord.id }),
      deps.db.delete(publishingPublishedAssertion).where(sql`exists (
        select 1 from ${publishingSourcePolicy}
        where ${publishingSourcePolicy.id} = ${publishingPublishedAssertion.sourcePolicyId}
          and ${sourceCopyDue(publishingPublishedAssertion.capturedAt, now)}
      )`).returning({ id: publishingPublishedAssertion.id }),
    ]);
    return { stagedDeleted: staged.length, assertionsDeleted: assertions.length };
  } catch {
    throw new PublishingRejected("partial", "Source-copy cleanup did not commit. Retry the cleanup command.");
  }
}

// Cleanup and import writes share one transaction-scoped lock, including their final deadline checks.
function publishingWriteLock(db: Database) {
  return db.select({ lock: sql`pg_advisory_xact_lock(1128354388)` })
    .from(sql`(select 1) as publishing_lock`);
}

function publishingWriteTime(deps: PublishingDeps) {
  // Injected test time still advances through a database lock wait; production uses the DB clock.
  return deps.now
    ? sql`cast(${deps.now().toISOString()} as timestamptz) + (clock_timestamp() - transaction_timestamp())`
    : sql`clock_timestamp()`;
}

async function readStagedVersions(db: Database, parsed: OperatorImport) {
  return db.select({
    id: publishingStagedRecord.id,
    contentHash: publishingStagedRecord.contentHash,
    sourcePolicyId: publishingStagedRecord.sourcePolicyId,
    capturedAt: publishingStagedRecord.capturedAt,
    updatedAt: publishingStagedRecord.updatedAt,
  }).from(publishingStagedRecord).where(and(
    eq(publishingStagedRecord.providerKey, parsed.providerKey),
    inArray(publishingStagedRecord.externalId, parsed.records.map((record) => record.externalId)),
  ));
}

function rejectStaleStaging(db: Database, version: Awaited<ReturnType<typeof readStagedVersions>>[number]) {
  return rejectBatchWhen(db, sql`not exists (
    select 1 from ${publishingStagedRecord}
    where ${publishingStagedRecord.id} = ${version.id}
      and ${publishingStagedRecord.contentHash} = ${version.contentHash}
      and ${publishingStagedRecord.sourcePolicyId} = ${version.sourcePolicyId}
      and ${publishingStagedRecord.capturedAt} = cast(${version.capturedAt} as timestamptz)
      and ${publishingStagedRecord.updatedAt} = cast(${version.updatedAt} as timestamptz)
  )`);
}

function rejectDueImport(db: Database, batchId: string, now: SQLWrapper, published: boolean) {
  const due = published ? sourceCopyDue(publishingStagedRecord.capturedAt, now)
    : sql`${publishingStagedRecord.capturedAt} + ${publishingSourcePolicy.retentionSeconds} * interval '1 second' <= ${now}`;
  return rejectBatchWhen(db, sql`exists (
    select 1 from ${publishingStagedRecord}
    inner join ${publishingSourcePolicy}
      on ${publishingSourcePolicy.id} = ${publishingStagedRecord.sourcePolicyId}
    where ${publishingStagedRecord.batchId} = ${batchId} and ${due}
  )`);
}

/** A duplicate audit key aborts the entire batch when a protected check fails. */
function rejectBatchWhen(db: Database, condition: SQLWrapper) {
  return db.insert(publishingImportBatch).select(
    db.select().from(publishingImportBatch).where(sql`${condition}`).limit(1),
  );
}

function sourceCopyDue(capturedAt: SQLWrapper, now: Date | SQLWrapper) {
  const at = now instanceof Date ? sql`cast(${now.toISOString()} as timestamptz)` : now;
  return sql`(
    ${publishingSourcePolicy.suspended}
    or ${publishingSourcePolicy.retentionSeconds} <= 0
    or ${publishingSourcePolicy.permissionExpiresAt} <= ${at}
    or ${capturedAt} + ${publishingSourcePolicy.retentionSeconds} * interval '1 second'
      <= ${at}
  )`;
}

function publicPolicyAllows(capturedAt: SQLWrapper, now: Date | SQLWrapper) {
  return sql`(
    ${publishingSourcePolicy.factPermission} = 'permitted'
    and ${publishingSourcePolicy.reviewerRef} is not null
    and ${publishingSourcePolicy.reviewedAt} is not null
    and not coalesce(${sourceCopyDue(capturedAt, now)}, false)
  )`;
}

/** The visitor catalogue may show a subject only while this projection copy is still permitted. */
export function currentProjectionCovers(subjectId: SQLWrapper, now: Date): SQL {
  return sql`exists (
    select 1
    from ${publishingPublishedAssertion}
    inner join ${publishingProjectionPointer}
      on ${publishingPublishedAssertion.generationId} = ${publishingProjectionPointer.generationId}
      and ${publishingProjectionPointer.id} = 1
    inner join ${publishingSourcePolicy}
      on ${publishingSourcePolicy.id} = ${publishingPublishedAssertion.sourcePolicyId}
    where ${publishingPublishedAssertion.canonicalSubjectId} = ${subjectId}
      and ${publicPolicyAllows(publishingPublishedAssertion.capturedAt, now)}
  )`;
}

/** The oldest source retrieval bounds retention for the entire stored document and its media. */
function sourceCapturedAt(record: ImportRecord, receivedAt: string): string {
  return new Date(Math.min(
    new Date(receivedAt).getTime(),
    ...record.document.facts.map((fact) => new Date(fact.retrievedAt).getTime()),
  )).toISOString();
}

async function readIdempotentReplay(
  db: Database,
  idempotencyKey: string,
  payloadHash: string,
): Promise<OperatorResult | null> {
  const [existing] = await db
    .select({
      payloadHash: publishingImportBatch.payloadHash,
      result: publishingImportBatch.result,
    })
    .from(publishingImportBatch)
    .where(eq(publishingImportBatch.idempotencyKey, idempotencyKey))
    .limit(1);
  if (!existing) return null;
  if (existing.payloadHash !== payloadHash) {
    throw new PublishingRejected(
      "idempotency-conflict",
      "This idempotency key was already used for a different import.",
    );
  }
  const stored = storedResultSchema.parse(existing.result);
  return { ...stored, status: "replayed" };
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
    assertCatalogueContext(value.sourcePolicy, record);
  }
  return value;
}

function assertCatalogueContext(policy: SourcePolicyInput, record: ImportRecord): void {
  const catalogue = record.catalogue;
  if (!catalogue) return;
  if (!policy.displayName) {
    throw new PublishingRejected("validation", "A catalogue record needs a source policy display name.");
  }
  if (!catalogueIdSchema.safeParse(record.document.canonicalSubjectId).success) {
    throw new PublishingRejected("validation", "The canonical subject id is not a catalogue applicability id.");
  }
  if (catalogue.salesMarket.countryCode !== record.document.salesMarket) {
    throw new PublishingRejected("validation", "The catalogue sales market does not match the record.");
  }
  if (record.document.modelYearLabel !== catalogue.modelYear.label) {
    throw new PublishingRejected("validation", "The catalogue model year does not match the record.");
  }
  for (const fact of record.document.facts) {
    if (IDENTITY_FACT_PROPERTIES.has(fact.property)) continue;
    if (!policy.permittedFields.includes(fact.property)) continue;
    if (!fact.sourceTitle) {
      throw new PublishingRejected("validation", "A catalogue fact needs a source title.");
    }
  }
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
  if (!policy.permittedFields.includes("salesMarket")) {
    return { externalId, code: "rights", message: "The sales market is not a permitted field." };
  }
  if (record.catalogue && !policy.permittedFields.includes("modelYearLabel")) {
    return { externalId, code: "rights", message: "The model year is not a permitted field." };
  }
  if (publicationLeaksIdentifier(record, policy)) {
    return { externalId, code: "rights", message: FORBIDDEN_IDENTIFIER_MESSAGE };
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
      id: publishingPublishedAssertion.id,
      providerKey: publishingPublishedAssertion.providerKey,
      externalId: publishingPublishedAssertion.externalId,
      canonicalSubjectId: publishingPublishedAssertion.canonicalSubjectId,
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
    assertions: rows,
  };
}

function insertPolicy(db: Database, parsed: OperatorImport, policyId: string, createdAt: string) {
  const policy = parsed.sourcePolicy;
  return db
    .insert(publishingSourcePolicy)
    .values({
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
    })
    .onConflictDoNothing({ target: publishingSourcePolicy.id });
}

/** A conflicting insert aborts the batch if a concurrent import won with different policy content. */
function rejectPolicyRewrite(db: Database, policy: SourcePolicyInput, policyId: string) {
  return db.insert(publishingSourcePolicy).select(
    db.select().from(publishingSourcePolicy).where(
      and(eq(publishingSourcePolicy.id, policyId), policyDiffers(policy)),
    ),
  );
}

async function storedPolicyDiffers(
  db: Database,
  policyId: string,
  policy: SourcePolicyInput,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: publishingSourcePolicy.id })
    .from(publishingSourcePolicy)
    .where(and(eq(publishingSourcePolicy.id, policyId), policyDiffers(policy)))
    .limit(1);
  return existing !== undefined;
}

function policyDiffers(policy: SourcePolicyInput) {
  const fields = JSON.stringify(policy.permittedFields);
  const geographies = JSON.stringify(policy.permittedGeographies);
  return sql`(
  ${publishingSourcePolicy.providerKey} is distinct from ${policy.providerKey}
  or ${publishingSourcePolicy.factPermission} is distinct from ${policy.factPermission}
  or ${publishingSourcePolicy.imagePermission} is distinct from ${policy.imagePermission}
  or not (
    ${publishingSourcePolicy.permittedFields} @> cast(${fields} as jsonb)
    and cast(${fields} as jsonb) @> ${publishingSourcePolicy.permittedFields}
  )
  or not (
    ${publishingSourcePolicy.permittedGeographies} @> cast(${geographies} as jsonb)
    and cast(${geographies} as jsonb) @> ${publishingSourcePolicy.permittedGeographies}
  )
  or ${publishingSourcePolicy.attribution} is distinct from ${policy.attribution}
  or ${publishingSourcePolicy.retentionSeconds} is distinct from ${policy.retentionSeconds}
  or ${publishingSourcePolicy.derivativeRestriction} is distinct from ${policy.derivativeRestriction}
  or ${publishingSourcePolicy.aggregationRestriction} is distinct from ${policy.aggregationRestriction}
  or ${publishingSourcePolicy.refreshIntervalSeconds} is distinct from ${policy.refreshIntervalSeconds}
  or ${publishingSourcePolicy.permissionExpiresAt} is distinct from cast(${policy.permissionExpiresAt} as timestamptz)
  or ${publishingSourcePolicy.takedownObligation} is distinct from ${policy.takedownObligation}
  or ${publishingSourcePolicy.deletionObligation} is distinct from ${policy.deletionObligation}
  or ${publishingSourcePolicy.contractText} is distinct from ${policy.contractText}
  or ${publishingSourcePolicy.suspended} is distinct from ${policy.suspended}
  or ${publishingSourcePolicy.reviewerRef} is distinct from ${policy.reviewerRef}
  or ${publishingSourcePolicy.reviewedAt} is distinct from cast(${policy.reviewedAt} as timestamptz)
  )`;
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
    capturedAt: sourceCapturedAt(record, updatedAt),
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
        // A change to one component cannot renew unchanged facts, media, or private payload.
        capturedAt: sql`least(${publishingStagedRecord.capturedAt}, cast(${values.capturedAt} as timestamptz))`,
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
    .filter((fact) => !factLeaksIdentifier(fact))
    .map((fact) => ({
      property: fact.property,
      rawValue: fact.rawValue,
      normalizedValue: fact.normalizedValue,
      state: fact.state,
      unknownReason: fact.unknownReason,
      unit: fact.unit,
      standard: fact.standard,
      sourceUrl: fact.sourceUrl,
      sourceTitle: fact.sourceTitle,
      providerKey: fact.providerKey,
      observedAt: fact.observedAt,
      retrievedAt: fact.retrievedAt,
      sourcePolicyId: policyId,
      factualReviewerRef,
      rightsReviewerRef,
    }));
  const media =
    policy.imagePermission === "permitted"
      ? record.document.media
          .filter((item) => !textLeaksIdentifier([item.sourceUrl, item.altText, item.credit]))
          .map((item) => ({
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
    salesMarket: policy.permittedFields.includes("salesMarket") ? record.document.salesMarket : "",
    modelYearLabel: policy.permittedFields.includes("modelYearLabel") ? record.document.modelYearLabel : null,
    facts,
    media,
    attribution: policy.attribution,
    sourcePolicyId: policyId,
    factualReviewerRef,
    rightsReviewerRef,
    observedAt,
    reviewedAt,
    priceReference: record.catalogue?.priceReference ?? null,
  };
}

function catalogueIdentityStatements(
  db: Database,
  parsed: OperatorImport,
  record: ImportRecord,
  policyId: string,
): BatchItem<"pg">[] {
  const catalogue = record.catalogue;
  const displayName = parsed.sourcePolicy.displayName;
  if (!catalogue || !displayName) return [];
  const subjectId = record.document.canonicalSubjectId;
  const statements: BatchItem<"pg">[] = [
    db
      .insert(catalogueSalesMarket)
      .values({
        id: catalogue.salesMarket.id,
        name: catalogue.salesMarket.name,
        countryCode: catalogue.salesMarket.countryCode,
      })
      .onConflictDoNothing({ target: catalogueSalesMarket.id }),
    db.insert(catalogueSalesMarket).select(
      db
        .select()
        .from(catalogueSalesMarket)
        .where(
          and(
            eq(catalogueSalesMarket.id, catalogue.salesMarket.id),
            sql`${catalogueSalesMarket.name} is distinct from ${catalogue.salesMarket.name}
              or ${catalogueSalesMarket.countryCode} is distinct from ${catalogue.salesMarket.countryCode}`,
          ),
        )
        .limit(1),
    ),
    db
      .insert(catalogueBrand)
      .values({ id: catalogue.brand.id, name: catalogue.brand.name, slug: catalogue.brand.slug })
      .onConflictDoNothing({ target: catalogueBrand.id }),
    db.insert(catalogueBrand).select(
      db
        .select()
        .from(catalogueBrand)
        .where(
          and(
            eq(catalogueBrand.id, catalogue.brand.id),
            sql`${catalogueBrand.name} is distinct from ${catalogue.brand.name}
              or ${catalogueBrand.slug} is distinct from ${catalogue.brand.slug}`,
          ),
        )
        .limit(1),
    ),
    db
      .insert(catalogueModel)
      .values({
        id: catalogue.model.id,
        brandId: catalogue.brand.id,
        name: catalogue.model.name,
        slug: catalogue.model.slug,
      })
      .onConflictDoNothing({ target: catalogueModel.id }),
    db.insert(catalogueModel).select(
      db
        .select()
        .from(catalogueModel)
        .where(
          and(
            eq(catalogueModel.id, catalogue.model.id),
            sql`${catalogueModel.brandId} is distinct from ${catalogue.brand.id}
              or ${catalogueModel.name} is distinct from ${catalogue.model.name}
              or ${catalogueModel.slug} is distinct from ${catalogue.model.slug}`,
          ),
        )
        .limit(1),
    ),
    db
      .insert(catalogueGeneration)
      .values({
        id: catalogue.generation.id,
        modelId: catalogue.model.id,
        name: catalogue.generation.name,
        slug: catalogue.generation.slug,
      })
      .onConflictDoNothing({ target: catalogueGeneration.id }),
    db.insert(catalogueGeneration).select(
      db
        .select()
        .from(catalogueGeneration)
        .where(
          and(
            eq(catalogueGeneration.id, catalogue.generation.id),
            sql`${catalogueGeneration.modelId} is distinct from ${catalogue.model.id}
              or ${catalogueGeneration.name} is distinct from ${catalogue.generation.name}
              or ${catalogueGeneration.slug} is distinct from ${catalogue.generation.slug}`,
          ),
        )
        .limit(1),
    ),
    db
      .insert(catalogueModelYear)
      .values({
        id: catalogue.modelYear.id,
        label: catalogue.modelYear.label,
        convention: catalogue.modelYear.convention,
      })
      .onConflictDoNothing({ target: catalogueModelYear.id }),
    db.insert(catalogueModelYear).select(
      db
        .select()
        .from(catalogueModelYear)
        .where(
          and(
            eq(catalogueModelYear.id, catalogue.modelYear.id),
            sql`${catalogueModelYear.label} is distinct from ${catalogue.modelYear.label}
              or ${catalogueModelYear.convention} is distinct from ${catalogue.modelYear.convention}`,
          ),
        )
        .limit(1),
    ),
    db
      .insert(catalogueMarketVariant)
      .values({
        id: catalogue.marketVariant.id,
        generationId: catalogue.generation.id,
        salesMarketId: catalogue.salesMarket.id,
        name: catalogue.marketVariant.name,
      })
      .onConflictDoNothing({ target: catalogueMarketVariant.id }),
    db.insert(catalogueMarketVariant).select(
      db
        .select()
        .from(catalogueMarketVariant)
        .where(
          and(
            eq(catalogueMarketVariant.id, catalogue.marketVariant.id),
            sql`${catalogueMarketVariant.generationId} is distinct from ${catalogue.generation.id}
              or ${catalogueMarketVariant.salesMarketId} is distinct from ${catalogue.salesMarket.id}
              or ${catalogueMarketVariant.name} is distinct from ${catalogue.marketVariant.name}`,
          ),
        )
        .limit(1),
    ),
    db
      .insert(catalogueSourcePolicy)
      .values({
        id: policyId,
        name: displayName,
        audience: "public",
        permitsPublicCatalogue: true,
        rightsReview: "reviewed",
        attribution: parsed.sourcePolicy.attribution,
        internalNote: "",
      })
      .onConflictDoNothing({ target: catalogueSourcePolicy.id }),
    db.insert(catalogueSourcePolicy).select(
      db
        .select()
        .from(catalogueSourcePolicy)
        .where(
          and(
            eq(catalogueSourcePolicy.id, policyId),
            sql`${catalogueSourcePolicy.name} is distinct from ${displayName}
              or ${catalogueSourcePolicy.audience} is distinct from 'public'
              or ${catalogueSourcePolicy.permitsPublicCatalogue} is distinct from true
              or ${catalogueSourcePolicy.rightsReview} is distinct from 'reviewed'
              or ${catalogueSourcePolicy.attribution} is distinct from ${parsed.sourcePolicy.attribution}
              or ${catalogueSourcePolicy.internalNote} is distinct from ''`,
          ),
        )
        .limit(1),
    ),
    db
      .insert(catalogueApplicability)
      .values({
        id: subjectId,
        marketVariantId: catalogue.marketVariant.id,
        modelYearId: catalogue.modelYear.id,
        salesMarketId: catalogue.salesMarket.id,
        sourcePolicyId: policyId,
        publicationStatus: "published",
        synthetic: false,
      })
      .onConflictDoNothing({ target: catalogueApplicability.id }),
    db.insert(catalogueApplicability).select(
      db
        .select()
        .from(catalogueApplicability)
        .where(
          and(
            eq(catalogueApplicability.id, subjectId),
            sql`${catalogueApplicability.marketVariantId} is distinct from ${catalogue.marketVariant.id}
              or ${catalogueApplicability.modelYearId} is distinct from ${catalogue.modelYear.id}
              or ${catalogueApplicability.salesMarketId} is distinct from ${catalogue.salesMarket.id}
              or ${catalogueApplicability.sourcePolicyId} is distinct from ${policyId}
              or ${catalogueApplicability.publicationStatus} is distinct from 'published'
              or ${catalogueApplicability.synthetic} is distinct from false`,
          ),
        )
        .limit(1),
    ),
  ];
  const seen = new Set<string>();
  const aliasRows = [
    { kind: "brand" as const, name: catalogue.brand.name },
    { kind: "model" as const, name: catalogue.model.name },
    { kind: "generation" as const, name: catalogue.generation.name },
    ...(parsed.sourcePolicy.permittedFields.includes("alias") ? catalogue.aliases : []),
  ];
  for (const alias of aliasRows) {
    const normalized = normalizeCatalogueQuery(alias.name);
    const key = `${alias.kind}\0${normalized}`;
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    statements.push(
      db
        .insert(catalogueAlias)
        .values({
          id: randomId(),
          applicabilityId: subjectId,
          kind: alias.kind,
          normalizedName: normalized,
        })
        .onConflictDoNothing({
          target: [catalogueAlias.applicabilityId, catalogueAlias.kind, catalogueAlias.normalizedName],
        }),
    );
  }
  return statements;
}

function asPublicPrice(value: unknown): PublishingPriceReference | null {
  const parsed = priceReferenceSchema.safeParse(value);
  if (!parsed.success) return null;
  if (
    textLeaksIdentifier([
      parsed.data.sourceTitle,
      parsed.data.sourceUrl ?? "",
      parsed.data.sourceIdentifier ?? "",
      parsed.data.basis,
      parsed.data.currency,
      parsed.data.observedOn,
      parsed.data.retrievedOn,
      parsed.data.reviewedOn,
    ])
  ) {
    return null;
  }
  return parsed.data;
}

function sourceKey(providerKey: string, externalId: string): string {
  return `${providerKey}\0${externalId}`;
}

function publicationLeaksIdentifier(record: ImportRecord, policy: SourcePolicyInput): boolean {
  if (policy.permittedFields.some((field) => forbiddenProperty(field))) return true;
  if (record.document.facts.some((fact) => factLeaksIdentifier(fact))) return true;
  if (
    record.document.media.some((item) => textLeaksIdentifier([item.sourceUrl, item.altText, item.credit]))
  ) {
    return true;
  }
  return textLeaksIdentifier([
    record.document.canonicalSubjectId,
    record.document.displayName,
    record.document.salesMarket,
    record.document.modelYearLabel ?? "",
    policy.attribution,
    policy.displayName ?? "",
    policy.providerKey,
    policy.reviewerRef ?? "",
    record.factualReview.reviewerRef ?? "",
    record.rightsReview.reviewerRef ?? "",
    ...record.document.aliases,
    ...catalogueIdentityText(record),
  ]);
}

function catalogueIdentityText(record: ImportRecord): string[] {
  const catalogue = record.catalogue;
  if (!catalogue) return [];
  const price = catalogue.priceReference;
  return [
    catalogue.brand.id,
    catalogue.brand.name,
    catalogue.brand.slug,
    catalogue.model.id,
    catalogue.model.name,
    catalogue.model.slug,
    catalogue.generation.id,
    catalogue.generation.name,
    catalogue.generation.slug,
    catalogue.marketVariant.id,
    catalogue.marketVariant.name,
    catalogue.salesMarket.id,
    catalogue.salesMarket.name,
    catalogue.salesMarket.countryCode,
    catalogue.modelYear.id,
    catalogue.modelYear.label,
    catalogue.modelYear.convention,
    ...catalogue.aliases.flatMap((alias) => [alias.kind, alias.name]),
    price?.basis ?? "",
    price?.currency ?? "",
    price?.sourceTitle ?? "",
    price?.sourceUrl ?? "",
    price?.sourceIdentifier ?? "",
    price?.observedOn ?? "",
    price?.retrievedOn ?? "",
    price?.reviewedOn ?? "",
  ];
}

function factLeaksIdentifier(fact: {
  property: string;
  rawValue: string;
  normalizedValue?: string | null;
  unknownReason?: string | null;
  unit?: string | null;
  standard?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
}): boolean {
  return (
    forbiddenProperty(fact.property) ||
    textLeaksIdentifier([
      fact.property,
      fact.rawValue,
      fact.normalizedValue ?? "",
      fact.unknownReason ?? "",
      fact.unit ?? "",
      fact.standard ?? "",
      fact.sourceUrl ?? "",
      fact.sourceTitle ?? "",
    ])
  );
}

export function publicMetadataEligible(values: string[]): boolean {
  return !textLeaksIdentifier(values);
}

function textLeaksIdentifier(values: string[]): boolean {
  return values.some((value) => {
    if (containsForbiddenIdentifier(value) || containsForbiddenQuery(value)) return true;
    try {
      const decoded = decodeURIComponent(value.replaceAll("+", " "));
      return containsForbiddenIdentifier(decoded) || containsForbiddenQuery(decoded);
    } catch {
      // Malformed escapes must not bypass the independently decoded URL query checks above.
      return false;
    }
  });
}

function containsForbiddenQuery(value: string): boolean {
  for (const match of value.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      return true;
    }
    for (const [key, entry] of url.searchParams) {
      if (forbiddenProperty(key) && entry.trim().length > 0) return true;
    }
  }
  return false;
}

function forbiddenProperty(value: string): boolean {
  return FORBIDDEN_PROPERTY_KEYS.has(normalizePropertyKey(value));
}

function normalizePropertyKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const EMAIL_ADDRESS = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const INTERNATIONAL_PHONE = /(?:^|[^a-z0-9])\+\d(?:[\s().-]*\d){9,14}(?=$|[^0-9])/i;
// Grouping or contact context distinguishes domestic contacts from numeric specifications.
const DOMESTIC_PHONE = /(?:^|[^a-z0-9])(?:0[ .-]?)?[6-9]\d{4}[ .-]\d{5}(?=$|[^a-z0-9])/i;
const CONTACT_PHONE = /(?:^|[^a-z0-9])(?:call|phone|mobile|telephone|contact|whatsapp|seller\s+(?:on|at))\b(?:[^0-9]{0,40})\b0?\d(?:[\s().-]*\d){6,14}(?=$|[^0-9])/i;
const TEL_URI = /(?:^|[^a-z0-9])tel:\+?\d{8,15}/i;
const WHATSAPP_URI = /(?:^|[^a-z0-9])wa\.me\/\d{8,15}/i;
const VIN_TOKEN = /(?:^|[^a-z0-9])[a-hj-npr-z0-9]{17}(?=$|[^a-z0-9])/i;
const INDIAN_REGISTRATION = /(?:^|[^a-z0-9])[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{1,3}[ -]?\d{4}(?=$|[^a-z0-9])/i;
// The UK area and age code is one token; joining spec tokens misreads "PS 77 kWh" as a plate.
const UK_REGISTRATION = /(?:^|[^a-z0-9])[A-HJ-PR-Y]{2}\d{2}[ -]?[A-HJ-PR-Z]{3}(?=$|[^a-z0-9])/i;

function containsForbiddenIdentifier(value: string): boolean {
  return (
    EMAIL_ADDRESS.test(value) ||
    INTERNATIONAL_PHONE.test(value) ||
    DOMESTIC_PHONE.test(value) ||
    CONTACT_PHONE.test(value) ||
    TEL_URI.test(value) ||
    WHATSAPP_URI.test(value) ||
    VIN_TOKEN.test(value) ||
    containsRegistrationNumber(value)
  );
}

function containsRegistrationNumber(value: string): boolean {
  return INDIAN_REGISTRATION.test(value) || UK_REGISTRATION.test(value);
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
    return fact.success && !IDENTITY_FACT_PROPERTIES.has(fact.data.property) && !factLeaksIdentifier(fact.data)
      ? [{ ...fact.data, sourceTitle: fact.data.sourceTitle ?? null }] : [];
  });
}

function publicRecordEligible(row: Pick<
  typeof publishingPublishedAssertion.$inferSelect,
  "canonicalSubjectId" | "displayName" | "aliases" | "salesMarket" | "modelYearLabel" |
  "attribution" | "providerKey" | "factualReviewerRef" | "rightsReviewerRef" | "facts"
> & { policyReviewerRef: string | null }): boolean {
  return asPublicFacts(row.facts).length > 0 && !textLeaksIdentifier([
    row.canonicalSubjectId,
    row.displayName,
    ...asStringArray(row.aliases),
    row.salesMarket,
    row.modelYearLabel ?? "",
    row.attribution,
    row.providerKey,
    row.factualReviewerRef,
    row.rightsReviewerRef,
    row.policyReviewerRef ?? "",
  ]);
}

function asPublicMedia(value: unknown): PublicMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const media = publicMediaSchema.safeParse(item);
    return media.success && !textLeaksIdentifier([media.data.sourceUrl, media.data.altText, media.data.credit])
      ? [media.data] : [];
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
      sourceUrl: sourceUrlSchema.nullable(),
      sourceTitle: z.string().nullable().optional(),
      providerKey: z.string(),
  observedAt: z.string().nullable(),
  retrievedAt: z.string(),
  sourcePolicyId: z.string(),
  factualReviewerRef: z.string(),
  rightsReviewerRef: z.string(),
});

const publicMediaSchema = z.object({
  sourceUrl: sourceUrlSchema,
  credit: z.string(),
  altText: z.string(),
  sourcePolicyId: z.string(),
  rightsReviewerRef: z.string(),
});
