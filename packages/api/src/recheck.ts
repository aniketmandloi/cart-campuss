import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { commitNeonHttpBatch, type Database } from "@cart-campuss/db";
import {
  publishingAuditEvent,
  publishingProjectionPointer,
  publishingPublishedAssertion,
  publishingRecheckTarget,
  publishingSourcePolicy,
  publishingStagedRecord,
  type PublishingMarketAccess,
  type RecheckKind,
  type RecheckPublicValue,
} from "@cart-campuss/db/schema/publishing";

import {
  PublishingRejected,
  assertOperatorAuthorized,
  assertionCapturedAt,
  publicPolicyAllows,
  publishingWriteLock,
  type PublicFact,
  type PublishingDeps,
} from "./publishing";

export const EDITORIAL_SPECIFICATION_RECHECK_SECONDS = 90 * 24 * 60 * 60;
export const MODEL_PRICE_RECHECK_SECONDS = 7 * 24 * 60 * 60;
export const SOURCE_DIRECTORY_RECHECK_SECONDS = 30 * 24 * 60 * 60;
export const PRICE_TARGET_KEY = "price-reference";

const recheckKindSchema = z.enum([
  "editorial-specification",
  "model-price",
  "source-directory-url",
  "approved-feed",
]);

const outcomeSchema = z.object({
  providerKey: z.string().trim().min(1),
  externalId: z.string().trim().min(1),
  kind: recheckKindSchema,
  targetKey: z.string().trim().min(1),
  outcome: z.enum(["succeeded", "failed", "not-attempted"]),
  observedAt: z.iso.datetime().nullable().optional(),
  fetchedAt: z.iso.datetime().nullable().optional(),
  reviewedAt: z.iso.datetime().nullable().optional(),
  confirmedLifecycle: z.enum(["active", "ended", "unknown"]).optional(),
});

const reportSchema = z.object({
  outcomes: z.array(outcomeSchema).default([]),
});

const withdrawSchema = z.union([
  z.object({
    providerKey: z.string().trim().min(1),
    externalId: z.string().trim().min(1),
  }),
  z.object({
    canonicalSubjectId: z.string().trim().min(1).max(200),
  }),
]);

type RecheckOutcome = z.infer<typeof outcomeSchema>;
type WithdrawInput = z.infer<typeof withdrawSchema>;

type TargetDraft = {
  id: string;
  providerKey: string;
  externalId: string;
  canonicalSubjectId: string;
  kind: RecheckKind;
  targetKey: string;
  observedAt: string | null;
  fetchedAt: string | null;
  lastSuccessfulProviderSyncAt: string | null;
  lastReviewedAt: string | null;
  nextRecheckAt: string;
  intervalSeconds: number;
  freshness: "current" | "stale" | "not-checked";
  providerOutcome: "succeeded" | "failed" | "not-attempted";
  lifecycle: "active" | "ended" | "unknown" | null;
  suppressed: boolean;
  publicValue: RecheckPublicValue;
};

type AuditDraft = {
  kind:
    | "recheck-missed"
    | "recheck-succeeded"
    | "provider-failure"
    | "recheck-not-attempted"
    | "withdrawal"
    | "expiry"
    | "suspension";
  canonicalSubjectId: string | null;
  providerKey: string | null;
  externalId: string | null;
  targetKind: string | null;
  targetKey: string | null;
  summary: string;
};

export type RecheckCommandResult = {
  targets: Array<Omit<TargetDraft, "id" | "publicValue" | "intervalSeconds"> & { intervalSeconds: number }>;
  audits: Array<Omit<AuditDraft, "providerKey" | "externalId">>;
  rejected: Array<{
    code: "suspended" | "expired";
    providerKey: string;
    externalId: string;
    targetKey: string;
  }>;
};

