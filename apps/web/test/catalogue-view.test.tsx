import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { formatMinorUnits, normalizeCatalogueQuery } from "@cart-campuss/api/catalogue";
import type { CatalogueCarPage } from "@cart-campuss/api/catalogue";

import { CatalogueDetailView, CatalogueSearchView } from "../src/catalogue/views";

test("money stays in integer minor units and queries fold case and space", () => {
  assert.equal(formatMinorUnits(42424242, "INR", 2), "₹4,24,242.42");
  assert.equal(formatMinorUnits(100000, "INR", 2), "₹1,000.00");
  assert.equal(formatMinorUnits(1, "INR", 7), null);
  assert.equal(normalizeCatalogueQuery("  KEStrel   Fixture "), "kestrel fixture");
});

test("an unconfigured catalogue does not invent a record", () => {
  const html = renderToStaticMarkup(
    <CatalogueSearchView state={{ kind: "unconfigured", query: "", privatePreview: false }} />,
  );
  assert.match(html, /catalogue database is not configured/i);
  assert.doesNotMatch(html, /Sample Hatch|Kestrel Fixture|provider-secret-do-not-project/);
});

test("a hidden address uses the same public copy and does not name a record", () => {
  const html = renderToStaticMarkup(
    <CatalogueDetailView
      state={{
        kind: "page",
        page: { availability: "not-in-public-catalogue", privatePreview: false },
      }}
    />,
  );
  assert.match(html, /Not in the public catalogue/);
  assert.doesNotMatch(html, /Kestrel|Sample Hatch|Harbor Probe|provider-secret-do-not-project/);
});

test("a sourced page shows the source, an explicit unknown, a conflict, and a price reference", () => {
  const page: CatalogueCarPage = {
    availability: "visible",
    privatePreview: false,
    synthetic: false,
    marketLabel: "No market data",
    policy: {
      name: "Reviewed public policy",
      audience: "public",
      attribution: "Reviewed public probe attribution.",
    },
    identity: {
      brandName: "Harbor Probe",
      modelName: "Plain Sedan",
      generationName: "Mark One",
      modelSlug: "plain-sedan",
      generationSlug: "mark-one",
      salesMarketName: "Probe market",
      salesMarketId: "mkt_probe",
      modelYearLabel: "2024",
      modelYearId: "year_probe_2024",
      modelYearConvention: "Manufacturer model-year label. Not the calendar build year.",
      variantName: "Base",
      variantId: "var_probe_base",
      applicabilityId: "app_harbor_probe",
    },
    facts: [
      {
        property: "Power",
        state: "unknown",
        rawValue: null,
        normalizedValue: null,
        unit: null,
        measurementStandard: null,
        unknownReason: "No measured power figure is on the record.",
        curatedReason: null,
        sourceTitle: "Reviewed public probe dossier",
        sourceUrl: null,
        observedOn: null,
        retrievedOn: "2026-10-23",
        reviewedOn: "2026-10-23",
        reviewStatus: "reviewed",
        policyName: "Reviewed public policy",
        policyAudience: "public",
        policyAttribution: "Reviewed public probe attribution.",
        conflict: null,
      },
    ],
    priceReference: {
      kind: "price-reference",
      amountMinor: 100000,
      currency: "INR",
      minorUnitExponent: 2,
      displayAmount: "₹1,000.00",
      basis: "official price reference",
      taxInclusivity: "unspecified",
      salesMarketName: "Probe market",
      observedOn: "2026-10-22",
      retrievedOn: "2026-10-23",
      reviewedOn: "2026-10-23",
      reviewStatus: "reviewed",
      sourceTitle: "Reviewed public probe price sheet",
      sourceUrl: "https://example.invalid/harbor-probe-price",
      sourceIdentifier: null,
      policyName: "Reviewed public policy",
      policyAudience: "public",
      policyAttribution: "Reviewed public probe attribution.",
    },
  };
  const html = renderToStaticMarkup(<CatalogueDetailView state={{ kind: "page", page }} />);
  assert.match(html, /No measured power figure is on the record/);
  assert.match(html, /not documented/);
  assert.match(html, /Reviewed public probe dossier/);
  assert.match(html, /₹1,000\.00/);
  assert.match(html, /100000 INR minor units/);
  assert.match(html, /Reviewed public probe price sheet/);
  assert.match(html, /href="https:\/\/example\.invalid\/harbor-probe-price"/);
  assert.match(html, /Source policy: Reviewed public policy/);
  assert.doesNotMatch(html, /Source: Reviewed public policy/);
  assert.match(html, /Not a listing/);
  assert.match(html, /No market data/);
  assert.match(html, /Not the calendar build year/);
  assert.match(html, /No catalogue photograph/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /provider-secret-do-not-project|Porsche|GT3/);
});
