import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryObserver } from "@tanstack/react-query";

test("a catalogue subject leaves the visitor cache when the page stops reading it", async () => {
  process.env.NEXT_PUBLIC_SERVER_URL = "http://127.0.0.1:3000";
  const { queryClient } = await import("../src/utils/trpc.ts");
  const queryKey = ["catalogue", "subject-departed"];
  queryClient.setQueryData(queryKey, {
    displayName: "Departed Roadster",
    privatePayload: { marker: "PAYLOAD-NOT-PUBLIC" },
  });
  assert.match(JSON.stringify(queryClient.getQueryData(queryKey)), /Departed Roadster/);

  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => null,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  unsubscribe();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));

  const retained = queryClient.getQueryData(queryKey);
  assert.equal(retained, undefined);
  assert.equal(JSON.stringify(queryClient.getQueryCache().getAll()).includes("PAYLOAD-NOT-PUBLIC"), false);
  assert.equal(JSON.stringify(queryClient.getQueryCache().getAll()).includes("Departed Roadster"), false);
});
