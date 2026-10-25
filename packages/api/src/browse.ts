import {
  catalogueApplicability,
  catalogueBrand,
  catalogueCollection,
  catalogueCollectionMember,
  catalogueGeneration,
  catalogueMarketVariant,
  catalogueModel,
  catalogueSourcePolicy,
} from "@cart-campuss/db/schema/catalogue";
import {
  publishingProjectionGeneration,
  publishingProjectionPointer,
} from "@cart-campuss/db/schema/publishing";
import type { Database } from "@cart-campuss/db";
import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import { applicabilityIsVisible, generationIsVisible, type CatalogueMiss } from "./catalogue";
import type { CatalogueAccess } from "./context";
import { catalogueModelHref } from "./dossier";
import { currentCollectionProjectionCovers, currentScopedProjectionCovers, publicMetadataEligible } from "./publishing";
import {
  REGISTRATION_JURISDICTIONS,
  registrationJurisdiction,
  type RegistrationJurisdiction,
} from "./registration-jurisdiction";

export type CatalogueCoverage = {
  publishedOn: string | null;
  brands: number;
  models: number;
  applicabilityRecords: number;
};

export type CatalogueBrandSummary = {
  name: string;
  slug: string;
  href: string;
  modelCount: number;
  synthetic: boolean;
};

export type CatalogueCollectionMemberView = {
  brandName: string;
  modelName: string;
  generationName: string | null;
  href: string;
  synthetic: boolean;
};

export type CatalogueCollectionView = {
  name: string;
  slug: string;
  summary: string;
  synthetic: boolean;
  members: CatalogueCollectionMemberView[];
};

export type CatalogueHome = {
  privatePreview: boolean;
  registration: RegistrationJurisdiction | null;
  jurisdictions: readonly RegistrationJurisdiction[];
  coverage: CatalogueCoverage;
  brands: CatalogueBrandSummary[];
  fixtureBrands: CatalogueBrandSummary[];
  collections: CatalogueCollectionView[];
  fixtureCollections: CatalogueCollectionView[];
};

export type BrandRecordStatus = "applicability" | "generation" | "model";

export type BrandRecordGroup = {
  modelName: string;
  modelSlug: string;
  generationId: string | null;
  generationName: string | null;
  status: BrandRecordStatus;
  recordCount: number;
  href: string;
  synthetic: boolean;
};

export type BrandChip = {
  label: string;
  href: string;
  count: number;
  current: boolean;
};

export type CatalogueBrandPage =
  | { availability: "not-in-public-catalogue"; privatePreview: boolean }
  | {
      availability: "visible";
      privatePreview: boolean;
      brandName: string;
      brandSlug: string;
      synthetic: boolean;
      registration: RegistrationJurisdiction | null;
      narrowed: boolean;
      publicGroups: BrandRecordGroup[];
      syntheticGroups: BrandRecordGroup[];
      chips: BrandChip[];
    };

export type BrandSelection = {
  brandSlug: string;
  generation?: string;
  status?: BrandRecordStatus;
  registration?: string;
};

type ApplicabilitySight = {
  brandId: string;
  brandName: string;
  brandSlug: string;
  modelId: string;
  modelName: string;
  modelSlug: string;
  generationId: string;
  generationName: string;
  generationSlug: string;
  applicabilityId: string;
  synthetic: boolean;
};

type GenerationSight = {
  brandId: string;
  brandName: string;
  brandSlug: string;
  modelId: string;
  modelName: string;
  modelSlug: string;
  generationId: string;
  generationName: string;
  generationSlug: string;
  synthetic: boolean;
};

type ModelSight = {
  brandId: string;
  brandName: string;
  brandSlug: string;
  modelId: string;
  modelName: string;
  modelSlug: string;
};

type ModelEntry = ModelSight & { synthetic: boolean };

type CatalogueSights = {
  applicability: ApplicabilitySight[];
  generations: GenerationSight[];
  models: ModelSight[];
};

const STATUS_LABEL: Record<BrandRecordStatus, string> = {
  applicability: "Applicability records",
  generation: "Generation records",
  model: "Model records",
};

const STATUS_ORDER: BrandRecordStatus[] = ["applicability", "generation", "model"];