type StoredAssertion = {
  providerKey: string;
  externalId: string;
  canonicalSubjectId: string;
  facts: unknown;
  priceReference: {
    amountMinor: number;
    currency: string;
    observedOn: string;
    retrievedOn: string;
    reviewedOn: string;
  } | null;
  marketAccess: PublishingMarketAccess | null;
  reviewedAt: string;
  capturedAt: string;
  permittedFields: string[];
  refreshIntervalSeconds: number;
  identityScope: string;
  suspended: boolean;
  permissionExpiresAt: string | null;
  retentionSeconds: number;
  public: boolean;
};

export async function runScheduledRecheck(
  deps: PublishingDeps,
  presentedToken: string | undefined,
  report: unknown = null,
): Promise<RecheckCommandResult> {
  assertOperatorAuthorized(deps.operatorToken, presentedToken);
  const parsedReport = parseReport(report);
  const now = (deps.now ?? (() => new Date()))();
  const reported = new Set(parsedReport.outcomes.map((outcome) => targetKey(outcome)));
  const assertions = await loadAssertions(deps.db, now);
  const existing = await loadTargets(deps.db);
  const byKey = new Map(existing.map((target) => [targetKey(target), target]));
  const seeds: TargetDraft[] = [];
  const audits: AuditDraft[] = [];
  const rejected: RecheckCommandResult["rejected"] = [];

  for (const assertion of assertions) {
    if (!assertion.public) continue;
    for (const draft of targetsFromAssertion(assertion)) {
      const key = targetKey(draft);
      if (byKey.has(key)) continue;
      const missed = reported.has(key) ? null : markMissed(draft, now);
      const stored = missed?.row ?? draft;
      byKey.set(key, stored);
      seeds.push(stored);
      if (missed) audits.push(missed.audit);
    }
  }

  for (const [key, target] of byKey) {
    if (seeds.some((seed) => targetKey(seed) === key) || reported.has(key)) continue;
    const missed = markMissed(target, now);
    if (!missed) continue;
    byKey.set(key, missed.row);
    audits.push(missed.audit);
  }

  for (const outcome of parsedReport.outcomes) {
    const assertion = assertions.find(
      (item) => item.providerKey === outcome.providerKey && item.externalId === outcome.externalId,
    );
    if (!assertion) {
      throw new PublishingRejected("validation", "The recheck report names a source copy that is not published.");
    }
    if (assertion.suspended || permissionExpired(assertion, now)) {
      rejected.push({
        code: assertion.suspended ? "suspended" : "expired",
        providerKey: outcome.providerKey,
        externalId: outcome.externalId,
        targetKey: outcome.targetKey,
      });
      audits.push({
        kind: assertion.suspended ? "suspension" : "expiry",
        canonicalSubjectId: assertion.canonicalSubjectId,
        providerKey: assertion.providerKey,
        externalId: assertion.externalId,
        targetKind: outcome.kind,
        targetKey: outcome.targetKey,
        summary: assertion.suspended
          ? "Suspended source added no public result."
          : "Expired source added no public result.",
      });
      continue;
    }
    const key = targetKey(outcome);
    const current = byKey.get(key);
    if (!current) {
      throw new PublishingRejected("validation", "The recheck report names a target that is not on the public projection.");
    }
    const applied = applyOutcome(current, outcome, now);
    byKey.set(key, applied.row);
    audits.push(applied.audit);
  }

  const finals = [...byKey.values()];
  const inserted = seeds.map((seed) => byKey.get(targetKey(seed)) ?? seed);
  const updates = finals.filter((target) => existing.some((item) => item.id === target.id) && changed(existing, target));
  const insertedIds = inserted.map((target) => target.id);
  try {
    await commitNeonHttpBatch(deps.db, [
      publishingWriteLock(deps.db),
      ...(inserted.length > 0 ? [deps.db.insert(publishingRecheckTarget).values(inserted)] : []),
      ...updates.map((target) =>
        deps.db.update(publishingRecheckTarget).set(targetPatch(target)).where(eq(publishingRecheckTarget.id, target.id)),
      ),
      // The snapshots were planned before the lock. A withdrawal can remove the source while this command waits.
      ...(insertedIds.length > 0 ? [dropUnpermittedSnapshots(deps.db, insertedIds, now)] : []),
      ...(audits.length > 0 ? [deps.db.insert(publishingAuditEvent).values(audits.map((audit) => auditRow(audit, now)))] : []),
    ]);
  } catch (error) {
    if (error instanceof PublishingRejected) throw error;
    throw new PublishingRejected(
      "partial",
      "The recheck did not commit, and the previous public projection was left unchanged.",
    );
  }

  return {
    targets: finals.map(presentTarget),
    audits: audits.map(presentAudit),
    rejected,
  };
}

