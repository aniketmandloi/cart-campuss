import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  PublishingRejected,
  applyOperatorImport,
  assertOperatorAuthorized,
  operatorImportSchema,
  readPublishedCatalogueDetail,
  searchPublishedCatalogue,
} from "../publishing";
import { publicProcedure, router, t } from "../index";

const operatorProcedure = t.procedure.use(({ ctx, next }) => {
  try {
    assertOperatorAuthorized(ctx.operatorToken, ctx.presentedOperatorToken ?? undefined);
  } catch (error) {
    throw asTrpcError(error);
  }
  return next();
});

export const publishingRouter = router({
  search: publicProcedure
    .input(z.object({ q: z.string().max(200).optional() }))
    .query(({ ctx, input }) => searchPublishedCatalogue(ctx.db, input, ctx.now)),

  detail: publicProcedure
    .input(z.object({ subjectId: z.string().min(1).max(200) }))
    .query(({ ctx, input }) => readPublishedCatalogueDetail(ctx.db, input.subjectId, ctx.now)),

  submit: operatorProcedure.input(operatorImportSchema).mutation(async ({ ctx, input }) => {
    try {
      return await applyOperatorImport(
        { db: ctx.db, operatorToken: ctx.operatorToken, now: ctx.now },
        ctx.presentedOperatorToken ?? undefined,
        input,
      );
    } catch (error) {
      throw asTrpcError(error);
    }
  }),
});

function asTrpcError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  if (error instanceof PublishingRejected) {
    const code =
      error.code === "unauthorized"
        ? "UNAUTHORIZED"
        : error.code === "validation" ||
            error.code === "idempotency-conflict" ||
            error.code === "policy-immutable"
          ? "BAD_REQUEST"
          : "PRECONDITION_FAILED";
    return new TRPCError({ code, message: `${error.code}: ${error.message}` });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "The publication did not commit, and the previous public projection was left unchanged.",
  });
}
