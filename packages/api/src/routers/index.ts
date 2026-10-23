import { publicProcedure, router } from "../index";
import { publishingRouter } from "./publishing";
import { todoRouter } from "./todo";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  publishing: publishingRouter,
  todo: todoRouter,
});
export type AppRouter = typeof appRouter;