export async function withdrawPublishedContent(
  deps: PublishingDeps,
  presentedToken: string | undefined,
  input: unknown,
): Promise<{ withdrawn: number; audits: RecheckCommandResult["audits"] }> {
  assertOperatorAuthorized(deps.operatorToken, presentedToken);
  const parsed = parseWithdraw(input);
  const now = (deps.now ?? (() => new Date()))();
  const match = withdrawalMatch(parsed);
  const summary = "Withdrawal removed the source copy from pages, search, and stored generations.";
  try {
    const [, audits, , , assertions] = await deps.db.batch([
      publishingWriteLock(deps.db),
      deps.db.insert(publishingAuditEvent).select(
        deps.db
          .select({
            id: sql<string>`gen_random_uuid()::text`.as("id"),
            occurredAt: sql<string>`cast(${now.toISOString()} as timestamptz)`.as("occurred_at"),
            kind: sql<string>`'withdrawal'`.as("kind"),
            canonicalSubjectId: publishingPublishedAssertion.canonicalSubjectId,
            providerKey: publishingPublishedAssertion.providerKey,
            externalId: publishingPublishedAssertion.externalId,
            targetKind: sql<string | null>`null`.as("target_kind"),
            targetKey: sql<string | null>`null`.as("target_key"),
            summary: sql<string>`${summary}`.as("summary"),
          })
          .from(publishingPublishedAssertion)
          .where(match),
      ).returning({
        kind: publishingAuditEvent.kind,
        canonicalSubjectId: publishingAuditEvent.canonicalSubjectId,
        targetKind: publishingAuditEvent.targetKind,
        targetKey: publishingAuditEvent.targetKey,
        summary: publishingAuditEvent.summary,
      }),
      deps.db.delete(publishingRecheckTarget).where(sql`exists (
        select 1 from ${publishingPublishedAssertion}
        where ${publishingPublishedAssertion.providerKey} = ${publishingRecheckTarget.providerKey}
          and ${publishingPublishedAssertion.externalId} = ${publishingRecheckTarget.externalId}
          and ${match}
      )`),
      deps.db.delete(publishingStagedRecord).where(sql`exists (
        select 1 from ${publishingPublishedAssertion}
        where ${publishingPublishedAssertion.providerKey} = ${publishingStagedRecord.providerKey}
          and ${publishingPublishedAssertion.externalId} = ${publishingStagedRecord.externalId}
          and ${match}
      )`),
      deps.db.delete(publishingPublishedAssertion).where(match).returning({ id: publishingPublishedAssertion.id }),
    ]);
    return {
      withdrawn: assertions.length,
      audits: audits.map((audit) => ({
        kind: audit.kind as AuditDraft["kind"],
        canonicalSubjectId: audit.canonicalSubjectId,
        targetKind: audit.targetKind,
        targetKey: audit.targetKey,
        summary: audit.summary,
      })),
    };
  } catch (error) {
    if (error instanceof PublishingRejected) throw error;
    throw new PublishingRejected(
      "partial",
      "The withdrawal did not commit, and the previous public projection was left unchanged.",
    );
  }
}