export async function readCatalogueHome(
  db: Database,
  access: CatalogueAccess,
  registrationId: string | undefined,
  now: () => Date = () => new Date(),
): Promise<CatalogueHome> {
  const clock = now();
  const registration = registrationJurisdiction(registrationId);
  const sights = await loadSights(db, access, clock);
  const coverage = coverageOf(sights, await projectionPublishedOn(db));
  const { brands, fixtureBrands } = brandSummaries(sights, access, registration);
  const { collections, fixtureCollections } = await collectionViews(db, access, clock, sights, registration);
  return {
    privatePreview: access.allowFixtures,
    registration,
    jurisdictions: REGISTRATION_JURISDICTIONS,
    coverage,
    brands,
    fixtureBrands,
    collections,
    fixtureCollections,
  };
}

export async function readCatalogueBrand(
  db: Database,
  access: CatalogueAccess,
  selection: BrandSelection,
  now: () => Date = () => new Date(),
): Promise<CatalogueBrandPage> {
  const privatePreview = access.allowFixtures;
  const registration = registrationJurisdiction(selection.registration);
  const sights = await loadSights(db, access, now());
  const publicGroups = groupsFor(sights, selection.brandSlug, false, registration);
  const syntheticGroups = access.allowFixtures
    ? groupsFor(sights, selection.brandSlug, true, registration)
    : [];
  if (publicGroups.length === 0 && syntheticGroups.length === 0) {
    return { availability: "not-in-public-catalogue", privatePreview };
  }
  const named = publicGroups[0] ?? syntheticGroups[0];
  if (!named) return { availability: "not-in-public-catalogue", privatePreview };
  const brandName = brandNameFor(sights, selection.brandSlug) ?? named.modelName;
  const narrowed = Boolean(selection.status || selection.generation);
  const visible = publicGroups.filter(
    (group) =>
      (!selection.status || group.status === selection.status) &&
      (!selection.generation || group.generationId === selection.generation),
  );
  return {
    availability: "visible",
    privatePreview,
    brandName,
    brandSlug: selection.brandSlug,
    synthetic: publicGroups.length === 0,
    registration,
    narrowed,
    publicGroups: visible,
    syntheticGroups,
    chips: chipsFor(selection.brandSlug, publicGroups, selection, registration),
  };
}

async function loadSights(db: Database, access: CatalogueAccess, now: Date): Promise<CatalogueSights> {
  const applicability = (
    await db
      .select({
        brandId: catalogueBrand.id,
        brandName: catalogueBrand.name,
        brandSlug: catalogueBrand.slug,
        modelId: catalogueModel.id,
        modelName: catalogueModel.name,
        modelSlug: catalogueModel.slug,
        generationId: catalogueGeneration.id,
        generationName: catalogueGeneration.name,
        generationSlug: catalogueGeneration.slug,
        applicabilityId: catalogueApplicability.id,
        synthetic: catalogueApplicability.synthetic,
      })
      .from(catalogueApplicability)
      .innerJoin(
        catalogueMarketVariant,
        eq(catalogueApplicability.marketVariantId, catalogueMarketVariant.id),
      )
      .innerJoin(catalogueGeneration, eq(catalogueMarketVariant.generationId, catalogueGeneration.id))
      .innerJoin(catalogueModel, eq(catalogueGeneration.modelId, catalogueModel.id))
      .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
      .innerJoin(
        catalogueSourcePolicy,
        eq(catalogueApplicability.sourcePolicyId, catalogueSourcePolicy.id),
      )
      .where(applicabilityIsVisible(access, now))
  ).filter((row) =>
    keep(access, row.synthetic, [
      row.brandName,
      row.brandSlug,
      row.modelName,
      row.modelSlug,
      row.generationName,
      row.generationSlug,
    ]),
  );

  const occupied = new Set(applicability.map((row) => row.generationId));
  const generations = (
    await db
      .select({
        brandId: catalogueBrand.id,
        brandName: catalogueBrand.name,
        brandSlug: catalogueBrand.slug,
        modelId: catalogueModel.id,
        modelName: catalogueModel.name,
        modelSlug: catalogueModel.slug,
        generationId: catalogueGeneration.id,
        generationName: catalogueGeneration.name,
        generationSlug: catalogueGeneration.slug,
        synthetic: catalogueGeneration.synthetic,
      })
      .from(catalogueGeneration)
      .innerJoin(catalogueModel, eq(catalogueGeneration.modelId, catalogueModel.id))
      .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
      .leftJoin(
        catalogueSourcePolicy,
        eq(catalogueGeneration.sourcePolicyId, catalogueSourcePolicy.id),
      )
      .where(generationIsVisible(access, now))
  ).filter(
    (row) =>
      !occupied.has(row.generationId) &&
      keep(access, row.synthetic, [
        row.brandName,
        row.brandSlug,
        row.modelName,
        row.modelSlug,
        row.generationName,
        row.generationSlug,
      ]),
  );

  const occupiedModels = new Set([
    ...applicability.map((row) => row.modelId),
    ...generations.map((row) => row.modelId),
  ]);
  const models = (
    await db
      .select({
        brandId: catalogueBrand.id,
        brandName: catalogueBrand.name,
        brandSlug: catalogueBrand.slug,
        modelId: catalogueModel.id,
        modelName: catalogueModel.name,
        modelSlug: catalogueModel.slug,
      })
      .from(catalogueModel)
      .innerJoin(catalogueBrand, eq(catalogueModel.brandId, catalogueBrand.id))
      .where(currentScopedProjectionCovers(catalogueModel.id, "model", now))
  ).filter(
    (row) =>
      !occupiedModels.has(row.modelId) &&
      keep(access, false, [row.brandName, row.brandSlug, row.modelName, row.modelSlug]),
  );

  return { applicability, generations, models };
}

