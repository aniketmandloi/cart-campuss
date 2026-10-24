import {
  catalogueAlias,
  catalogueApplicability,
  catalogueGenerationAlias,
  catalogueModelAlias,
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
  type PublishingProductionClaim,
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
  "brand",
  "brandName",
  "model",
  "modelName",
  "generation",
  "generationName",
  "marketVariant",
  "variantName",
  "salesMarketName",
  "modelYear",
  "modelYearConvention",
]);

export const CATALOGUE_IDENTITY_FIELDS = ["brand", "model", "generation", "marketVariant", "salesMarket", "modelYearLabel"];

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

export type PublicFactConflict = {
  rawValue: string;
  normalizedValue: string | null;
  unit: string | null;
  standard: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  observedAt: string | null;
  retrievedAt: string;
  factualReviewerRef: string;
  rightsReviewerRef: string;
};

export type PublicFact = {
  property: string;
  rawValue: string;
  normalizedValue: string | null;
  state: "known" | "unknown" | "not-applicable" | "withheld";
  unknownReason: string | null;
  unit: string | null;
  standard: string | null;
  freshness: "current" | "stale" | "not-checked";
  curatedReason: string | null;
  conflict: PublicFactConflict | null;
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
  retrievedAt: string | null;
  countryCode: string | null;
  attribution: string | null;
};

export type PublicProductionClaim = PublishingProductionClaim;

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
  policyName: string | null;
  permittedFields: string[];
  facts: PublicFact[];
  media: PublicMedia[];
  productionClaims: PublicProductionClaim[];
  priceReference: PublishingPriceReference | null;
  identityScope: "applicability" | "generation" | "model";
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

const factConflictSchema = z.object({
  rawValue: z.string().min(1),
  normalizedValue: z.string().min(1).nullable(),
  unit: z.string().min(1).nullable(),
  standard: z.string().min(1).nullable(),
  sourceUrl: sourceUrlSchema.nullable(),
  sourceTitle: z.string().trim().min(1).nullable(),
  observedAt: z.iso.datetime().nullable(),
  retrievedAt: z.iso.datetime(),
  factualReviewerRef: z.string().trim().min(1),
  rightsReviewerRef: z.string().trim().min(1),
});

const sourcedFactSchema = z
  .object({
    property: z.string().trim().min(1),
    rawValue: z.string(),
    normalizedValue: z.string().min(1).nullable(),
    state: z.enum(["known", "unknown", "not-applicable", "withheld"]),
    unknownReason: z.string().min(1).nullable(),
    unit: z.string().min(1).nullable(),
    standard: z.string().min(1).nullable(),
    freshness: z.enum(["current", "stale", "not-checked"]).default("current"),
    curatedReason: z.string().trim().min(1).nullable().default(null),
    conflict: factConflictSchema.nullable().default(null),
    sourceUrl: sourceUrlSchema.nullable(),
    sourceTitle: z.string().trim().min(1).nullable().default(null),
    providerKey: z.string().trim().min(1),
    observedAt: z.iso.datetime().nullable(),
    retrievedAt: z.iso.datetime(),
  })
  .superRefine((fact, ctx) => {
    if (fact.state === "known" && fact.rawValue.trim().length === 0) {
      ctx.addIssue({ code: "custom", path: ["rawValue"] });
    }
    if (fact.state === "known" && fact.unknownReason) {
      ctx.addIssue({ code: "custom", path: ["unknownReason"] });
    }
    if (fact.state !== "known" && !fact.unknownReason) {
      ctx.addIssue({ code: "custom", path: ["unknownReason"] });
    }
    if ((fact.state === "not-applicable" || fact.state === "withheld") && fact.conflict) {
      ctx.addIssue({ code: "custom", path: ["conflict"] });
    }
    if (fact.conflict && !fact.curatedReason) {
      ctx.addIssue({ code: "custom", path: ["curatedReason"] });
    }
  });

const mediaSchema = z.object({
  sourceUrl: sourceUrlSchema,
  credit: z.string().trim().min(1),
  altText: z.string().trim().min(1),
  sourcePolicyId: z.uuid().optional(),
  retrievedAt: z.iso.datetime().optional(),
  countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
});