function dropUnpermittedSnapshots(db: Database, ids: string[], now: Date) {
  return db.delete(publishingRecheckTarget).where(sql`
    ${publishingRecheckTarget.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    and not exists (
      select 1
      from ${publishingPublishedAssertion}
      inner join ${publishingProjectionPointer}
        on ${publishingPublishedAssertion.generationId} = ${publishingProjectionPointer.generationId}
        and ${publishingProjectionPointer.id} = 1
      inner join ${publishingSourcePolicy}
        on ${publishingSourcePolicy.id} = ${publishingPublishedAssertion.sourcePolicyId}
      where ${publishingPublishedAssertion.providerKey} = ${publishingRecheckTarget.providerKey}
        and ${publishingPublishedAssertion.externalId} = ${publishingRecheckTarget.externalId}
        and ${publicPolicyAllows(assertionCapturedAt(), now)}
    )
  `);
}

function parseReport(report: unknown): z.infer<typeof reportSchema> {
  if (report == null || report === "") return { outcomes: [] };
  let value: unknown = report;
  if (typeof report === "string") {
    try {
      value = JSON.parse(report) as unknown;
    } catch {
      throw new PublishingRejected("validation", "Recheck report was not valid JSON.");
    }
  }
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) throw new PublishingRejected("validation", "Recheck report did not match the schedule.");
  return parsed.data;
}

function parseWithdraw(input: unknown): WithdrawInput {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      throw new PublishingRejected("validation", "Withdrawal file was not valid JSON.");
    }
  }
  const parsed = withdrawSchema.safeParse(value);
  if (!parsed.success) throw new PublishingRejected("validation", "Withdrawal did not name a published source copy.");
  return parsed.data;
}

function withdrawalMatch(input: WithdrawInput) {
  if ("canonicalSubjectId" in input) {
    return eq(publishingPublishedAssertion.canonicalSubjectId, input.canonicalSubjectId);
  }
  return and(
    eq(publishingPublishedAssertion.providerKey, input.providerKey),
    eq(publishingPublishedAssertion.externalId, input.externalId),
  );
}

async function loadAssertions(db: Database, now: Date): Promise<StoredAssertion[]> {
  const rows = await db
    .select({
      providerKey: publishingPublishedAssertion.providerKey,
      externalId: publishingPublishedAssertion.externalId,
      canonicalSubjectId: publishingPublishedAssertion.canonicalSubjectId,
      facts: publishingPublishedAssertion.facts,
      priceReference: publishingPublishedAssertion.priceReference,
      marketAccess: publishingPublishedAssertion.marketAccess,
      reviewedAt: publishingPublishedAssertion.reviewedAt,
      capturedAt: publishingPublishedAssertion.capturedAt,
      permittedFields: publishingSourcePolicy.permittedFields,
      refreshIntervalSeconds: publishingSourcePolicy.refreshIntervalSeconds,
      identityScope: publishingPublishedAssertion.identityScope,
      suspended: publishingSourcePolicy.suspended,
      permissionExpiresAt: publishingSourcePolicy.permissionExpiresAt,
      retentionSeconds: publishingSourcePolicy.retentionSeconds,
      factPermission: publishingSourcePolicy.factPermission,
      reviewerRef: publishingSourcePolicy.reviewerRef,
      policyReviewedAt: publishingSourcePolicy.reviewedAt,
    })
    .from(publishingPublishedAssertion)
    .innerJoin(
      publishingSourcePolicy,
      eq(publishingSourcePolicy.id, publishingPublishedAssertion.sourcePolicyId),
    )
    .where(sql`exists (
      select 1 from publishing_projection_pointer
      where publishing_projection_pointer.id = 1
        and publishing_projection_pointer.generation_id = ${publishingPublishedAssertion.generationId}
    )`);
  return rows.map((row) => {
    const captured = new Date(row.capturedAt).getTime();
    const expires = row.permissionExpiresAt ? new Date(row.permissionExpiresAt).getTime() : null;
    const due =
      row.suspended ||
      row.retentionSeconds <= 0 ||
      (expires !== null && expires <= now.getTime()) ||
      captured + row.retentionSeconds * 1000 <= now.getTime();
    const permitted =
      row.factPermission === "permitted" &&
      row.reviewerRef !== null &&
      row.policyReviewedAt !== null &&
      !due;
    return {
      providerKey: row.providerKey,
      externalId: row.externalId,
      canonicalSubjectId: row.canonicalSubjectId,
      facts: row.facts,
      priceReference: row.priceReference,
      marketAccess: row.marketAccess,
      reviewedAt: toIso(row.reviewedAt),
      capturedAt: toIso(row.capturedAt),
      permittedFields: row.permittedFields,
      refreshIntervalSeconds: row.refreshIntervalSeconds,
      identityScope: row.identityScope,
      suspended: row.suspended,
      permissionExpiresAt: row.permissionExpiresAt ? toIso(row.permissionExpiresAt) : null,
      retentionSeconds: row.retentionSeconds,
      public: permitted,
    };
  });
}