export async function listPublishedModels(
  db: Database,
  access: CatalogueAccess,
  now: () => Date = () => new Date(),
): Promise<CatalogueMiss> {
  const clock = now();
  const sights = await loadSights(db, access, clock);
  const coverage = coverageOf(sights, await projectionPublishedOn(db));
  const models = publicModels(sights).sort(
    (left, right) =>
      left.brandName.localeCompare(right.brandName) ||
      left.modelName.localeCompare(right.modelName) ||
      left.modelSlug.localeCompare(right.modelSlug),
  );
  return {
    publishedOn: coverage.publishedOn,
    brands: coverage.brands,
    models: coverage.models,
    applicabilityRecords: coverage.applicabilityRecords,
    publishedModels: models.slice(0, 12).map((model) => ({
      brandName: model.brandName,
      modelName: model.modelName,
      href: catalogueModelHref({ modelSlug: model.modelSlug }),
    })),
  };
}

function keep(access: CatalogueAccess, synthetic: boolean, values: string[]): boolean {
  if (synthetic && !access.allowFixtures) return false;
  return publicMetadataEligible(values);
}

async function projectionPublishedOn(db: Database): Promise<string | null> {
  const [row] = await db
    .select({ publishedAt: publishingProjectionGeneration.publishedAt })
    .from(publishingProjectionPointer)
    .innerJoin(
      publishingProjectionGeneration,
      eq(publishingProjectionGeneration.id, publishingProjectionPointer.generationId),
    )
    .where(eq(publishingProjectionPointer.id, 1))
    .limit(1);
  if (!row) return null;
  const parsed = new Date(row.publishedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function coverageOf(sights: CatalogueSights, publishedOn: string | null): CatalogueCoverage {
  const models = publicModels(sights);
  return {
    publishedOn,
    brands: new Set(models.map((model) => model.brandId)).size,
    models: models.length,
    applicabilityRecords: sights.applicability.filter((row) => !row.synthetic).length,
  };
}

function publicModels(sights: CatalogueSights): ModelEntry[] {
  return [...modelEntries(sights).values()].filter((model) => !model.synthetic);
}

function modelEntries(sights: CatalogueSights): Map<string, ModelEntry> {
  const models = new Map<string, ModelEntry>();
  const note = (row: ModelEntry) => {
    const existing = models.get(row.modelId);
    if (!existing) {
      models.set(row.modelId, { ...row });
      return;
    }
    if (!row.synthetic) existing.synthetic = false;
  };
  for (const row of sights.applicability) note(row);
  for (const row of sights.generations) note(row);
  for (const row of sights.models) note({ ...row, synthetic: false });
  return models;
}

function brandSummaries(
  sights: CatalogueSights,
  access: CatalogueAccess,
  registration: RegistrationJurisdiction | null,
): { brands: CatalogueBrandSummary[]; fixtureBrands: CatalogueBrandSummary[] } {
  const byBrand = new Map<string, { name: string; slug: string; publicModels: number; fixtureModels: number }>();
  for (const model of modelEntries(sights).values()) {
    const brand = byBrand.get(model.brandId) ?? {
      name: model.brandName,
      slug: model.brandSlug,
      publicModels: 0,
      fixtureModels: 0,
    };
    if (model.synthetic) brand.fixtureModels += 1;
    else brand.publicModels += 1;
    byBrand.set(model.brandId, brand);
  }
  const brands: CatalogueBrandSummary[] = [];
  const fixtureBrands: CatalogueBrandSummary[] = [];
  for (const brand of byBrand.values()) {
    if (brand.publicModels > 0) {
      brands.push({
        name: brand.name,
        slug: brand.slug,
        href: placeHref(`/brands/${brand.slug}`, registration),
        modelCount: brand.publicModels,
        synthetic: false,
      });
    } else if (access.allowFixtures && brand.fixtureModels > 0) {
      fixtureBrands.push({
        name: brand.name,
        slug: brand.slug,
        href: placeHref(`/brands/${brand.slug}`, registration),
        modelCount: brand.fixtureModels,
        synthetic: true,
      });
    }
  }
  const byName = (left: CatalogueBrandSummary, right: CatalogueBrandSummary) =>
    left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug);
  brands.sort(byName);
  fixtureBrands.sort(byName);
  return { brands, fixtureBrands };
}

async function collectionViews(
  db: Database,
  access: CatalogueAccess,
  now: Date,
  sights: CatalogueSights,
  registration: RegistrationJurisdiction | null,
): Promise<{ collections: CatalogueCollectionView[]; fixtureCollections: CatalogueCollectionView[] }> {
  const rows = (
    await db
      .select({
        id: catalogueCollection.id,
        slug: catalogueCollection.slug,
        name: catalogueCollection.name,
        summary: catalogueCollection.summary,
        synthetic: catalogueCollection.synthetic,
      })
      .from(catalogueCollection)
      .innerJoin(
        catalogueSourcePolicy,
        eq(catalogueCollection.sourcePolicyId, catalogueSourcePolicy.id),
      )
      .where(collectionIsVisible(access, now))
      .orderBy(asc(catalogueCollection.name), asc(catalogueCollection.slug))
  ).filter((row) => keep(access, row.synthetic, [row.name, row.slug, row.summary]));
  if (rows.length === 0) return { collections: [], fixtureCollections: [] };

  const members = await db
    .select({
      collectionId: catalogueCollectionMember.collectionId,
      modelId: catalogueCollectionMember.modelId,
      generationId: catalogueCollectionMember.generationId,
      sortOrder: catalogueCollectionMember.sortOrder,
    })
    .from(catalogueCollectionMember)
    .where(
      inArray(
        catalogueCollectionMember.collectionId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(catalogueCollectionMember.sortOrder), asc(catalogueCollectionMember.id));

  const collections: CatalogueCollectionView[] = [];
  const fixtureCollections: CatalogueCollectionView[] = [];
  for (const row of rows) {
    const view: CatalogueCollectionView = {
      name: row.name,
      slug: row.slug,
      summary: row.summary,
      synthetic: row.synthetic,
      members: members
        .filter((member) => member.collectionId === row.id)
        .flatMap((member) => memberView(sights, member, registration)),
    };
    if (row.synthetic) fixtureCollections.push(view);
    else collections.push(view);
  }
  return { collections, fixtureCollections };
}

function memberView(
  sights: CatalogueSights,
  member: { modelId: string | null; generationId: string | null },
  registration: RegistrationJurisdiction | null,
): CatalogueCollectionMemberView[] {
  if (member.generationId) {
    const target = generationTarget(sights, member.generationId);
    if (!target) return [];
    return [
      {
        brandName: target.brandName,
        modelName: target.modelName,
        generationName: target.generationName,
        href: placeHref(`/cars/${target.modelSlug}/${target.generationSlug}`, registration),
        synthetic: target.synthetic,
      },
    ];
  }
  if (!member.modelId) return [];
  const target = modelEntries(sights).get(member.modelId);
  if (!target) return [];
  return [
    {
      brandName: target.brandName,
      modelName: target.modelName,
      generationName: null,
      href: placeHref(`/cars/${target.modelSlug}`, registration),
      synthetic: target.synthetic,
    },
  ];
}

function generationTarget(sights: CatalogueSights, generationId: string): GenerationSight | null {
  const applicability = sights.applicability.filter((row) => row.generationId === generationId);
  const published = applicability.find((row) => !row.synthetic);
  if (published) return { ...published, synthetic: false };
  const synthetic = applicability.find((row) => row.synthetic);
  if (synthetic) return synthetic;
  return sights.generations.find((row) => row.generationId === generationId) ?? null;
}

function groupsFor(
  sights: CatalogueSights,
  brandSlug: string,
  synthetic: boolean,
  registration: RegistrationJurisdiction | null,
): BrandRecordGroup[] {
  const applicability = sights.applicability.filter(
    (row) => row.brandSlug === brandSlug && row.synthetic === synthetic,
  );
  const byGeneration = new Map<string, ApplicabilitySight[]>();
  for (const row of applicability) {
    const group = byGeneration.get(row.generationId) ?? [];
    group.push(row);
    byGeneration.set(row.generationId, group);
  }
  const groups: BrandRecordGroup[] = [];
  for (const rows of byGeneration.values()) {
    const [first] = rows;
    if (!first) continue;
    groups.push({
      modelName: first.modelName,
      modelSlug: first.modelSlug,
      generationId: first.generationId,
      generationName: first.generationName,
      status: "applicability",
      recordCount: rows.length,
      href: placeHref(`/cars/${first.modelSlug}/${first.generationSlug}`, registration),
      synthetic,
    });
  }
  for (const row of sights.generations) {
    if (row.brandSlug !== brandSlug || row.synthetic !== synthetic || byGeneration.has(row.generationId)) continue;
    groups.push({
      modelName: row.modelName,
      modelSlug: row.modelSlug,
      generationId: row.generationId,
      generationName: row.generationName,
      status: "generation",
      recordCount: 1,
      href: placeHref(`/cars/${row.modelSlug}/${row.generationSlug}`, registration),
      synthetic,
    });
  }
  const groupedModels = new Set(groups.map((group) => group.modelSlug));
  for (const row of sights.models) {
    if (synthetic || row.brandSlug !== brandSlug || groupedModels.has(row.modelSlug)) continue;
    groups.push({
      modelName: row.modelName,
      modelSlug: row.modelSlug,
      generationId: null,
      generationName: null,
      status: "model",
      recordCount: 1,
      href: placeHref(`/cars/${row.modelSlug}`, registration),
      synthetic: false,
    });
  }
  groups.sort(
    (left, right) =>
      left.modelName.localeCompare(right.modelName) ||
      (left.generationName ?? "").localeCompare(right.generationName ?? "") ||
      left.status.localeCompare(right.status),
  );
  return groups;
}

function brandNameFor(sights: CatalogueSights, brandSlug: string): string | null {
  return (
    sights.applicability.find((row) => row.brandSlug === brandSlug)?.brandName ??
    sights.generations.find((row) => row.brandSlug === brandSlug)?.brandName ??
    sights.models.find((row) => row.brandSlug === brandSlug)?.brandName ??
    null
  );
}

function chipsFor(
  brandSlug: string,
  groups: BrandRecordGroup[],
  selection: BrandSelection,
  registration: RegistrationJurisdiction | null,
): BrandChip[] {
  const total = groups.reduce((sum, group) => sum + group.recordCount, 0);
  const chips: BrandChip[] = [
    {
      label: "All",
      href: placeHref(`/brands/${brandSlug}`, registration),
      count: total,
      current: !selection.status && !selection.generation,
    },
  ];
  for (const status of STATUS_ORDER) {
    const matching = groups.filter((group) => group.status === status);
    if (matching.length === 0) continue;
    chips.push({
      label: STATUS_LABEL[status],
      href: placeHref(`/brands/${brandSlug}`, registration, {
        ...(selection.generation ? { generation: selection.generation } : {}),
        status,
      }),
      count: matching.reduce((sum, group) => sum + group.recordCount, 0),
      current: selection.status === status,
    });
  }
  for (const group of groups) {
    if (!group.generationId || !group.generationName) continue;
    chips.push({
      label: group.generationName,
      href: placeHref(`/brands/${brandSlug}`, registration, {
        ...(selection.status ? { status: selection.status } : {}),
        generation: group.generationId,
      }),
      count: group.recordCount,
      current: selection.generation === group.generationId,
    });
  }
  return chips;
}

function collectionIsVisible(access: CatalogueAccess, now: Date): SQL {
  const published = and(
    eq(catalogueCollection.publicationStatus, "published"),
    eq(catalogueCollection.synthetic, false),
    eq(catalogueSourcePolicy.permitsPublicCatalogue, true),
    eq(catalogueSourcePolicy.audience, "public"),
    eq(catalogueSourcePolicy.rightsReview, "reviewed"),
    currentCollectionProjectionCovers(catalogueCollection.id, now),
  );
  if (!access.allowFixtures) return must(published);
  return must(
    or(
      published,
      and(
        eq(catalogueCollection.publicationStatus, "fixture"),
        eq(catalogueCollection.synthetic, true),
        eq(catalogueSourcePolicy.permitsPublicCatalogue, false),
        eq(catalogueSourcePolicy.audience, "private-preview"),
        eq(catalogueSourcePolicy.rightsReview, "reviewed"),
      ),
    ),
  );
}

function placeHref(
  path: string,
  registration: RegistrationJurisdiction | null,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  if (registration) params.set("registration", registration.id);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

function must(condition: SQL | undefined): SQL {
  return condition ?? sql`false`;
}
