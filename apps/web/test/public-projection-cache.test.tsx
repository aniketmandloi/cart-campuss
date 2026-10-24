import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { PUBLIC_CACHE_CONTROL } from "@cart-campuss/api/public-cache";
import { QueryClient } from "@tanstack/react-query";

import {
  applyPublicProjectionRead,
  publicProjectionQueryOptions,
  readRememberedProjection,
  rememberPublicProjection,
} from "../src/catalogue/public-cache";

test("public catalogue queries are not retained and a withdrawn read drops the cached subject", async () => {
  const clientSource = await readFile(new URL("../src/utils/trpc.ts", import.meta.url), "utf8");
  assert.match(clientSource, /defaultOptions: \{ queries: publicProjectionQueryOptions \}/);
  assert.equal(publicProjectionQueryOptions.staleTime, 0);
  assert.equal(publicProjectionQueryOptions.gcTime, 0);
  assert.equal(publicProjectionQueryOptions.refetchOnMount, "always");

  const client = new QueryClient();
  rememberPublicProjection(client, "subject-departed", {
    displayName: "Departed Roadster",
    privatePayload: { marker: "PAYLOAD-NOT-PUBLIC" },
    contractText: "CONTRACT-TEXT-NOT-PUBLIC",
    facts: [{ property: "power", rawValue: "100 PS" }],
  });
  const remembered = readRememberedProjection(client, "subject-departed");
  assert.equal(JSON.stringify(remembered).includes("PAYLOAD-NOT-PUBLIC"), false);
  assert.equal(JSON.stringify(remembered).includes("CONTRACT-TEXT-NOT-PUBLIC"), false);
  assert.match(JSON.stringify(remembered), /100 PS/);

  applyPublicProjectionRead(client, "subject-departed", null);
  assert.equal(readRememberedProjection(client, "subject-departed"), undefined);
  rememberPublicProjection(client, "subject-departed", {
    displayName: "Departed Roadster",
    privatePayload: { marker: "PAYLOAD-NOT-PUBLIC" },
  });
  applyPublicProjectionRead(client, "subject-departed", null);
  assert.equal(readRememberedProjection(client, "subject-departed"), undefined);
});

test("deployment and page caches refuse to store the public catalogue", async () => {
  const vercel = JSON.parse(await readFile(new URL("../../../vercel.json", import.meta.url), "utf8")) as {
    headers: Array<{ headers: Array<{ key: string; value: string }> }>;
  };
  assert.equal(vercel.headers[0]?.headers[0]?.value, PUBLIC_CACHE_CONTROL);
  const page = await readFile(
    new URL("../src/app/cars/[modelSlug]/[generationSlug]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.match(page, /export const fetchCache = "force-no-store"/);
  const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(nextConfig, /PUBLIC_CACHE_CONTROL/);
});