async function loadTargets(db: Database): Promise<TargetDraft[]> {
  const rows = await db.select().from(publishingRecheckTarget);
  return rows.map((row) => ({
    id: row.id,
    providerKey: row.providerKey,
    externalId: row.externalId,
    canonicalSubjectId: row.canonicalSubjectId,
    kind: row.kind,
    targetKey: row.targetKey,
    observedAt: row.observedAt ? toIso(row.observedAt) : null,
    fetchedAt: row.fetchedAt ? toIso(row.fetchedAt) : null,
    lastSuccessfulProviderSyncAt: row.lastSuccessfulProviderSyncAt
      ? toIso(row.lastSuccessfulProviderSyncAt)
      : null,
    lastReviewedAt: row.lastReviewedAt ? toIso(row.lastReviewedAt) : null,
    nextRecheckAt: toIso(row.nextRecheckAt),
    intervalSeconds: row.intervalSeconds,
    freshness: freshnessOf(row.freshness),
    providerOutcome: outcomeOf(row.providerOutcome),
    lifecycle: lifecycleOf(row.lifecycle),
    suppressed: row.suppressed,
    publicValue: row.publicValue ?? {},
  }));
}

function targetsFromAssertion(assertion: StoredAssertion): TargetDraft[] {
  if (assertion.identityScope !== "applicability") return specificationTargets(assertion);
  return [
    ...specificationTargets(assertion),
    ...priceTargets(assertion),
    ...directoryTargets(assertion),
    ...feedTargets(assertion),
  ];
}

function specificationTargets(assertion: StoredAssertion): TargetDraft[] {
  return publicFacts(assertion.facts)
    .filter((fact) => assertion.permittedFields.includes(fact.property))
    .map((fact) =>
      draft({
        assertion,
        kind: "editorial-specification",
        targetKey: fact.property,
        observedAt: fact.observedAt,
        fetchedAt: fact.retrievedAt,
        reviewedAt: assertion.reviewedAt,
        intervalSeconds: EDITORIAL_SPECIFICATION_RECHECK_SECONDS,
        lifecycle: null,
        publicValue: {
          state: fact.state,
          rawValue: fact.state === "known" ? fact.rawValue : "",
          normalizedValue: fact.state === "known" ? fact.normalizedValue : null,
        },
      }),
    );
}

function priceTargets(assertion: StoredAssertion): TargetDraft[] {
  const price = assertion.priceReference;
  if (!price || !assertion.permittedFields.includes("priceReference")) return [];
  const reviewed = parseInstant(price.reviewedOn);
  const observed = parseInstant(price.observedOn);
  const fetched = parseInstant(price.retrievedOn);
  if (!reviewed || !fetched) return [];
  return [
    draft({
      assertion,
      kind: "model-price",
      targetKey: PRICE_TARGET_KEY,
      observedAt: observed?.toISOString() ?? null,
      fetchedAt: fetched.toISOString(),
      reviewedAt: reviewed.toISOString(),
      intervalSeconds: MODEL_PRICE_RECHECK_SECONDS,
      lifecycle: null,
      publicValue: { amountMinor: price.amountMinor, currency: price.currency },
    }),
  ];
}

