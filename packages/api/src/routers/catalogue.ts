import { z } from "zod";

import { catalogueStatus, readCatalogueCar, searchCatalogue } from "../catalogue";
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
  search: publicProcedure
    .input(z.object({ q: z.string().trim().min(1).max(80) }))
    .query(({ ctx, input }) =>
      searchCatalogue(ctx.db, ctx.access, input.q, ctx.now ?? (() => new Date())),
    ),
  read: publicProcedure
    .input(
      z.object({
        modelSlug: slug,
        generationSlug: slug,
        market: canonicalId.optional(),
        year: canonicalId.optional(),
        variant: canonicalId.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      readCatalogueCar(ctx.db, ctx.access, input, ctx.now ?? (() => new Date())),
    ),
});
