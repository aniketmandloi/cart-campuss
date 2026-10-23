import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCatalogueRead, parseCatalogueToken } from "../src/catalogue/selection";

test("invalid and absent remain usable catalogue identifiers", () => {
  assert.deepEqual(parseCatalogueToken("invalid", "slug"), {
    status: "present",
    value: "invalid",
  });
  assert.deepEqual(parseCatalogueToken("absent", "slug"), {
    status: "present",
    value: "absent",
  });
  assert.deepEqual(parseCatalogueToken(" invalid ", "id"), {
    status: "present",
    value: "invalid",
  });
  assert.deepEqual(parseCatalogueToken("absent", "id"), {
    status: "present",
    value: "absent",
  });
  assert.deepEqual(parseCatalogueToken(undefined, "id"), { status: "absent" });
  assert.deepEqual(parseCatalogueToken("   ", "slug"), { status: "absent" });
  assert.deepEqual(parseCatalogueToken("Not A Slug", "slug"), { status: "invalid" });
  assert.equal(parseCatalogueToken("a".repeat(81), "id").status, "invalid");

  assert.deepEqual(
    parseCatalogueRead({
      modelSlug: "invalid",
      generationSlug: "absent",
      market: "absent",
      year: "invalid",
      variant: "var_base",
    }),
    {
      status: "ready",
      value: {
        modelSlug: "invalid",
        generationSlug: "absent",
        market: "absent",
        year: "invalid",
        variant: "var_base",
      },
    },
  );
  assert.deepEqual(
    parseCatalogueRead({
      modelSlug: "sample-hatch",
      generationSlug: "series-one",
    }),
    {
      status: "ready",
      value: {
        modelSlug: "sample-hatch",
        generationSlug: "series-one",
      },
    },
  );
  assert.equal(
    parseCatalogueRead({
      modelSlug: "Bad Slug",
      generationSlug: "series-one",
      market: "mkt_probe",
    }).status,
    "invalid",
  );
  assert.equal(
    parseCatalogueRead({
      modelSlug: "sample-hatch",
      generationSlug: "series-one",
      variant: "not an id",
    }).status,
    "invalid",
  );
});