const productionClaimSchema = z
  .object({
    scope: z.string().trim().min(1).max(200),
    geography: z.string().trim().min(1).max(200),
    period: z.string().trim().min(1).max(200),
    count: z.number().int().nonnegative(),
    status: z.enum(["planned", "completed"]),
    counted: z.string().trim().min(1).max(200),
    sourceTitle: z.string().trim().min(1).max(200),
    sourceUrl: sourceUrlSchema.nullable().default(null),
    observedAt: z.iso.datetime().nullable().default(null),
    retrievedAt: z.iso.datetime(),
    reviewedOn: z.string().trim().min(1).max(40),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    sourcePolicyId: z.uuid().optional(),
  })
  .superRefine((claim, ctx) => {
    if (/(sale|registration|export)/i.test(claim.counted)) {
      ctx.addIssue({ code: "custom", path: ["counted"] });
    }
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

const componentPolicySchema = sourcePolicySchema.extend({
  id: z.uuid(),
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
    retrievedOn: z.union([z.iso.date(), z.iso.datetime()]),
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

const generationCatalogueSchema = z
  .object({
    brand: z.object({ id: catalogueIdSchema, name: catalogueNameSchema, slug: catalogueSlugSchema }),
    model: z.object({ id: catalogueIdSchema, name: catalogueNameSchema, slug: catalogueSlugSchema }),
    generation: z.object({
      id: catalogueIdSchema,
      name: catalogueNameSchema,
      slug: catalogueSlugSchema,
    }),
    aliases: z
      .array(
        z.object({
          kind: z.enum(["brand", "model", "generation", "alias"]),
          name: catalogueNameSchema,
        }),
      )
      .default([]),
  })
  .strict();

const modelCatalogueSchema = z
  .object({
    brand: z.object({ id: catalogueIdSchema, name: catalogueNameSchema, slug: catalogueSlugSchema }),
    model: z.object({ id: catalogueIdSchema, name: catalogueNameSchema, slug: catalogueSlugSchema }),
    aliases: z
      .array(
        z.object({
          kind: z.enum(["brand", "model", "alias"]),
          name: catalogueNameSchema,
        }),
      )
      .default([]),
  })
  .strict();

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
    productionClaims: z.array(productionClaimSchema).default([]),
  }),
  catalogue: catalogueIdentitySchema.optional(),
  generationCatalogue: generationCatalogueSchema.optional(),
  modelCatalogue: modelCatalogueSchema.optional(),
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
  componentPolicies: z.array(componentPolicySchema).default([]),
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
    or (${publishingSourcePolicy.permittedFields} @> '["alias"]'::jsonb and exists (
      select 1 from jsonb_array_elements_text(${publishingPublishedAssertion.aliases}) as alias(value)
      where alias.value ilike ${pattern} escape '\\'
    ))
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
      permittedFields: publishingSourcePolicy.permittedFields,
      policyName: catalogueSourcePolicy.name,
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
    .leftJoin(catalogueSourcePolicy, eq(catalogueSourcePolicy.id, publishingPublishedAssertion.sourcePolicyId))
    .where(
      and(
        publicPolicyAllows(assertionCapturedAt(), now()),
        term.length > 0 ? match : undefined,
      ),
    )
    .orderBy(publishingPublishedAssertion.displayName, publishingPublishedAssertion.canonicalSubjectId);

  return rows.filter(publicRecordEligible).map((row) => ({
    canonicalSubjectId: row.canonicalSubjectId,
    displayName: row.displayName,
    salesMarket: row.salesMarket,
    modelYearLabel: row.permittedFields.includes("modelYearLabel") ? row.modelYearLabel : null,
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
      productionClaims: publishingPublishedAssertion.productionClaims,
      attribution: publishingPublishedAssertion.attribution,
      providerKey: publishingPublishedAssertion.providerKey,
      sourcePolicyId: publishingPublishedAssertion.sourcePolicyId,
      factualReviewerRef: publishingPublishedAssertion.factualReviewerRef,
      rightsReviewerRef: publishingPublishedAssertion.rightsReviewerRef,
      reviewedAt: publishingPublishedAssertion.reviewedAt,
      publishedAt: publishingProjectionGeneration.publishedAt,
      priceReference: publishingPublishedAssertion.priceReference,
      identityScope: publishingPublishedAssertion.identityScope,
      effectiveCapturedAt: sql<string>`least(${publishingPublishedAssertion.capturedAt}, publishing_price_captured_at(${publishingPublishedAssertion.priceReference}))`,
      imagePermission: publishingSourcePolicy.imagePermission,
      factPermission: publishingSourcePolicy.factPermission,
      policySuspended: publishingSourcePolicy.suspended,
      policyReviewedAt: publishingSourcePolicy.reviewedAt,
      permissionExpiresAt: publishingSourcePolicy.permissionExpiresAt,
      retentionSeconds: publishingSourcePolicy.retentionSeconds,
      permittedGeographies: publishingSourcePolicy.permittedGeographies,
      permittedFields: publishingSourcePolicy.permittedFields,
      policyName: catalogueSourcePolicy.name,
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
    .leftJoin(catalogueSourcePolicy, eq(catalogueSourcePolicy.id, publishingPublishedAssertion.sourcePolicyId))
    .where(
      and(
        eq(publishingProjectionPointer.id, 1),
        publicPolicyAllows(assertionCapturedAt(), now()),
        eq(publishingPublishedAssertion.canonicalSubjectId, subjectId),
      ),
    )
    .limit(1);

  if (!row || !publicRecordEligible(row)) return null;
  const clock = now();
  const assertionPolicy = {
    suspended: row.policySuspended,
    reviewerRef: row.policyReviewerRef,
    reviewedAt: row.policyReviewedAt,
    permissionExpiresAt: row.permissionExpiresAt,
    retentionSeconds: row.retentionSeconds,
    permittedGeographies: row.permittedGeographies,
    permittedFields: row.permittedFields,
    imagePermission: row.imagePermission,
    factPermission: row.factPermission,
    attribution: row.attribution,
  };
  const parsedMedia = asPublicMedia(row.media);
  const parsedClaims = asPublicProductionClaims(row.productionClaims);
  const effectiveCapturedAt = toIso(row.effectiveCapturedAt);
  const extraIds = [
    ...new Set(
      [...parsedMedia, ...parsedClaims]
        .map((item) => item.sourcePolicyId)
        .filter((id) => id !== row.sourcePolicyId),
    ),
  ];
  const extraPolicies = await readComponentPolicies(db, extraIds);
  const policyFor = (id: string) => (id === row.sourcePolicyId ? assertionPolicy : extraPolicies.get(id));
  const media = parsedMedia.flatMap((item) => {
    const policy = policyFor(item.sourcePolicyId);
    const separate = item.sourcePolicyId !== row.sourcePolicyId;
    const inheritedCapture = item.retrievedAt ?? effectiveCapturedAt;
    const retrievedAt = separate ? inheritedCapture : earlierIso(inheritedCapture, effectiveCapturedAt);
    const countryCode = item.countryCode ?? row.salesMarket;
    if (!componentPolicyAllows(policy, { retrievedAt, countryCode }, "image", clock)) return [];
    return [
      {
        ...item,
        attribution: policy?.attribution ?? item.attribution,
      },
    ];
  });
  const productionClaims = parsedClaims.filter((claim) => {
    const separate = claim.sourcePolicyId !== row.sourcePolicyId;
    const retrievedAt = separate ? claim.retrievedAt : earlierIso(claim.retrievedAt, effectiveCapturedAt);
    return componentPolicyAllows(
      policyFor(claim.sourcePolicyId),
      { retrievedAt, countryCode: claim.countryCode },
      "fact",
      clock,
    );
  });
  return {
    canonicalSubjectId: row.canonicalSubjectId,
    displayName: row.displayName,
    aliases: row.permittedFields.includes("alias") ? asStringArray(row.aliases) : [],
    salesMarket: row.salesMarket,
    modelYearLabel: row.permittedFields.includes("modelYearLabel") ? row.modelYearLabel : null,
    publishedAt: toIso(row.publishedAt),
    attribution: row.attribution,
    sourcePolicyId: row.sourcePolicyId,
    factualReviewerRef: row.factualReviewerRef,
    rightsReviewerRef: row.rightsReviewerRef,
    reviewedAt: toIso(row.reviewedAt),
    policyReviewerRef: row.policyReviewerRef,
    policyName: row.policyName,
    permittedFields: row.permittedFields,
    facts: permittedPublicFacts(row.facts, row.permittedFields),
    media,
    productionClaims,
    priceReference: row.permittedFields.includes("priceReference") ? asPublicPrice(row.priceReference) : null,
    identityScope: row.identityScope === "generation" || row.identityScope === "model" ? row.identityScope : "applicability",
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
  assertComponentRetention(parsed, now);

  const current = await readCurrentProjection(deps.db);
  const contexts = await canonicalContexts(deps.db, parsed.records.map((record) => record.document.canonicalSubjectId));
  const failures = parsed.publish ? collectFailures(parsed, current, contexts, now) : [];
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
  for (const policy of parsed.componentPolicies) {
    if (await storedPolicyDiffers(deps.db, policy.id, policy)) {
      throw new PublishingRejected("policy-immutable", "A reviewed source policy cannot be changed.");
    }
  }
  const batchId = randomId();
  const createdAt = now.toISOString();
  const writeTime = publishingWriteTime(deps);
  const statements: BatchItem<"pg">[] = [
    publishingWriteLock(deps.db),
    ...stagedVersions.map((version) => rejectStaleStaging(deps.db, version)),
    insertPolicy(deps.db, parsed.sourcePolicy, policyId, createdAt),
    rejectPolicyRewrite(deps.db, parsed.sourcePolicy, policyId),
    ...parsed.componentPolicies.flatMap((policy) => [
      insertPolicy(deps.db, policy, policy.id, createdAt),
      rejectPolicyRewrite(deps.db, policy, policy.id),
    ]),
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
      const carried = deps.db.insert(publishingPublishedAssertion).select(
          deps.db
            .select({
              ...getTableColumns(publishingPublishedAssertion),
              id: sql<string>`${randomId()}`.as("id"),
              generationId: sql<string>`${generationId}`.as("generation_id"),
              media: retainedComponentArray(
                publishingPublishedAssertion.media,
                assertionCapturedAt(),
                publishingPublishedAssertion.sourcePolicyId,
                writeTime,
              ).as("media"),
              productionClaims: retainedComponentArray(
                publishingPublishedAssertion.productionClaims,
                assertionCapturedAt(),
                publishingPublishedAssertion.sourcePolicyId,
                writeTime,
              ).as("production_claims"),
            })
            .from(publishingPublishedAssertion)
            .innerJoin(
              publishingSourcePolicy,
              eq(publishingSourcePolicy.id, publishingPublishedAssertion.sourcePolicyId),
            )
            .where(
              and(
                eq(publishingPublishedAssertion.id, assertion.id),
                publicPolicyAllows(assertionCapturedAt(), writeTime),
              ),
            ),
        );
      statements.push(carried);
    }
    for (const record of publishable) {
      const subjectId = record.document.canonicalSubjectId;
      const context = contexts.find((item) => item.id === subjectId);
      const actual = canonicalContexts(deps.db, [subjectId]).as("canonical_context");
      statements.push(rejectBatchWhen(deps.db, sql`(select ${actual.signature} from ${actual})
        is distinct from ${context ? sql`cast(${JSON.stringify(context.signature)} as jsonb)` : sql`null`}`));
      const published = publicAssertion(
        record,
        parsed.sourcePolicy,
        policyId,
        generationId,
        createdAt,
        parsed.componentPolicies,
        now,
      );
      statements.push(
        deps.db.insert(publishingPublishedAssertion).values({
          ...published,
          media: stagedComponentTimestamps(published.media, "media", parsed.providerKey, record.externalId, batchId),
          productionClaims: stagedComponentTimestamps(
            published.productionClaims,
            "productionClaims",
            parsed.providerKey,
            record.externalId,
            batchId,
          ),
          capturedAt: sql`(select ${publishingStagedRecord.capturedAt}
            from ${publishingStagedRecord}
            where ${publishingStagedRecord.batchId} = ${batchId}
              and ${publishingStagedRecord.providerKey} = ${parsed.providerKey}
              and ${publishingStagedRecord.externalId} = ${record.externalId})`,
        }),
      );
      statements.push(...catalogueIdentityStatements(deps.db, parsed, record, policyId));
      if (!record.catalogue && context) {
        statements.push(...cataloguePolicyStatements(deps.db, parsed.sourcePolicy, policyId));
        statements.push(...catalogueAliasStatements(deps.db, subjectId, parsed.sourcePolicy.permittedFields.includes("alias")
          ? record.document.aliases.map((name) => ({ kind: "alias", name })) : []));
        statements.push(deps.db.update(catalogueApplicability).set({ sourcePolicyId: policyId })
          .where(eq(catalogueApplicability.id, subjectId)));
      }
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
  // Retention expiry rolls back staged, held, and published writes. Suspension or
  // permission expiry keeps the staged or held result, then drops that copy. A due
  // image or production policy does the same, including a component that field or
  // geography rights omitted from the stored document.
  statements.push(rejectExpiredComponentRetention(deps.db, batchId, writeTime));
  if (status === "published") statements.push(rejectDueComponents(deps.db, batchId, writeTime));
  if (status !== "published") {
    statements.push(deps.db.delete(publishingStagedRecord).where(and(
      eq(publishingStagedRecord.batchId, batchId),
      nonpublishedStagedCopyDue(parsed, writeTime),
    )));
  }

  try {
    await commitNeonHttpBatch(deps.db, statements);
  } catch {
    const raced = await readIdempotentReplay(deps.db, parsed.idempotencyKey, payloadHash);
    if (raced) return raced;
    if (
      await storedPolicyDiffers(deps.db, policyId, parsed.sourcePolicy) ||
      (await Promise.all(parsed.componentPolicies.map((policy) => storedPolicyDiffers(deps.db, policy.id, policy)))).some(Boolean)
    ) {
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
      deps.db.delete(publishingStagedRecord).where(storedStagedCopyDue(now)).returning({ id: publishingStagedRecord.id }),
      deps.db.delete(publishingPublishedAssertion).where(sql`exists (
        select 1 from ${publishingSourcePolicy}
        where ${publishingSourcePolicy.id} = ${publishingPublishedAssertion.sourcePolicyId}
          and ${sourceCopyDue(assertionCapturedAt(), now)}
      )`).returning({ id: publishingPublishedAssertion.id }),
      deps.db.update(publishingPublishedAssertion).set({
        media: retainedComponentArray(
          publishingPublishedAssertion.media,
          assertionCapturedAt(),
          publishingPublishedAssertion.sourcePolicyId,
          now,
        ),
        productionClaims: retainedComponentArray(
          publishingPublishedAssertion.productionClaims,
          assertionCapturedAt(),
          publishingPublishedAssertion.sourcePolicyId,
          now,
        ),
      }),
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
    and (
      (
        ${publishingPublishedAssertion.identityScope} = 'applicability'
        and ${publishingSourcePolicy.permittedFields} @> '["displayName", "salesMarket"]'::jsonb
        and ${publishingSourcePolicy.permittedGeographies} @> jsonb_build_array(${publishingPublishedAssertion.salesMarket})
      )
      or (
        ${publishingPublishedAssertion.identityScope} in ('generation', 'model')
        and ${publishingSourcePolicy.permittedFields} @> '["displayName"]'::jsonb
        and jsonb_typeof(${publishingPublishedAssertion.rightsGeographies}) = 'array'
        and jsonb_array_length(${publishingPublishedAssertion.rightsGeographies}) > 0
        and ${publishingSourcePolicy.permittedGeographies} @> ${publishingPublishedAssertion.rightsGeographies}
      )
    )
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
      and ${publicPolicyAllows(assertionCapturedAt(), now)}
      and ${publishingSourcePolicy.permittedFields} @> cast(${JSON.stringify(CATALOGUE_IDENTITY_FIELDS)} as jsonb)
  )`;
}

/** A Model or Generation shell is public only while its own reviewed projection still permits it. */
export function currentScopedProjectionCovers(
  subjectId: SQLWrapper,
  scope: "generation" | "model",
  now: Date,
): SQL {
  const fields = scope === "generation" ? ["brand", "model", "generation"] : ["brand", "model"];
  return sql`exists (
    select 1
    from ${publishingPublishedAssertion}
    inner join ${publishingProjectionPointer}
      on ${publishingPublishedAssertion.generationId} = ${publishingProjectionPointer.generationId}
      and ${publishingProjectionPointer.id} = 1
    inner join ${publishingSourcePolicy}
      on ${publishingSourcePolicy.id} = ${publishingPublishedAssertion.sourcePolicyId}
    where ${publishingPublishedAssertion.canonicalSubjectId} = ${subjectId}
      and ${publishingPublishedAssertion.identityScope} = ${scope}
      and ${publicPolicyAllows(assertionCapturedAt(), now)}
      and ${publishingSourcePolicy.permittedFields} @> cast(${JSON.stringify(fields)} as jsonb)
  )`;
}

function assertionCapturedAt(): SQL {
  return sql`least(${publishingPublishedAssertion.capturedAt},
    publishing_price_captured_at(${publishingPublishedAssertion.priceReference}))`;
}

/** The oldest source retrieval bounds retention for the entire stored document and its media. */
function sourceCapturedAt(record: ImportRecord, receivedAt: string): string {
  return new Date(Math.min(
    new Date(receivedAt).getTime(),
    ...record.document.facts.map((fact) => new Date(fact.retrievedAt).getTime()),
    ...(record.catalogue?.priceReference ? [new Date(record.catalogue.priceReference.retrievedOn).getTime()] : []),
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
  const componentIds = new Set<string>();
  for (const policy of value.componentPolicies) {
    if (policy.providerKey !== value.providerKey) {
      throw new PublishingRejected("validation", "A component source policy provider does not match the import provider.");
    }
    if (policy.id === value.sourcePolicy.id || componentIds.has(policy.id)) {
      throw new PublishingRejected("validation", "A component source policy repeats a policy id.");
    }
    componentIds.add(policy.id);
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
    for (const item of [...record.document.media, ...record.document.productionClaims]) {
      assertComponentPolicyRef(value, item.sourcePolicyId);
      if (item.sourcePolicyId && item.sourcePolicyId !== value.sourcePolicy.id && !item.retrievedAt) {
        throw new PublishingRejected("validation", "Image and production content under its own policy needs a retrieval time.");
      }
    }
    for (const claim of record.document.productionClaims) {
      if (!claim.retrievedAt) {
        throw new PublishingRejected("validation", "A production claim needs a retrieval time.");
      }
    }
    assertCatalogueContext(value.sourcePolicy, record);
  }
  return value;
}

function assertComponentPolicyRef(parsed: OperatorImport, sourcePolicyId: string | undefined): void {
  if (!sourcePolicyId || sourcePolicyId === parsed.sourcePolicy.id) return;
  if (!parsed.componentPolicies.some((policy) => policy.id === sourcePolicyId)) {
    throw new PublishingRejected("validation", "Image or production content cites a source policy that is not in this import.");
  }
}

type GenerationCatalogue = z.infer<typeof generationCatalogueSchema>;

function assertSourcedFactTitles(policy: SourcePolicyInput, record: ImportRecord): void {
  for (const fact of record.document.facts) {
    if (IDENTITY_FACT_PROPERTIES.has(fact.property)) continue;
    if (!policy.permittedFields.includes(fact.property)) continue;
    if (!fact.sourceTitle) {
      throw new PublishingRejected("validation", "A catalogue fact needs a source title.");
    }
  }
}

function assertCatalogueContext(policy: SourcePolicyInput, record: ImportRecord): void {
  const catalogue = record.catalogue;
  const shapes = [catalogue, record.generationCatalogue, record.modelCatalogue].filter(Boolean).length;
  if (shapes === 0) return;
  if (!policy.displayName) {
    throw new PublishingRejected("validation", "A catalogue record needs a source policy display name.");
  }
  if (shapes > 1) {
    throw new PublishingRejected("validation", "A record is one of an applicability, a scoped generation, or a scoped model.");
  }
  if (record.modelCatalogue) {
    if (!catalogueIdSchema.safeParse(record.document.canonicalSubjectId).success) {
      throw new PublishingRejected("validation", "The canonical subject id is not a catalogue model id.");
    }
    if (record.document.canonicalSubjectId !== record.modelCatalogue.model.id) {
      throw new PublishingRejected("validation", "A scoped model uses the model id as its canonical subject.");
    }
    if (record.document.modelYearLabel !== null) {
      throw new PublishingRejected("validation", "A scoped model does not include a model year.");
    }
    assertSourcedFactTitles(policy, record);
    return;
  }
  if (record.generationCatalogue) {
    if (!catalogueIdSchema.safeParse(record.document.canonicalSubjectId).success) {
      throw new PublishingRejected("validation", "The canonical subject id is not a catalogue generation id.");
    }
    if (record.document.canonicalSubjectId !== record.generationCatalogue.generation.id) {
      throw new PublishingRejected("validation", "A scoped generation uses the generation id as its canonical subject.");
    }
    if (record.document.modelYearLabel !== null) {
      throw new PublishingRejected("validation", "A scoped generation does not include a model year.");
    }
    assertSourcedFactTitles(policy, record);
    return;
  }
  if (!catalogue) return;
  if (!catalogueIdSchema.safeParse(record.document.canonicalSubjectId).success) {
    throw new PublishingRejected("validation", "The canonical subject id is not a catalogue applicability id.");
  }
  if (catalogue.salesMarket.countryCode !== record.document.salesMarket) {
    throw new PublishingRejected("validation", "The catalogue sales market does not match the record.");
  }
  if (record.document.modelYearLabel !== catalogue.modelYear.label) {
    throw new PublishingRejected("validation", "The catalogue model year does not match the record.");
  }
  assertSourcedFactTitles(policy, record);
}

function collectFailures(parsed: OperatorImport, current: CurrentProjection, contexts: CanonicalContext[], now: Date): GateFailure[] {
  const subjectCounts = new Map<string, number>();
  for (const record of parsed.records) {
    const subjectId = record.document.canonicalSubjectId;
    subjectCounts.set(subjectId, (subjectCounts.get(subjectId) ?? 0) + 1);
  }
  const failures: GateFailure[] = [];
  for (const record of parsed.records) {
    const failure = evaluateRecord(record, parsed, current, contexts, subjectCounts, now);
    if (failure) failures.push(failure);
  }
  return failures;
}

function evaluateRecord(
  record: ImportRecord,
  parsed: OperatorImport,
  current: CurrentProjection,
  contexts: CanonicalContext[],
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
  const context = contexts.find((item) => item.id === subjectId);
  const catalogue = record.catalogue;
  if (record.generationCatalogue || record.modelCatalogue) {
    if (context) {
      return { externalId, code: "identity", message: "That subject is already an applicability record." };
    }
  } else if (context && (
    context.synthetic || context.providerKey !== parsed.providerKey ||
    context.countryCode !== record.document.salesMarket ||
    context.modelYearLabel !== record.document.modelYearLabel ||
    (catalogue && (
      catalogue.brand.id !== context.brandId || catalogue.model.id !== context.modelId ||
      catalogue.generation.id !== context.generationId || catalogue.marketVariant.id !== context.marketVariantId ||
      catalogue.salesMarket.id !== context.salesMarketId || catalogue.modelYear.id !== context.modelYearId
    ))
  )) {
    return { externalId, code: "identity", message: "The reviewed document does not match the existing canonical applicability." };
  }
  if (context && !policy.displayName && policy.id !== context.sourcePolicyId) {
    return { externalId, code: "rights", message: "A new catalogue policy revision needs an explicit display name." };
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
  const partial = Boolean(record.generationCatalogue || record.modelCatalogue);
  if (!partial && !policy.permittedFields.includes("salesMarket")) {
    return { externalId, code: "rights", message: "The sales market is not a permitted field." };
  }
  const identityFields = record.modelCatalogue
    ? ["brand", "model"]
    : record.generationCatalogue
      ? ["brand", "model", "generation"]
      : CATALOGUE_IDENTITY_FIELDS;
  if ((record.catalogue || record.generationCatalogue || record.modelCatalogue) && identityFields.some((field) => !policy.permittedFields.includes(field))) {
    return { externalId, code: "rights", message: "A catalogue identity component is not a permitted field." };
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
  return evaluateComponents(record, parsed, now);
}

function evaluateComponents(record: ImportRecord, parsed: OperatorImport, now: Date): GateFailure | null {
  const externalId = record.externalId;
  const recordCapture = sourceCapturedAt(record, now.toISOString());
  const components = [
    ...record.document.media.map((item) => ({
      kind: "image" as const,
      sourcePolicyId: item.sourcePolicyId,
      countryCode: item.countryCode ?? record.document.salesMarket,
      retrievedAt: item.retrievedAt ?? recordCapture,
    })),
    ...record.document.productionClaims.map((claim) => ({
      kind: "fact" as const,
      sourcePolicyId: claim.sourcePolicyId,
      countryCode: claim.countryCode,
      retrievedAt: claim.retrievedAt,
    })),
  ];
  for (const component of components) {
    const policy = componentPolicy(parsed, component.sourcePolicyId);
    if (!policy) {
      return { externalId, code: "rights", message: "Image or production content cites a source policy that is not in this import." };
    }
    const separate = component.sourcePolicyId !== undefined && component.sourcePolicyId !== parsed.sourcePolicy.id;
    const retrievedAt = separate ? component.retrievedAt : earlierIso(component.retrievedAt, recordCapture);
    // These omissions keep the record. Retention and a separate policy's geography still block it.
    if (component.kind === "fact" && !policy.permittedFields.includes("productionClaims")) continue;
    if (!separate && component.kind === "image" && policy.imagePermission !== "permitted") continue;
    if (!separate && !policy.permittedGeographies.includes(component.countryCode)) continue;
    if (componentPolicyAllows(
      componentPolicyView(policy),
      { retrievedAt, countryCode: component.countryCode },
      component.kind,
      now,
    )) {
      continue;
    }
    if (!policy.reviewerRef || !policy.reviewedAt || policy.attribution.trim().length === 0) {
      return { externalId, code: "rights", message: "A component source policy has not been reviewed." };
    }
    if (policy.suspended) {
      return { externalId, code: "suspended", message: "A suspended source cannot add public results." };
    }
    if (isExpired(policy.permissionExpiresAt, now)) {
      return { externalId, code: "expired", message: "The source permission has expired." };
    }
    const retrieved = new Date(retrievedAt).getTime();
    if (policy.retentionSeconds <= 0 || Number.isNaN(retrieved) || retrieved + policy.retentionSeconds * 1000 <= now.getTime()) {
      return { externalId, code: "expired", message: "The source copy is already beyond its retention deadline." };
    }
    if (!policy.permittedGeographies.includes(component.countryCode)) {
      return { externalId, code: "rights", message: "The component geography is outside the permitted geography." };
    }
    if (component.kind === "image") {
      return { externalId, code: "rights", message: "Image permission is denied." };
    }
    return { externalId, code: "rights", message: "Fact permission is denied." };
  }
  return null;
}

function componentPolicy(parsed: OperatorImport, sourcePolicyId: string | undefined): SourcePolicyInput | undefined {
  if (!sourcePolicyId || sourcePolicyId === parsed.sourcePolicy.id) return parsed.sourcePolicy;
  return parsed.componentPolicies.find((policy) => policy.id === sourcePolicyId);
}

function governingPolicy(
  policy: SourcePolicyInput,
  policyId: string,
  sourcePolicyId: string | undefined,
  componentPolicies: OperatorImport["componentPolicies"],
): { policy: SourcePolicyInput; id: string } | null {
  if (!sourcePolicyId || sourcePolicyId === policyId) return { policy, id: policyId };
  const component = componentPolicies.find((item) => item.id === sourcePolicyId);
  return component ? { policy: component, id: component.id } : null;
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

function canonicalContexts(db: Database, subjectIds: string[]) {
  return db.select({
    id: catalogueApplicability.id,
    sourcePolicyId: catalogueApplicability.sourcePolicyId,
    marketVariantId: catalogueApplicability.marketVariantId,
    modelYearId: catalogueApplicability.modelYearId,
    salesMarketId: catalogueApplicability.salesMarketId,
    generationId: catalogueMarketVariant.generationId,
    modelId: catalogueGeneration.modelId,
    brandId: catalogueModel.brandId,
    countryCode: catalogueSalesMarket.countryCode,
    modelYearLabel: catalogueModelYear.label,
    synthetic: catalogueApplicability.synthetic,
    providerKey: publishingSourcePolicy.providerKey,
    signature: sql<unknown>`jsonb_build_array(
      ${catalogueApplicability.id}, ${catalogueApplicability.marketVariantId},
      ${catalogueApplicability.modelYearId}, ${catalogueApplicability.salesMarketId},
      ${catalogueApplicability.sourcePolicyId}, ${catalogueApplicability.publicationStatus},
      ${catalogueApplicability.synthetic}, ${catalogueSalesMarket.countryCode},
      ${catalogueModelYear.label}, ${catalogueMarketVariant.generationId},
      ${catalogueGeneration.modelId}, ${catalogueModel.brandId}, ${publishingSourcePolicy.providerKey},
      ${catalogueMarketVariant.name}, ${catalogueGeneration.name}, ${catalogueGeneration.slug},
      ${catalogueModel.name}, ${catalogueModel.slug}, ${catalogueSalesMarket.name}, ${catalogueModelYear.convention}
    )`.as("signature"),
  }).from(catalogueApplicability)
    .innerJoin(catalogueMarketVariant, eq(catalogueMarketVariant.id, catalogueApplicability.marketVariantId))
    .innerJoin(catalogueGeneration, eq(catalogueGeneration.id, catalogueMarketVariant.generationId))
    .innerJoin(catalogueModel, eq(catalogueModel.id, catalogueGeneration.modelId))
    .innerJoin(catalogueSalesMarket, eq(catalogueSalesMarket.id, catalogueApplicability.salesMarketId))
    .innerJoin(catalogueModelYear, eq(catalogueModelYear.id, catalogueApplicability.modelYearId))
    .leftJoin(publishingSourcePolicy, eq(publishingSourcePolicy.id, catalogueApplicability.sourcePolicyId))
    .where(inArray(catalogueApplicability.id, subjectIds));
}

type CanonicalContext = Awaited<ReturnType<typeof canonicalContexts>>[number];

function insertPolicy(db: Database, policy: SourcePolicyInput, policyId: string, createdAt: string) {
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
    document: projectionDocument(record, parsed),
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
        document: preservedComponentCaptures(values.document, policyId),
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
        capturedAt: sql`least(${publishingStagedRecord.capturedAt}, cast(${values.capturedAt} as timestamptz),
          (select case when prior_policy.suspended then '-infinity'::timestamptz else
            least(${publishingStagedRecord.capturedAt} + prior_policy.retention_seconds * interval '1 second',
              coalesce(prior_policy.permission_expires_at, 'infinity'::timestamptz))
            - ${parsed.sourcePolicy.retentionSeconds} * interval '1 second' end
          from ${publishingSourcePolicy} as prior_policy
          where prior_policy.id = ${publishingStagedRecord.sourcePolicyId}))`,
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
  componentPolicies: OperatorImport["componentPolicies"],
  now: Date,
) {
  const factualReviewerRef = record.factualReview.reviewerRef ?? "";
  const rightsReviewerRef = record.rightsReview.reviewerRef ?? "";
  const recordCapture = sourceCapturedAt(record, publishedAt);
  const facts = record.document.facts
    .filter((fact) => !IDENTITY_FACT_PROPERTIES.has(fact.property))
    .filter((fact) => policy.permittedFields.includes(fact.property))
    .filter((fact) => !factLeaksIdentifier(fact))
    .map((fact) => presentFact(fact, policyId, factualReviewerRef, rightsReviewerRef));
  const media = record.document.media.flatMap((item) => {
    const governing = governingPolicy(policy, policyId, item.sourcePolicyId, componentPolicies);
    if (!governing) return [];
    if (textLeaksIdentifier([item.sourceUrl, item.altText, item.credit, governing.policy.attribution])) return [];
    const separate = governing.id !== policyId;
    const retrievedAt = item.retrievedAt ?? null;
    const countryCode = item.countryCode ?? null;
    const effectiveRetrieved = separate
      ? retrievedAt ?? recordCapture
      : earlierIso(retrievedAt ?? recordCapture, recordCapture);
    const effectiveCountry = countryCode ?? record.document.salesMarket;
    if (!componentPolicyAllows(
      componentPolicyView(governing.policy),
      { retrievedAt: effectiveRetrieved, countryCode: effectiveCountry },
      "image",
      now,
    )) {
      return [];
    }
    return [
      {
        sourceUrl: item.sourceUrl,
        credit: item.credit,
        altText: item.altText,
        sourcePolicyId: governing.id,
        rightsReviewerRef,
        retrievedAt,
        countryCode,
        attribution: governing.policy.attribution,
      },
    ];
  });
  const productionClaims = record.document.productionClaims.flatMap((claim) => {
    const governing = governingPolicy(policy, policyId, claim.sourcePolicyId, componentPolicies);
    if (!governing || governing.policy.factPermission !== "permitted") return [];
    // One permission covers the count and its scope, geography, period, and source metadata.
    if (!governing.policy.permittedFields.includes("productionClaims")) return [];
    const separate = governing.id !== policyId;
    const retrievedAt = separate ? claim.retrievedAt : earlierIso(claim.retrievedAt, recordCapture);
    if (!componentPolicyAllows(
      componentPolicyView(governing.policy),
      { retrievedAt, countryCode: claim.countryCode },
      "fact",
      now,
    )) {
      return [];
    }
    if (/(sale|registration|export)/i.test(claim.counted)) return [];
    if (
      textLeaksIdentifier([
        claim.scope,
        claim.geography,
        claim.period,
        claim.counted,
        claim.sourceTitle,
        claim.sourceUrl ?? "",
        claim.reviewedOn,
        claim.countryCode,
        governing.policy.attribution,
        governing.policy.displayName ?? "",
      ])
    ) {
      return [];
    }
    return [
      {
        scope: claim.scope,
        geography: claim.geography,
        period: claim.period,
        count: claim.count,
        status: claim.status,
        counted: claim.counted,
        sourceTitle: claim.sourceTitle,
        sourceUrl: claim.sourceUrl,
        observedAt: claim.observedAt,
        retrievedAt: claim.retrievedAt,
        reviewedOn: claim.reviewedOn,
        countryCode: claim.countryCode,
        sourcePolicyId: governing.id,
        factualReviewerRef,
        rightsReviewerRef,
        policyName: governing.policy.displayName ?? policy.displayName ?? "",
        policyAttribution: governing.policy.attribution,
      },
    ];
  });
  const identityScope = record.modelCatalogue ? "model" : record.generationCatalogue ? "generation" : "applicability";
  const partial = identityScope !== "applicability";
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
    aliases: policy.permittedFields.includes("alias")
      ? [...new Set([
          ...record.document.aliases,
          ...((record.catalogue ?? record.generationCatalogue ?? record.modelCatalogue)?.aliases.map((alias) => alias.name) ?? []),
        ])]
      : [],
    salesMarket: partial || policy.permittedFields.includes("salesMarket") ? record.document.salesMarket : "",
    modelYearLabel: partial ? null : policy.permittedFields.includes("modelYearLabel") ? record.document.modelYearLabel : null,
    identityScope,
    rightsGeographies: partial ? [record.document.salesMarket] : [],
    facts,
    media,
    productionClaims,
    attribution: policy.attribution,
    sourcePolicyId: policyId,
    factualReviewerRef,
    rightsReviewerRef,
    observedAt,
    reviewedAt,
    priceReference:
      !partial && policy.permittedFields.includes("priceReference")
        ? record.catalogue?.priceReference ?? null
        : null,
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
  if (record.modelCatalogue && displayName) {
    return modelCatalogueStatements(db, parsed, record, policyId, record.modelCatalogue);
  }
  if (record.generationCatalogue && displayName) {
    return generationCatalogueStatements(db, parsed, record, policyId, record.generationCatalogue);
  }
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
    ...cataloguePolicyStatements(db, parsed.sourcePolicy, policyId),
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
      .onConflictDoUpdate({
        target: catalogueApplicability.id,
        set: { sourcePolicyId: policyId },
      }),
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
              or ${catalogueApplicability.publicationStatus} is distinct from 'published'
              or ${catalogueApplicability.synthetic} is distinct from false`,
          ),
        )
        .limit(1),
    ),
  ];
  const aliasRows = [
    { kind: "brand" as const, name: catalogue.brand.name },
    { kind: "model" as const, name: catalogue.model.name },
    { kind: "generation" as const, name: catalogue.generation.name },
    ...(parsed.sourcePolicy.permittedFields.includes("alias")
      ? [...catalogue.aliases, ...record.document.aliases.map((name) => ({ kind: "alias", name }))] : []),
  ];
  return [...statements, ...catalogueAliasStatements(db, subjectId, aliasRows)];
}

type ModelCatalogue = z.infer<typeof modelCatalogueSchema>;

function modelCatalogueStatements(
  db: Database,
  parsed: OperatorImport,
  record: ImportRecord,
  policyId: string,
  catalogue: ModelCatalogue,
): BatchItem<"pg">[] {
  const statements: BatchItem<"pg">[] = [
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
    ...cataloguePolicyStatements(db, parsed.sourcePolicy, policyId),
  ];
  const names = [
    catalogue.brand.name,
    catalogue.model.name,
    ...(parsed.sourcePolicy.permittedFields.includes("alias")
      ? [...catalogue.aliases.map((alias) => alias.name), ...record.document.aliases]
      : []),
  ];
  return [...statements, ...modelAliasStatements(db, catalogue.model.id, names)];
}

function modelAliasStatements(db: Database, modelId: string, names: string[]): BatchItem<"pg">[] {
  const seen = new Set<string>();
  const statements: BatchItem<"pg">[] = [];
  for (const name of names) {
    const normalized = normalizeCatalogueQuery(name);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    statements.push(
      db
        .insert(catalogueModelAlias)
        .values({ id: randomId(), modelId, normalizedName: normalized })
        .onConflictDoNothing({
          target: [catalogueModelAlias.modelId, catalogueModelAlias.normalizedName],
        }),
    );
  }
  return statements;
}

function generationCatalogueStatements(
  db: Database,
  parsed: OperatorImport,
  record: ImportRecord,
  policyId: string,
  catalogue: GenerationCatalogue,
): BatchItem<"pg">[] {
  const statements: BatchItem<"pg">[] = [
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
    ...cataloguePolicyStatements(db, parsed.sourcePolicy, policyId),
  ];
  const names = [
    catalogue.brand.name,
    catalogue.model.name,
    catalogue.generation.name,
    ...(parsed.sourcePolicy.permittedFields.includes("alias")
      ? [...catalogue.aliases.map((alias) => alias.name), ...record.document.aliases]
      : []),
  ];
  return [...statements, ...generationAliasStatements(db, catalogue.generation.id, names)];
}

function generationAliasStatements(db: Database, generationId: string, names: string[]): BatchItem<"pg">[] {
  const seen = new Set<string>();
  const statements: BatchItem<"pg">[] = [];
  for (const name of names) {
    const normalized = normalizeCatalogueQuery(name);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    statements.push(
      db
        .insert(catalogueGenerationAlias)
        .values({
          id: randomId(),
          generationId,
          normalizedName: normalized,
        })
        .onConflictDoNothing({
          target: [catalogueGenerationAlias.generationId, catalogueGenerationAlias.normalizedName],
        }),
    );
  }
  return statements;
}

function catalogueAliasStatements(db: Database, subjectId: string, aliases: Array<{ kind: string; name: string }>): BatchItem<"pg">[] {
  const seen = new Set<string>();
  const statements: BatchItem<"pg">[] = [];
  for (const alias of aliases) {
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

function cataloguePolicyStatements(db: Database, policy: SourcePolicyInput, policyId: string): BatchItem<"pg">[] {
  const displayName = policy.displayName;
  if (!displayName) return [];
  return [
    db
      .insert(catalogueSourcePolicy)
      .values({
        id: policyId,
        name: displayName,
        audience: "public",
        permitsPublicCatalogue: true,
        rightsReview: "reviewed",
        attribution: policy.attribution,
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
              or ${catalogueSourcePolicy.attribution} is distinct from ${policy.attribution}
              or ${catalogueSourcePolicy.internalNote} is distinct from ''`,
          ),
        )
        .limit(1),
    ),
  ];
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
  if (
    record.document.productionClaims.some((claim) =>
      textLeaksIdentifier([
        claim.scope,
        claim.geography,
        claim.period,
        claim.counted,
        claim.sourceTitle,
        claim.sourceUrl ?? "",
        claim.reviewedOn,
        claim.countryCode,
      ]),
    )
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
    ...policy.permittedFields,
    record.factualReview.reviewerRef ?? "",
    record.rightsReview.reviewerRef ?? "",
    ...record.document.aliases,
    ...catalogueIdentityText(record),
  ]);
}

function catalogueIdentityText(record: ImportRecord): string[] {
  const model = record.modelCatalogue;
  if (model) {
    return [
      model.brand.id,
      model.brand.name,
      model.brand.slug,
      model.model.id,
      model.model.name,
      model.model.slug,
      ...model.aliases.flatMap((alias) => [alias.kind, alias.name]),
    ];
  }
  const generation = record.generationCatalogue;
  if (generation) {
    return [
      generation.brand.id,
      generation.brand.name,
      generation.brand.slug,
      generation.model.id,
      generation.model.name,
      generation.model.slug,
      generation.generation.id,
      generation.generation.name,
      generation.generation.slug,
      ...generation.aliases.flatMap((alias) => [alias.kind, alias.name]),
    ];
  }
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
  curatedReason?: string | null;
  conflict?: {
    rawValue: string;
    normalizedValue?: string | null;
    unit?: string | null;
    standard?: string | null;
    sourceUrl?: string | null;
    sourceTitle?: string | null;
    factualReviewerRef?: string;
    rightsReviewerRef?: string;
  } | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  providerKey?: string;
  sourcePolicyId?: string;
  factualReviewerRef?: string;
  rightsReviewerRef?: string;
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
      fact.curatedReason ?? "",
      fact.conflict?.rawValue ?? "",
      fact.conflict?.normalizedValue ?? "",
      fact.conflict?.unit ?? "",
      fact.conflict?.standard ?? "",
      fact.conflict?.sourceUrl ?? "",
      fact.conflict?.sourceTitle ?? "",
      fact.conflict?.factualReviewerRef ?? "",
      fact.conflict?.rightsReviewerRef ?? "",
      fact.sourceUrl ?? "",
      fact.sourceTitle ?? "",
      fact.providerKey ?? "",
      fact.sourcePolicyId ?? "",
      fact.factualReviewerRef ?? "",
      fact.rightsReviewerRef ?? "",
    ])
  );
}

export function publicMetadataEligible(values: string[]): boolean {
  return !textLeaksIdentifier(values);
}

function textLeaksIdentifier(values: string[]): boolean {
  return values.some((value) => {
    if (z.uuid().safeParse(value).success) return false;
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

function presentFact(
  fact: z.infer<typeof sourcedFactSchema>,
  sourcePolicyId: string,
  factualReviewerRef: string,
  rightsReviewerRef: string,
): PublicFact {
  const valued = fact.state === "known";
  const conflict =
    fact.conflict && (fact.state === "known" || fact.state === "unknown")
      ? {
          rawValue: fact.conflict.rawValue,
          normalizedValue: fact.conflict.normalizedValue,
          unit: fact.conflict.unit,
          standard: fact.conflict.standard,
          sourceUrl: fact.conflict.sourceUrl,
          sourceTitle: fact.conflict.sourceTitle,
          observedAt: fact.conflict.observedAt,
          retrievedAt: fact.conflict.retrievedAt,
          factualReviewerRef: fact.conflict.factualReviewerRef,
          rightsReviewerRef: fact.conflict.rightsReviewerRef,
        }
      : null;
  return {
    property: fact.property,
    rawValue: valued ? fact.rawValue : "",
    normalizedValue: valued ? fact.normalizedValue : null,
    state: fact.state,
    unknownReason: valued ? null : fact.unknownReason,
    unit: valued ? fact.unit : null,
    standard: valued ? fact.standard : null,
    freshness: fact.freshness,
    curatedReason: fact.curatedReason,
    conflict,
    sourceUrl: fact.sourceUrl,
    sourceTitle: fact.sourceTitle,
    providerKey: fact.providerKey,
    observedAt: fact.observedAt,
    retrievedAt: fact.retrievedAt,
    sourcePolicyId,
    factualReviewerRef,
    rightsReviewerRef,
  };
}

function asPublicFacts(value: unknown): PublicFact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const fact = publicFactSchema.safeParse(item);
    if (!fact.success || IDENTITY_FACT_PROPERTIES.has(fact.data.property) || factLeaksIdentifier(fact.data)) return [];
    return [withoutHiddenMeasurements({ ...fact.data, sourceTitle: fact.data.sourceTitle ?? null })];
  });
}

function withoutHiddenMeasurements(fact: PublicFact): PublicFact {
  if (fact.state === "known") return fact;
  return {
    ...fact,
    rawValue: "",
    normalizedValue: null,
    unit: null,
    standard: null,
    conflict: fact.state === "unknown" ? fact.conflict : null,
  };
}

function permittedPublicFacts(value: unknown, fields: string[]): PublicFact[] {
  return asPublicFacts(value).filter((fact) => fields.includes(fact.property));
}

function publicRecordEligible(row: Pick<
  typeof publishingPublishedAssertion.$inferSelect,
  "canonicalSubjectId" | "displayName" | "aliases" | "salesMarket" | "modelYearLabel" |
  "attribution" | "providerKey" | "factualReviewerRef" | "rightsReviewerRef" | "facts"
> & { policyReviewerRef: string | null; policyName: string | null; permittedFields: string[] }): boolean {
  return permittedPublicFacts(row.facts, row.permittedFields).length > 0 && !textLeaksIdentifier([
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
    row.policyName ?? "",
    ...row.permittedFields,
  ]);
}

function asPublicMedia(value: unknown): PublicMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const media = publicMediaSchema.safeParse(item);
    if (!media.success) return [];
    const parsed = {
      ...media.data,
      retrievedAt: media.data.retrievedAt ?? null,
      countryCode: media.data.countryCode ?? null,
      attribution: media.data.attribution ?? null,
    };
    return textLeaksIdentifier([
      parsed.sourceUrl,
      parsed.altText,
      parsed.credit,
      parsed.sourcePolicyId,
      parsed.rightsReviewerRef,
      parsed.attribution ?? "",
      parsed.countryCode ?? "",
    ])
      ? []
      : [parsed];
  });
}

function asPublicProductionClaims(value: unknown): PublicProductionClaim[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const claim = publicProductionClaimSchema.safeParse(item);
    if (!claim.success || /(sale|registration|export)/i.test(claim.data.counted)) return [];
    return textLeaksIdentifier([
      claim.data.scope,
      claim.data.geography,
      claim.data.period,
      claim.data.counted,
      claim.data.sourceTitle,
      claim.data.sourceUrl ?? "",
      claim.data.reviewedOn,
      claim.data.countryCode,
      claim.data.policyName,
      claim.data.policyAttribution,
      claim.data.sourcePolicyId,
      claim.data.factualReviewerRef,
      claim.data.rightsReviewerRef,
    ])
      ? []
      : [claim.data];
  });
}

type ComponentPolicyRow = {
  suspended: boolean;
  reviewerRef: string | null;
  reviewedAt: string | null;
  permissionExpiresAt: string | null;
  retentionSeconds: number;
  permittedGeographies: string[];
  permittedFields: string[];
  imagePermission: string;
  factPermission: string;
  attribution: string;
};

function assertComponentRetention(parsed: OperatorImport, now: Date): void {
  for (const record of parsed.records) {
    const recordCapture = sourceCapturedAt(record, now.toISOString());
    const copies = [
      ...record.document.media.map((item) => ({
        sourcePolicyId: item.sourcePolicyId,
        retrievedAt: item.retrievedAt ?? recordCapture,
        separate: item.sourcePolicyId !== undefined && item.sourcePolicyId !== parsed.sourcePolicy.id,
      })),
      ...record.document.productionClaims.map((claim) => ({
        sourcePolicyId: claim.sourcePolicyId,
        retrievedAt: claim.retrievedAt,
        separate: claim.sourcePolicyId !== undefined && claim.sourcePolicyId !== parsed.sourcePolicy.id,
      })),
    ];
    for (const copy of copies) {
      const policy = componentPolicy(parsed, copy.sourcePolicyId);
      if (!policy) {
        throw new PublishingRejected("rights", "Image or production content cites a source policy that is not in this import.");
      }
      const retrievedAt = copy.separate ? copy.retrievedAt : earlierIso(copy.retrievedAt, recordCapture);
      const retrieved = new Date(retrievedAt).getTime();
      if (policy.retentionSeconds <= 0 || Number.isNaN(retrieved) || retrieved + policy.retentionSeconds * 1000 <= now.getTime()) {
        throw new PublishingRejected("expired", "The source copy is already beyond its retention deadline.");
      }
    }
  }
}

function projectionDocument(record: ImportRecord, parsed: OperatorImport): ImportRecord["document"] {
  return {
    ...record.document,
    media: record.document.media.filter((item) => {
      const policy = componentPolicy(parsed, item.sourcePolicyId);
      const country = item.countryCode ?? record.document.salesMarket;
      return Boolean(policy?.permittedGeographies.includes(country));
    }),
    productionClaims: record.document.productionClaims.filter((claim) => {
      const policy = componentPolicy(parsed, claim.sourcePolicyId);
      return Boolean(
        policy?.permittedFields.includes("productionClaims") &&
          policy.permittedGeographies.includes(claim.countryCode),
      );
    }),
  };
}

function componentPolicyView(policy: SourcePolicyInput): ComponentPolicyRow {
  return {
    suspended: policy.suspended,
    reviewerRef: policy.reviewerRef,
    reviewedAt: policy.reviewedAt,
    permissionExpiresAt: policy.permissionExpiresAt,
    retentionSeconds: policy.retentionSeconds,
    permittedGeographies: policy.permittedGeographies,
    permittedFields: policy.permittedFields,
    imagePermission: policy.imagePermission,
    factPermission: policy.factPermission,
    attribution: policy.attribution,
  };
}

const CAPTURE_TIMESTAMP = String.raw`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$`;

function componentPolicyId(item: SQL, parentPolicyId: SQLWrapper): SQL {
  return sql`coalesce(${item}->>'sourcePolicyId', ${parentPolicyId}::text)`;
}

function componentCapturedAt(item: SQL, fallbackCapturedAt: SQLWrapper, parentPolicyId: SQLWrapper): SQL {
  const policyId = componentPolicyId(item, parentPolicyId);
  const ownCapture = sql`(case
    when ${item}->>'retrievedAt' is null then null
    when ${item}->>'retrievedAt' ~ ${CAPTURE_TIMESTAMP} then (${item}->>'retrievedAt')::timestamptz
    else '-infinity'::timestamptz
  end)`;
  return sql`(case
    when ${policyId} = ${parentPolicyId}::text then least(coalesce(${ownCapture}, ${fallbackCapturedAt}), ${fallbackCapturedAt})
    else coalesce(${ownCapture}, ${fallbackCapturedAt})
  end)`;
}

function storedStagedCopyDue(now: SQLWrapper): SQL {
  return sql`(
    exists (
      select 1 from ${publishingSourcePolicy}
      where ${publishingSourcePolicy.id} = ${publishingStagedRecord.sourcePolicyId}
        and ${sourceCopyDue(publishingStagedRecord.capturedAt, now)}
    )
    or ${componentsDue(sql`
      coalesce(${publishingStagedRecord.document}->'media', '[]'::jsonb)
      || coalesce(${publishingStagedRecord.document}->'productionClaims', '[]'::jsonb)
    `, now)}
  )`;
}

function nonpublishedStagedCopyDue(parsed: OperatorImport, now: SQLWrapper): SQL {
  return sql`(${storedStagedCopyDue(now)} or ${incomingComponentsDue(parsed, now)})`;
}

/** Field or geography omissions are not in the stored document, so the import's own copies are checked too. */
function incomingComponentsDue(parsed: OperatorImport, now: SQLWrapper): SQL {
  const checks: SQL[] = [];
  for (const record of parsed.records) {
    const items = [...record.document.media, ...record.document.productionClaims];
    if (items.length === 0) continue;
    checks.push(sql`(
      ${publishingStagedRecord.providerKey} = ${parsed.providerKey}
      and ${publishingStagedRecord.externalId} = ${record.externalId}
      and ${componentsDue(sql`cast(${JSON.stringify(items)} as jsonb)`, now)}
    )`);
  }
  if (checks.length === 0) return sql`false`;
  return sql`(${sql.join(checks, sql` or `)})`;
}

function componentsDue(items: SQL, now: SQLWrapper): SQL {
  return sql`exists (
    select 1
    from jsonb_array_elements(${items}) as component_item
    where ${componentItemDue(
      sql`component_item`,
      sql`${publishingStagedRecord.capturedAt}`,
      sql`${publishingStagedRecord.sourcePolicyId}`,
      now,
    )}
  )`;
}

function componentItemDue(item: SQL, fallbackCapturedAt: SQLWrapper, parentPolicyId: SQLWrapper, now: SQLWrapper): SQL {
  const policyId = componentPolicyId(item, parentPolicyId);
  const captured = componentCapturedAt(item, fallbackCapturedAt, parentPolicyId);
  return sql`(
    not exists (
      select 1 from ${publishingSourcePolicy} as component_policy
      where component_policy.id = ${policyId}
    )
    or exists (
      select 1 from ${publishingSourcePolicy} as component_policy
      where component_policy.id = ${policyId}
        and (
          component_policy.suspended
          or component_policy.retention_seconds <= 0
          or component_policy.permission_expires_at <= ${now}
          or ${captured} + component_policy.retention_seconds * interval '1 second' <= ${now}
        )
    )
  )`;
}

function retainedComponentArray(column: SQLWrapper, fallbackCapturedAt: SQLWrapper, parentPolicyId: SQLWrapper, now: SQLWrapper): SQL {
  return sql`(
    select coalesce(jsonb_agg(component_item order by component_ordinal), '[]'::jsonb)
    from jsonb_array_elements(coalesce(${column}, '[]'::jsonb)) with ordinality as component_row(component_item, component_ordinal)
    where not ${componentItemDue(sql`component_item`, fallbackCapturedAt, parentPolicyId, now)}
  )`;
}

function rejectExpiredComponentRetention(db: Database, batchId: string, now: SQLWrapper) {
  const item = sql`component_item`;
  const fallback = sql`${publishingStagedRecord.capturedAt}`;
  const parent = sql`${publishingStagedRecord.sourcePolicyId}`;
  return rejectBatchWhen(db, sql`exists (
    select 1
    from ${publishingStagedRecord}
    cross join lateral jsonb_array_elements(
      coalesce(${publishingStagedRecord.document}->'media', '[]'::jsonb)
      || coalesce(${publishingStagedRecord.document}->'productionClaims', '[]'::jsonb)
    ) as component_item
    where ${publishingStagedRecord.batchId} = ${batchId}
      and exists (
        select 1 from ${publishingSourcePolicy} as component_policy
        where component_policy.id = ${componentPolicyId(item, parent)}
          and (
            component_policy.retention_seconds <= 0
            or ${componentCapturedAt(item, fallback, parent)}
              + component_policy.retention_seconds * interval '1 second' <= ${now}
          )
      )
  )`);
}

function rejectDueComponents(db: Database, batchId: string, now: SQLWrapper) {
  return rejectBatchWhen(db, sql`exists (
    select 1
    from ${publishingStagedRecord}
    cross join lateral jsonb_array_elements(
      coalesce(${publishingStagedRecord.document}->'media', '[]'::jsonb)
      || coalesce(${publishingStagedRecord.document}->'productionClaims', '[]'::jsonb)
    ) as component_item
    where ${publishingStagedRecord.batchId} = ${batchId}
      and ${componentItemDue(
        sql`component_item`,
        sql`${publishingStagedRecord.capturedAt}`,
        sql`${publishingStagedRecord.sourcePolicyId}`,
        now,
      )}
  )`);
}

function preservedComponentCaptures(document: ImportRecord["document"], parentPolicyId: string): SQL {
  const payload = JSON.stringify(document);
  return sql`(
    select jsonb_set(
      jsonb_set(incoming.document, '{media}', ${preservedCaptureArray(payload, "media", parentPolicyId)}),
      '{productionClaims}',
      ${preservedCaptureArray(payload, "productionClaims", parentPolicyId)}
    )
    from (select cast(${payload} as jsonb) as document) as incoming
  )`;
}

function componentContentEquals(
  left: "prev" | "elem" | "item",
  right: "prev" | "elem" | "item",
  key: "media" | "productionClaims",
): SQL {
  if (key === "media") {
    return sql.raw(`(
      ${left}->>'sourceUrl' = ${right}->>'sourceUrl'
      and ${left}->>'credit' = ${right}->>'credit'
      and ${left}->>'altText' = ${right}->>'altText'
      and ${left}->>'countryCode' is not distinct from ${right}->>'countryCode'
    )`);
  }
  return sql.raw(`(
    ${left}->>'scope' = ${right}->>'scope'
    and ${left}->>'geography' = ${right}->>'geography'
    and ${left}->>'period' = ${right}->>'period'
    and ${left}->'count' = ${right}->'count'
    and ${left}->>'status' = ${right}->>'status'
    and ${left}->>'counted' = ${right}->>'counted'
    and ${left}->>'sourceTitle' = ${right}->>'sourceTitle'
    and ${left}->>'sourceUrl' is not distinct from ${right}->>'sourceUrl'
    and ${left}->>'observedAt' is not distinct from ${right}->>'observedAt'
    and ${left}->>'reviewedOn' = ${right}->>'reviewedOn'
    and ${left}->>'countryCode' is not distinct from ${right}->>'countryCode'
  )`);
}

function preservedCaptureArray(
  payload: string,
  key: "media" | "productionClaims",
  parentPolicyId: string,
): SQL {
  return sql`(
    select coalesce(jsonb_agg(
      case
        when prior.retrieved_at is null or elem->>'retrievedAt' is null then elem
        else jsonb_set(elem, '{retrievedAt}', to_jsonb(to_char(
          least((elem->>'retrievedAt')::timestamptz, prior.retrieved_at, prior.deadline) at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )))
      end
      order by ordinality
    ), '[]'::jsonb)
    from jsonb_array_elements(cast(${payload} as jsonb)->${key}) with ordinality as component_row(elem, ordinality)
    left join lateral (
      select
        (prev->>'retrievedAt')::timestamptz as retrieved_at,
        case
          when old_policy.suspended then '-infinity'::timestamptz
          else least(
            (prev->>'retrievedAt')::timestamptz + old_policy.retention_seconds * interval '1 second',
            coalesce(old_policy.permission_expires_at, 'infinity'::timestamptz)
          ) - coalesce(new_policy.retention_seconds, old_policy.retention_seconds) * interval '1 second'
        end as deadline
      from jsonb_array_elements(coalesce(${publishingStagedRecord.document}->${key}, '[]'::jsonb)) as prev
      join ${publishingSourcePolicy} as old_policy
        on old_policy.id = coalesce(prev->>'sourcePolicyId', ${publishingStagedRecord.sourcePolicyId})
      left join ${publishingSourcePolicy} as new_policy
        on new_policy.id = coalesce(elem->>'sourcePolicyId', ${parentPolicyId})
      where ${componentContentEquals("prev", "elem", key)}
        and prev->>'retrievedAt' ~ ${CAPTURE_TIMESTAMP}
      order by
        (coalesce(prev->>'sourcePolicyId', ${publishingStagedRecord.sourcePolicyId})
          is not distinct from coalesce(elem->>'sourcePolicyId', ${parentPolicyId})) desc,
        (prev->>'retrievedAt')::timestamptz asc
      limit 1
    ) as prior on true
  )`;
}

function stagedComponentTimestamps(
  items: unknown[],
  key: "media" | "productionClaims",
  providerKey: string,
  externalId: string,
  batchId: string,
): SQL {
  const payload = JSON.stringify(items);
  return sql`(
    select coalesce(jsonb_agg(
      case
        when matched.retrieved_at is null then item
        else jsonb_set(item, '{retrievedAt}', to_jsonb(matched.retrieved_at))
      end
      order by ordinality
    ), '[]'::jsonb)
    from jsonb_array_elements(cast(${payload} as jsonb)) with ordinality as public_item(item, ordinality)
    left join lateral (
      select prev->>'retrievedAt' as retrieved_at
      from ${publishingStagedRecord} as staged
      cross join lateral jsonb_array_elements(coalesce(staged.document->${key}, '[]'::jsonb)) as prev
      where staged.provider_key = ${providerKey}
        and staged.external_id = ${externalId}
        and staged.batch_id = ${batchId}
        and ${componentContentEquals("prev", "item", key)}
        and coalesce(prev->>'sourcePolicyId', staged.source_policy_id)
          = coalesce(item->>'sourcePolicyId', staged.source_policy_id)
        and prev->>'retrievedAt' ~ ${CAPTURE_TIMESTAMP}
      order by (prev->>'retrievedAt')::timestamptz asc
      limit 1
    ) as matched on true
  )`;
}

function earlierIso(left: string, right: string): string {
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (Number.isNaN(leftTime)) return Number.isNaN(rightTime) ? left : right;
  if (Number.isNaN(rightTime)) return left;
  return leftTime <= rightTime ? left : right;
}

function componentPolicyAllows(
  policy: ComponentPolicyRow | undefined,
  item: { retrievedAt: string | null; countryCode: string },
  kind: "image" | "fact",
  now: Date,
): boolean {
  if (!policy || policy.suspended || !policy.reviewerRef || !policy.reviewedAt) return false;
  if (isExpired(policy.permissionExpiresAt, now)) return false;
  if (policy.retentionSeconds <= 0 || !item.retrievedAt) return false;
  const retrieved = new Date(item.retrievedAt).getTime();
  if (Number.isNaN(retrieved) || retrieved + policy.retentionSeconds * 1000 <= now.getTime()) return false;
  if (!policy.permittedGeographies.includes(item.countryCode)) return false;
  if (kind === "image" && policy.imagePermission !== "permitted") return false;
  if (kind === "fact" && policy.factPermission !== "permitted") return false;
  if (kind === "fact" && !policy.permittedFields.includes("productionClaims")) return false;
  if (policy.attribution.trim().length === 0) return false;
  return true;
}

async function readComponentPolicies(db: Database, ids: string[]): Promise<Map<string, ComponentPolicyRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: publishingSourcePolicy.id,
      suspended: publishingSourcePolicy.suspended,
      reviewerRef: publishingSourcePolicy.reviewerRef,
      reviewedAt: publishingSourcePolicy.reviewedAt,
      permissionExpiresAt: publishingSourcePolicy.permissionExpiresAt,
      retentionSeconds: publishingSourcePolicy.retentionSeconds,
      permittedGeographies: publishingSourcePolicy.permittedGeographies,
      permittedFields: publishingSourcePolicy.permittedFields,
      imagePermission: publishingSourcePolicy.imagePermission,
      factPermission: publishingSourcePolicy.factPermission,
      attribution: publishingSourcePolicy.attribution,
    })
    .from(publishingSourcePolicy)
    .where(inArray(publishingSourcePolicy.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

const publicConflictSchema = z.object({
  rawValue: z.string(),
  normalizedValue: z.string().nullable(),
  unit: z.string().nullable(),
  standard: z.string().nullable(),
  sourceUrl: sourceUrlSchema.nullable(),
  sourceTitle: z.string().nullable(),
  observedAt: z.string().nullable(),
  retrievedAt: z.string(),
  factualReviewerRef: z.string(),
  rightsReviewerRef: z.string(),
});

const publicFactSchema = z.object({
  property: z.string(),
  rawValue: z.string(),
  normalizedValue: z.string().nullable(),
  state: z.enum(["known", "unknown", "not-applicable", "withheld"]),
  unknownReason: z.string().nullable(),
  unit: z.string().nullable(),
  standard: z.string().nullable(),
  freshness: z.enum(["current", "stale", "not-checked"]).default("current"),
  curatedReason: z.string().nullable().default(null),
  conflict: publicConflictSchema.nullable().default(null),
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
  retrievedAt: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
  attribution: z.string().nullable().optional(),
});

const publicProductionClaimSchema = z.object({
  scope: z.string().min(1),
  geography: z.string().min(1),
  period: z.string().min(1),
  count: z.number().int().nonnegative(),
  status: z.enum(["planned", "completed"]),
  counted: z.string().min(1),
  sourceTitle: z.string().min(1),
  sourceUrl: sourceUrlSchema.nullable(),
  observedAt: z.string().nullable(),
  retrievedAt: z.string(),
  reviewedOn: z.string().min(1),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  sourcePolicyId: z.string(),
  factualReviewerRef: z.string(),
  rightsReviewerRef: z.string(),
  policyName: z.string(),
  policyAttribution: z.string(),
});
