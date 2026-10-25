import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CatalogueSearchResult } from "@cart-campuss/api/catalogue";
import {
  curatedMeasurements,
  feedInventoryHonored,
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

  test("filters a curated measurement only inside its own standard", () => {
    const facts = [
      { property: "Power", state: "known", normalizedValue: "110", standard: "PS", curated: true },
      { property: "Power", state: "known", normalizedValue: "80", standard: "kW", curated: false },
      { property: "Power", state: "known", normalizedValue: "90", measurementStandard: null, curated: true },
      { property: "Weight", state: "known", normalizedValue: "1400", standard: "kerb", curated: true },
      { property: "Weight", state: "known", normalizedValue: "1300", standard: "dry", curated: true },
      { property: "Body", state: "known", normalizedValue: "sedan", standard: "iso", curated: true },
      { property: "Range", state: "known", normalizedValue: "long", standard: "wltp", curated: true },
    ];
    const measurements = curatedMeasurements(facts);
    assert.deepEqual(
      measurements.map((item) => item.standard),
      ["ps", "kerb", "dry"],
    );
    assert.equal(matchesAttribute(measurements, { property: "power", standard: "ps" }), true);
    assert.equal(matchesAttribute(measurements, { property: "power", standard: "kw" }), false);
    const controls = listPerformanceControls(
      [{ measurements }, { measurements: [{ property: "weight", standard: "kerb", normalizedValue: "1500" }] }],
      ["power:ps"],
    );
    assert.deepEqual(
      controls.map((control) => control.value),
      ["power:ps", "weight:dry", "weight:kerb"],
    );
    assert.equal(controls.find((control) => control.value === "weight:kerb")?.count, 2);
    assert.equal(controls.find((control) => control.value === "power:ps")?.current, true);
    assert.equal(controls.some((control) => control.value === "power"), false);
  });

  test("honors feed filters only when an approved feed states its coverage", () => {
    const raw = { condition: "used", sellerCountry: "IN", mileageMax: "12000", auctionStatus: "active" };
    assert.equal(feedInventoryHonored({ mode: "directory", providerCoverage: null }, raw), null);
    assert.equal(feedInventoryHonored({ mode: "no-data", providerCoverage: null }, raw), null);
    assert.equal(feedInventoryHonored({ mode: "approved-feed", providerCoverage: "  " }, raw), null);
    assert.deepEqual(
      feedInventoryHonored(
        { mode: "approved-feed", providerCoverage: "Example Auctions, observed weekly." },
        raw,
      ),
      { ...raw, providerCoverage: "Example Auctions, observed weekly." },
    );
  });

  test("directory mode has no inventory controls, and an approved feed states coverage", () => {
    const directory = renderToStaticMarkup(
      <CatalogueSearchView state={{ kind: "results", query: "", privatePreview: false, result: result("directory") }} />,
    );
    assert.match(directory, /does not claim dealer stock/);
    assert.doesNotMatch(directory, /Available now/);
    assert.equal(directory.includes('name="condition"'), false);
    assert.equal(directory.includes("power (ps)"), false);

    const measured: ScopedMeasurement = { property: "power", standard: "ps", normalizedValue: "110" };
    const withControl = result("directory");
    withControl.performanceControls = listPerformanceControls([{ measurements: [measured] }], []);
    const filtered = renderToStaticMarkup(
      <CatalogueSearchView state={{ kind: "results", query: "", privatePreview: false, result: withControl }} />,
    );
    assert.match(filtered, /power \(ps\)/);
    assert.equal(filtered.includes("power (kw)"), false);

    const feed = renderToStaticMarkup(
      <CatalogueSearchView
        state={{
          kind: "results",
          query: "",
          privatePreview: false,
          result: {
            ...result("approved-feed"),
            marketAccess: { mode: "approved-feed", providerCoverage: "Example Auctions, observed weekly." },
          },
        }}
      />,
    );
    assert.match(feed, /Approved feed coverage: Example Auctions, observed weekly/);
    assert.match(feed, /name="condition"/);
    assert.doesNotMatch(feed, /does not claim dealer stock/);
  });
});

function result(mode: "directory" | "approved-feed"): CatalogueSearchResult {
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
    marketAccess: { mode, providerCoverage: mode === "approved-feed" ? "Example Auctions, observed weekly." : null },
    performanceControls: [],
  };
}
