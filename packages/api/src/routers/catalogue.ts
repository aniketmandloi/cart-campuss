import { z } from "zod";

import { listCatalogue } from "../catalogue-list";
import { catalogueListInput } from "../catalogue-filters";
import { readCatalogueBrand, readCatalogueHome } from "../browse";
import { catalogueStatus, readCatalogueCar, readCatalogueModel } from "../catalogue";
import { DOSSIER_SECTIONS } from "../dossier";
import { publicProcedure, router } from "../index";

const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/);
const canonicalId = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_-]+$/);

export const catalogueRouter = router({
  status: publicProcedure.query(({ ctx }) => catalogueStatus(ctx.access)),
  search: publicProcedure.input(catalogueListInput).query(({ ctx, input }) =>
    listCatalogue(ctx.db, ctx.access, input, ctx.now ?? (() => new Date())),
  ),
  read: publicProcedure
    .input(
      z.object({
        modelSlug: slug,
        generationSlug: slug,
        market: canonicalId.optional(),
        year: canonicalId.optional(),
        variant: canonicalId.optional(),
        section: z.enum(DOSSIER_SECTIONS).optional(),
        registration: canonicalId.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      readCatalogueCar(ctx.db, ctx.access, input, ctx.now ?? (() => new Date())),
    ),
  home: publicProcedure
    .input(z.object({ registration: canonicalId.optional() }))
    .query(({ ctx, input }) =>
      readCatalogueHome(ctx.db, ctx.access, input.registration, ctx.now ?? (() => new Date())),
    ),
  brand: publicProcedure
    .input(
      z.object({
        brandSlug: slug,
        generation: canonicalId.optional(),
        status: z.enum(["applicability", "generation", "model"]).optional(),
        registration: canonicalId.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      readCatalogueBrand(ctx.db, ctx.access, input, ctx.now ?? (() => new Date())),
    ),
  readModel: publicProcedure
    .input(
      z.object({
        modelSlug: slug,
        section: z.enum(DOSSIER_SECTIONS).optional(),
        registration: canonicalId.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      readCatalogueModel(ctx.db, ctx.access, input, ctx.now ?? (() => new Date())),
    ),
});
