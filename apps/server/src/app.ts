import { appRouter } from "@cart-campuss/api/routers/index";
import type { Database } from "@cart-campuss/db";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createContext } from "./context";

export type AppDeps = {
  db: Database;
  now?: () => Date;
  operatorToken: string | null;
  allowFixtures?: boolean;
  corsOrigin: string;
  log?: boolean;
};

export function createApp(deps: AppDeps) {
  const app = new Hono();

  if (deps.log !== false) {
    app.use(logger());
  }
  app.use("/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "private, no-store");
  });
  app.use(
    "/*",
    cors({
      origin: deps.corsOrigin,
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  app.use(
    "/api/trpc/*",
    trpcServer({
      endpoint: "/api/trpc",
      router: appRouter,
      createContext: (_opts, context) => {
        return createContext({
          context,
          db: deps.db,
          now: deps.now,
          operatorToken: deps.operatorToken,
          allowFixtures: deps.allowFixtures === true,
        });
      },
    }),
  );

  app.get("/", (c) => {
    return c.text("OK");
  });

  return app;
}
