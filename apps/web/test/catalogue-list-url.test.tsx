import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  catalogueListHref,
  nextCatalogueFocus,
  parseCatalogueListQuery,
  readCatalogueScroll,
  writeCatalogueScroll,
} from "@cart-campuss/api/catalogue-filters";

describe("shareable catalogue URL", () => {
  test("restores filters and page, and leaves personal scenario values out of the URL", () => {
    const parsed = parseCatalogueListQuery({
      q: "Harbor Probe",
      brand: "harbor-probe",
      model: "plain-sedan",
      generation: "mark-one",
      year: "year_probe_2024",
      market: "mkt_probe",
      body: "sedan",
      powertrain: "petrol",
      transmission: "automatic",
      coverage: "applicability",
      page: "2",
      loan: "500000",
      income: "200000",
      debt: "1000",
      fee: "10",
      deposit: "20",
      "running-cost": "30",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.query.q, "Harbor Probe");
    assert.equal(parsed.query.page, 2);
    assert.equal(parsed.href.includes("loan"), false);
    assert.equal(parsed.href.includes("income"), false);
    assert.equal(parsed.href.includes("debt"), false);
    assert.equal(parsed.href.includes("fee"), false);
    assert.equal(parsed.href.includes("deposit"), false);
    assert.equal(parsed.href.includes("running-cost"), false);
    assert.equal(parsed.href.includes("page=2"), true);
    const again = parseCatalogueListQuery(Object.fromEntries(new URL(parsed.href, "http://catalogue.local").searchParams));
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.href, parsed.href);
    assert.equal(catalogueListHref({ q: "Harbor Probe" }), "/cars?q=Harbor+Probe");
  });

  test("rejects an unknown filter value and a non-canonical page", () => {
    assert.equal(parseCatalogueListQuery({ brand: "Harbor Probe" }).ok, false);
    assert.equal(parseCatalogueListQuery({ coverage: "worldwide" }).ok, false);
    assert.equal(parseCatalogueListQuery({ page: "0" }).ok, false);
    assert.equal(parseCatalogueListQuery({ page: "01" }).ok, false);
    assert.equal(parseCatalogueListQuery({ q: "x".repeat(81) }).ok, false);
    assert.equal(parseCatalogueListQuery({ body: "'; drop table catalogue_alias; --" }).ok, false);
  });

  test("remembers list scroll for the same filter URL and wraps the filter sheet focus", () => {
    const storage = new Map<string, string>();
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    const href = "/cars?q=north&page=2";
    writeCatalogueScroll(memory, href, 480.8);
    assert.equal(readCatalogueScroll(memory, href), 480);
    assert.equal(readCatalogueScroll(memory, "/cars?q=north"), null);
    assert.equal(nextCatalogueFocus(["filters", "body", "apply", "reset"], "reset", false), "filters");
    assert.equal(nextCatalogueFocus(["filters", "body", "apply", "reset"], "filters", true), "reset");
    assert.equal(nextCatalogueFocus(["filters", "body", "apply", "reset"], null, false), "filters");
  });
});
