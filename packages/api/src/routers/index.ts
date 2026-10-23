import { publicProcedure, router } from "../index";
import { catalogueRouter } from "./catalogue";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  catalogue: catalogueRouter,
});
export type AppRouter = typeof appRouter;
