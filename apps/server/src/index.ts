import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { ENV } from "./env.server";
import { db } from "./services";

const app = createApp({
  db,
  operatorToken: ENV.OPERATOR_TOKEN ?? null,
  allowFixtures: ENV.CATALOGUE_ALLOW_FIXTURES === true,
  corsOrigin: ENV.CORS_ORIGIN,
});

export default app;

if (!process.env.VERCEL) {
  serve(
    {
      fetch: app.fetch,
      port: 3000,
    },
    (info) => {
      console.log(`Server is running on http://localhost:${info.port}`);
    },
  );
}