function directoryTargets(assertion: StoredAssertion): TargetDraft[] {
  if (!assertion.permittedFields.includes("sourceDirectory")) return [];
  return (assertion.marketAccess?.sourceDirectory ?? []).flatMap((entry) => {
    const reviewed = parseInstant(entry.reviewedAt);
    const fetched = parseInstant(entry.retrievedAt);
    if (!reviewed || !fetched) return [];
    return [
      draft({
        assertion,
        kind: "source-directory-url",
        targetKey: entry.url,
        observedAt: entry.observedAt,
        fetchedAt: fetched.toISOString(),
        reviewedAt: reviewed.toISOString(),
        intervalSeconds: SOURCE_DIRECTORY_RECHECK_SECONDS,
        lifecycle: null,
        publicValue: { title: entry.title, url: entry.url },
      }),
    ];
  });
}

function feedTargets(assertion: StoredAssertion): TargetDraft[] {
  if (!assertion.permittedFields.includes("approvedFeed")) return [];
  if (assertion.refreshIntervalSeconds <= 0) return [];
  return (assertion.marketAccess?.listings ?? []).flatMap((listing) => {
    const reviewed = parseInstant(listing.reviewedAt);
    const fetched = parseInstant(listing.retrievedAt);
    const observed = parseInstant(listing.observedAt);
    if (!reviewed || !fetched || !observed) return [];
    return [
      draft({
        assertion,
        kind: "approved-feed",
        targetKey: listing.externalId,
        observedAt: observed.toISOString(),
        fetchedAt: fetched.toISOString(),
        reviewedAt: reviewed.toISOString(),
        intervalSeconds: assertion.refreshIntervalSeconds,
        lifecycle: listing.lifecycle,
        publicValue: {
          title: listing.title,
          url: listing.url,
          priceType: listing.priceType,
          amountMinor: listing.amountMinor,
          currency: listing.currency,
        },
      }),
    ];
  });
}

function draft(input: {
  assertion: StoredAssertion;
  kind: RecheckKind;
  targetKey: string;
  observedAt: string | null;
  fetchedAt: string;
  reviewedAt: string;
  intervalSeconds: number;
  lifecycle: TargetDraft["lifecycle"];
  publicValue: RecheckPublicValue;
}): TargetDraft {
  const anchor = parseInstant(input.reviewedAt) ?? parseInstant(input.fetchedAt);
  const nextRecheckAt = anchor
    ? addSeconds(anchor, input.intervalSeconds)
    : new Date(0).toISOString();
  return {
    id: crypto.randomUUID(),
    providerKey: input.assertion.providerKey,
    externalId: input.assertion.externalId,
    canonicalSubjectId: input.assertion.canonicalSubjectId,
    kind: input.kind,
    targetKey: input.targetKey,
    observedAt: input.observedAt,
    fetchedAt: input.fetchedAt,
    lastSuccessfulProviderSyncAt: input.fetchedAt,
    lastReviewedAt: input.reviewedAt,
    nextRecheckAt,
    intervalSeconds: input.intervalSeconds,
    freshness: "current",
    providerOutcome: "succeeded",
    lifecycle: input.lifecycle,
    suppressed: false,
    publicValue: input.publicValue,
  };
}

function markMissed(target: TargetDraft, now: Date): { row: TargetDraft; audit: AuditDraft } | null {
  if (!intervalMissed(target, now)) return null;
  const freshness = target.lastReviewedAt ? "stale" : "not-checked";
  const suppressed = target.kind === "approved-feed" ? true : target.suppressed;
  if (target.freshness === freshness && target.suppressed === suppressed) return null;
  return {
    row: { ...target, freshness, suppressed },
    audit: auditFor(target, "recheck-missed", "Recheck interval missed. The last review was kept and the value was not changed to zero."),
  };
}

