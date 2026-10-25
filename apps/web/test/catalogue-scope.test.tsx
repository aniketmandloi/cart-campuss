import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CatalogueSearchResult } from "@cart-campuss/api/catalogue";
import {
  curatedMeasurements,
  listPerformanceControls,
  matchesAttribute,
  priceReferenceCaption,
  priceWindowMatches,
  type ScopedMeasurement,
  type ScopedPrice,
} from "@cart-campuss/api/catalogue-scope";

import { CatalogueSearchView } from "../src/catalogue/views";

const inr: ScopedPrice = {
  amountMinor: 1_500_000_00,
  currency: "INR",
  basis: "ex-showroom",
  salesMarketId: "mkt_in",
};
const usd: ScopedPrice = {
  amountMinor: 4_000_000,
  currency: "USD",
  basis: "manufacturer ex-works",
  salesMarketId: "mkt_us",
};
const inrWindow = {
  priceMin: 1_000_000_00,
  priceMax: 2_000_000_00,
  priceCurrency: "INR",
  priceMarket: "mkt_in",
  priceBasis: "ex-showroom",
  priceUnknown: "include" as const,
};

describe("scoped price and performance filters", () => {
  test("keeps an unknown price unless it is excluded, and does not compare a foreign amount", () => {
    assert.equal(priceWindowMatches([inr], inrWindow), true);
    assert.equal(priceWindowMatches([usd], inrWindow), false);
    assert.equal(priceWindowMatches([], inrWindow), true);
    assert.equal(priceWindowMatches([], { ...inrWindow, priceUnknown: "exclude" }), false);
    assert.equal(priceWindowMatches([{ ...inr, amountMinor: 50 }], inrWindow), false);
    assert.equal(
      priceWindowMatches([usd], {
        priceMin: 0,
        priceMax: 9_000_000,
        priceCurrency: "INR",
        priceMarket: "mkt_us",
        priceBasis: "manufacturer ex-works",
        priceUnknown: "exclude",
      }),
      false,
    );
    const caption = priceReferenceCaption({
      displayAmount: "USD 40,000",
      basis: "manufacturer ex-works",
      salesMarketName: "United States",
    });
    assert.equal(caption, "USD 40,000, manufacturer ex-works, United States");
    assert.equal(caption.toLowerCase().includes("india on-road"), false);
    assert.equal(caption.toLowerCase().includes("on-road"), false);
  });

  test("keeps multiword weights and refuses a sales figure as a performance filter", () => {
    const facts = [
      { property: "Power", state: "known", normalizedValue: "110", standard: "PS", curated: true },
      { property: "Power", state: "known", normalizedValue: "80", standard: "kW", curated: false },
      { property: "Power", state: "known", normalizedValue: "90", measurementStandard: null, curated: true },
      { property: "Kerb weight", state: "known", normalizedValue: "1400", standard: "kerb", curated: true },
      { property: "Dry weight", state: "known", normalizedValue: "1280", standard: "dry", curated: true },
      { property: "Efficiency", state: "known", normalizedValue: "8.4", standard: "WLTP", curated: true },
      { property: "Efficiency", state: "known", normalizedValue: "7.1", standard: "NEDC", curated: true },
      { property: "Sales", state: "known", normalizedValue: "88001", standard: "fixture-sales", curated: true },
      { property: "Body", state: "known", normalizedValue: "sedan", standard: "iso", curated: true },
      { property: "Range", state: "known", normalizedValue: "long", standard: "wltp", curated: true },
    ];
    const measurements = curatedMeasurements(facts);
    assert.deepEqual(
      measurements.map((item) => item.property + ":" + item.standard),
      ["power:ps", "kerb-weight:kerb", "dry-weight:dry", "efficiency:wltp", "efficiency:nedc"],
    );
    assert.equal(measurements.find((item) => item.property === "kerb-weight")?.label, "Kerb weight (kerb)");
    assert.equal(matchesAttribute(measurements, { property: "power", standard: "ps" }), true);
    assert.equal(matchesAttribute(measurements, { property: "power", standard: "kw" }), false);
    assert.equal(matchesAttribute(measurements, { property: "kerb-weight", standard: "kerb" }), true);
    const again = curatedMeasurements([
      { property: "Kerb weight", state: "known", normalizedValue: "1500", standard: "kerb", curated: true },
    ]);
    const controls = listPerformanceControls([{ measurements }, { measurements: again }], ["power:ps"]);
    assert.equal(controls.find((control) => control.value === "kerb-weight:kerb")?.count, 2);
    assert.equal(controls.find((control) => control.value === "power:ps")?.current, true);
    assert.equal(controls.some((control) => control.value.includes("sales")), false);
    assert.equal(controls.some((control) => control.label === "Kerb weight (kerb)"), true);
  });

  test("directory mode has no inventory controls", () => {
    const directory = renderToStaticMarkup(
      <CatalogueSearchView state={{ kind: "results", query: "", privatePreview: false, result: result() }} />,
    );
    assert.match(directory, /does not claim dealer stock/);
    assert.doesNotMatch(directory, /Available now/);
    assert.equal(directory.includes('name="condition"'), false);
    assert.equal(directory.includes("power (ps)"), false);

    const measured: ScopedMeasurement = {
      property: "power",
      standard: "ps",
      label: "Power (PS)",
      normalizedValue: "110",
    };
    const withControl = result();
    withControl.performanceControls = listPerformanceControls([{ measurements: [measured] }], []);
    const filtered = renderToStaticMarkup(
      <CatalogueSearchView state={{ kind: "results", query: "", privatePreview: false, result: withControl }} />,
    );
    assert.match(filtered, /Power \(PS\)/);
    assert.equal(filtered.includes("power (kw)"), false);
    assert.equal(filtered.includes('name="condition"'), false);
    assert.equal(filtered.includes("Approved feed"), false);
  });
});

function result(): CatalogueSearchResult {
  return {
    query: "",
    privatePreview: false,
    hits: [],
    suggestions: [],
    page: 1,
    pageSize: 20,
    total: 0,
    pageCount: 1,
    ambiguous: false,
    miss: null,
    href: "/cars",
    chips: [],
    marketAccess: { mode: "directory" },
    performanceControls: [],
  };
}
