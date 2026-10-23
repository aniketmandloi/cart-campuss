import { publicProcedure, router } from "../index";
import { catalogueRouter } from "./catalogue";
import { publishingRouter } from "./publishing";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  catalogue: catalogueRouter,
  publishing: publishingRouter,
});
export type AppRouter = typeof appRouter;