function applyOutcome(
  target: TargetDraft,
  outcome: RecheckOutcome,
  now: Date,
): { row: TargetDraft; audit: AuditDraft } {
  if (outcome.outcome === "succeeded") {
    const sync = outcome.fetchedAt ?? outcome.observedAt ?? outcome.reviewedAt ?? now.toISOString();
    const reviewed = outcome.reviewedAt ?? target.lastReviewedAt ?? sync;
    const anchor = parseInstant(reviewed) ?? parseInstant(sync) ?? now;
    return {
      row: {
        ...target,
        observedAt: outcome.observedAt ?? target.observedAt,
        fetchedAt: outcome.fetchedAt ?? target.fetchedAt,
        lastSuccessfulProviderSyncAt: sync,
        lastReviewedAt: reviewed,
        nextRecheckAt: addSeconds(anchor, target.intervalSeconds),
        freshness: "current",
        providerOutcome: "succeeded",
        suppressed: false,
        lifecycle: outcome.confirmedLifecycle ?? target.lifecycle,
      },
      audit: auditFor(target, "recheck-succeeded", "Recheck succeeded. The public value was left unchanged."),
    };
  }
  const keepWithheld = target.suppressed || target.freshness === "stale";
  const failed = outcome.outcome === "failed";
  return {
    row: {
      ...target,
      freshness: keepWithheld ? target.freshness : "not-checked",
      providerOutcome: failed ? "failed" : "not-attempted",
      suppressed: keepWithheld ? target.suppressed : false,
    },
    audit: auditFor(
      target,
      failed ? "provider-failure" : "recheck-not-attempted",
      failed
        ? "Provider check failed. Permitted history was kept and no listing was marked ended or sold."
        : "Recheck was not attempted. The last review and public value were kept.",
    ),
  };
}

function intervalMissed(target: TargetDraft, now: Date): boolean {
  if (new Date(target.nextRecheckAt).getTime() > now.getTime()) return false;
  if (target.kind === "approved-feed" && target.lifecycle === "ended" && target.providerOutcome === "succeeded") {
    return false;
  }
  if (target.kind === "approved-feed") {
    return target.freshness === "current" || (target.providerOutcome === "failed" && !target.suppressed);
  }
  return target.freshness === "current";
}

function auditFor(target: TargetDraft, kind: AuditDraft["kind"], summary: string): AuditDraft {
  return {
    kind,
    canonicalSubjectId: target.canonicalSubjectId,
    providerKey: target.providerKey,
    externalId: target.externalId,
    targetKind: target.kind,
    targetKey: target.targetKey,
    summary,
  };
}

function auditRow(audit: AuditDraft, now: Date) {
  return {
    id: crypto.randomUUID(),
    occurredAt: now.toISOString(),
    kind: audit.kind,
    canonicalSubjectId: audit.canonicalSubjectId,
    providerKey: audit.providerKey,
    externalId: audit.externalId,
    targetKind: audit.targetKind,
    targetKey: audit.targetKey,
    summary: audit.summary,
  };
}

function targetPatch(target: TargetDraft) {
  return {
    observedAt: target.observedAt,
    fetchedAt: target.fetchedAt,
    lastSuccessfulProviderSyncAt: target.lastSuccessfulProviderSyncAt,
    lastReviewedAt: target.lastReviewedAt,
    nextRecheckAt: target.nextRecheckAt,
    freshness: target.freshness,
    providerOutcome: target.providerOutcome,
    lifecycle: target.lifecycle,
    suppressed: target.suppressed,
    publicValue: target.publicValue,
  };
}

function changed(existing: TargetDraft[], target: TargetDraft): boolean {
  const previous = existing.find((item) => item.id === target.id);
  if (!previous) return false;
  return JSON.stringify(targetPatch(previous)) !== JSON.stringify(targetPatch(target));
}

function presentTarget(target: TargetDraft): RecheckCommandResult["targets"][number] {
  return {
    providerKey: target.providerKey,
    externalId: target.externalId,
    canonicalSubjectId: target.canonicalSubjectId,
    kind: target.kind,
    targetKey: target.targetKey,
    observedAt: target.observedAt,
    fetchedAt: target.fetchedAt,
    lastSuccessfulProviderSyncAt: target.lastSuccessfulProviderSyncAt,
    lastReviewedAt: target.lastReviewedAt,
    nextRecheckAt: target.nextRecheckAt,
    intervalSeconds: target.intervalSeconds,
    freshness: target.freshness,
    providerOutcome: target.providerOutcome,
    lifecycle: target.lifecycle,
    suppressed: target.suppressed,
  };
}

function presentAudit(audit: AuditDraft): RecheckCommandResult["audits"][number] {
  return {
    kind: audit.kind,
    canonicalSubjectId: audit.canonicalSubjectId,
    targetKind: audit.targetKind,
    targetKey: audit.targetKey,
    summary: audit.summary,
  };
}

function publicFacts(value: unknown): PublicFact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const fact = item as Partial<PublicFact>;
    if (typeof fact.property !== "string" || typeof fact.retrievedAt !== "string") return [];
    if (fact.state !== "known" && fact.state !== "unknown" && fact.state !== "not-applicable" && fact.state !== "withheld") {
      return [];
    }
    return [
      {
        property: fact.property,
        rawValue: typeof fact.rawValue === "string" ? fact.rawValue : "",
        normalizedValue: typeof fact.normalizedValue === "string" ? fact.normalizedValue : null,
        state: fact.state,
        unknownReason: typeof fact.unknownReason === "string" ? fact.unknownReason : null,
        unit: typeof fact.unit === "string" ? fact.unit : null,
        standard: typeof fact.standard === "string" ? fact.standard : null,
        freshness: fact.freshness === "stale" || fact.freshness === "not-checked" ? fact.freshness : "current",
        curatedReason: typeof fact.curatedReason === "string" ? fact.curatedReason : null,
        conflict: null,
        sourceUrl: typeof fact.sourceUrl === "string" ? fact.sourceUrl : null,
        sourceTitle: typeof fact.sourceTitle === "string" ? fact.sourceTitle : null,
        providerKey: typeof fact.providerKey === "string" ? fact.providerKey : "",
        observedAt: typeof fact.observedAt === "string" ? fact.observedAt : null,
        retrievedAt: fact.retrievedAt,
        sourcePolicyId: typeof fact.sourcePolicyId === "string" ? fact.sourcePolicyId : "",
        factualReviewerRef: typeof fact.factualReviewerRef === "string" ? fact.factualReviewerRef : "",
        rightsReviewerRef: typeof fact.rightsReviewerRef === "string" ? fact.rightsReviewerRef : "",
      },
    ];
  });
}

function permissionExpired(assertion: StoredAssertion, now: Date): boolean {
  const expires = assertion.permissionExpiresAt ? new Date(assertion.permissionExpiresAt).getTime() : null;
  const captured = new Date(assertion.capturedAt).getTime();
  return (
    assertion.retentionSeconds <= 0 ||
    (expires !== null && expires <= now.getTime()) ||
    captured + assertion.retentionSeconds * 1000 <= now.getTime()
  );
}

function targetKey(target: { providerKey: string; externalId: string; kind: string; targetKey: string }): string {
  return `${target.providerKey}\0${target.externalId}\0${target.kind}\0${target.targetKey}`;
}

function parseInstant(value: string | null): Date | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addSeconds(instant: Date, seconds: number): string {
  return new Date(instant.getTime() + seconds * 1000).toISOString();
}

function toIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
}

function freshnessOf(value: string): TargetDraft["freshness"] {
  if (value === "stale" || value === "not-checked") return value;
  return "current";
}

function outcomeOf(value: string): TargetDraft["providerOutcome"] {
  if (value === "failed" || value === "not-attempted") return value;
  return "succeeded";
}

function lifecycleOf(value: string | null): TargetDraft["lifecycle"] {
  if (value === "active" || value === "ended" || value === "unknown") return value;
  return null;
}
