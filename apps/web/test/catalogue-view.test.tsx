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
    productionClaims: [],
    selector: {
      generations: [],
      markets: [],
      years: [],
      variants: [],
      records: [
        {
          id: "mkt_probe:year_probe_2024:var_probe_base",
          label: "Probe market, model year 2024, Base",
          detail: "Manufacturer model-year label. Not the calendar build year.",
          href: "/cars/plain-sedan/mark-one?market=mkt_probe&year=year_probe_2024&variant=var_probe_base",
          current: true,
        },
      ],
    },
    sections: [
      { id: "overview", label: "Overview", href: "/cars/plain-sedan/mark-one#overview", current: true },
      { id: "specs", label: "Specs", href: "/cars/plain-sedan/mark-one?section=specs#specs", current: false },
      { id: "market", label: "Market", href: "/cars/plain-sedan/mark-one?section=market#market", current: false },
      { id: "cost", label: "India cost", href: "/cars/plain-sedan/mark-one?section=cost#cost", current: false },
      { id: "sources", label: "Sources", href: "/cars/plain-sedan/mark-one?section=sources#sources", current: false },
    ],
    context: {
      market: "mkt_probe",
      year: "year_probe_2024",
      variant: "var_probe_base",
      registration: null,
      section: "overview",
    },
    correctionHref:
      "https://github.com/aniketmandloi/cart-campuss/issues/new?title=Correction&body=Brand%3A+Harbor+Probe",
    rebadge: null,
    aliases: [],
    image: null,
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
        freshness: "current",
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
        conflict: {
          rawValue: "90 N·m",
          normalizedValue: "90",
          unit: "N·m",
          measurementStandard: "probe-torque",
          sourceTitle: "Conflicting probe note",
          sourceUrl: "https://example.invalid/probe-torque-conflict",
          observedOn: "2026-10-22",
          retrievedOn: "2026-10-23",
          reviewedOn: "2026-10-23",
          reviewStatus: "reviewed",
          policyName: "Reviewed conflict policy",
          policyAudience: "public",
          policyAttribution: "Reviewed conflict attribution.",
        },
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
  assert.match(html, /Conflicting reading/);
  assert.match(html, /Raw: 90 N·m/);
  assert.match(html, /Normalized: 90/);
  assert.match(html, /Unit: N·m/);
  assert.match(html, /Standard: probe-torque/);
  assert.match(html, /href="https:\/\/example\.invalid\/probe-torque-conflict"/);
  assert.match(html, /Conflicting probe note/);
  assert.match(html, /Conflicting source policy: Reviewed conflict policy/);
  assert.match(html, /Reviewed conflict attribution/);
  assert.match(html, /Reviewed 2026-10-23/);
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
  assert.match(html, /id="overview"/);
  assert.match(html, /id="specs"/);
  assert.match(html, /id="market"/);
  assert.match(html, /id="cost"/);
  assert.match(html, /id="sources"/);
  assert.match(html, /Estimate India cost/);
  assert.match(html, /Report a correction/);
  assert.match(html, /Not a purchase total/);
  assert.match(html, /aria-current="true"/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /provider-secret-do-not-project|Porsche|GT3/);
});

test("units, withheld figures, and a credited image stay distinct", () => {
  const page: CatalogueCarPage = {
    ...visibleShell(),
    facts: [
      known("Power", "300 PS", "PS", "PS", { freshness: "stale" }),
      known("Power", "296 bhp", "bhp", "bhp"),
      known("Power", "221 kW", "kW", "kW"),
      known("Efficiency", "8.4 l/100 km", "l/100 km", "WLTP"),
      known("Efficiency", "7.1 l/100 km", "l/100 km", "NEDC"),
      known("Kerb weight", "1400 kg", "kg", "kerb"),
      known("Dry weight", "1280 kg", "kg", "dry"),
      {
        ...known("Transmission", "", null, null),
        state: "not-applicable",
        rawValue: null,
        normalizedValue: null,
        unknownReason: "Transmission does not apply to this record.",
      },
      {
        ...known("Acceleration", "", null, null),
        state: "withheld",
        rawValue: null,
        normalizedValue: null,
        unknownReason: "The rights holder withheld acceleration.",
      },
      known("Sales", "88001", null, "fixture-sales"),
    ],
    productionClaims: [
      {
        scope: "India Base",
        geography: "India",
        period: "2024",
        count: 12,
        status: "completed",
        counted: "vehicles built",
        sourceTitle: "Synthetic fixture production note",
        sourceUrl: null,
        observedOn: "2026-10-22",
        retrievedOn: "2026-10-23",
        reviewedOn: "2026-10-23",
        reviewStatus: "reviewed",
        policyName: "Reviewed public policy",
        policyAudience: "public",
        policyAttribution: "Reviewed public probe attribution.",
      },
    ],
    image: {
      altText: "Synthetic fixture graphic",
      credit: "Synthetic fixture image office",
      licence: "Fixture image only. Not a catalogue photograph grant.",
      sourceUrl: "https://example.invalid/fixture-image",
      assetUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
    },
    rebadge: {
      brandName: "Lumen Fixture",
      modelName: "Twin Coupe",
      href: "/cars/twin-coupe/series-two",
    },
    context: {
      market: "mkt_probe",
      year: "year_probe_2024",
      variant: "var_probe_base",
      registration: "reg_fixture_mh",
      section: "specs",
    },
  };
  const html = renderToStaticMarkup(<CatalogueDetailView state={{ kind: "page", page }} />);
  for (const text of ["300 PS", "296 bhp", "221 kW", "WLTP", "NEDC", "1400 kg", "1280 kg", "kerb", "dry"]) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(html, /Stale\. Last reviewed 2026-10-23/);
  assert.match(html, /Not applicable/);
  assert.match(html, /Withheld by rights/);
  assert.match(html, /Completed 12/);
  assert.match(html, /vehicles built/);
  assert.match(html, /88001/);
  assert.match(html, /These counts are not production/);
  const production = html.slice(html.indexOf('id="production-history"'), html.indexOf('id="separate-counts"'));
  assert.doesNotMatch(production, /88001/);
  assert.match(html, /alt="Synthetic fixture graphic"/);
  assert.match(html, /Synthetic fixture image office/);
  assert.match(html, /Separate model/);
  assert.match(html, /href="\/cars\/twin-coupe\/series-two"/);
  assert.match(html, /Registration jurisdiction: reg_fixture_mh/);
  assert.match(html, /Not a tax calculation/);
  assert.doesNotMatch(html, /Porsche|GT3/);
  const correction = new URL(page.correctionHref);
  assert.equal(correction.origin + correction.pathname, "https://github.com/aniketmandloi/cart-campuss/issues/new");
  assert.doesNotMatch(correction.search, /reg_fixture_mh|income|emi/);
});

test("an incompatible or incomplete page does not borrow another car", () => {
  const incomplete = renderToStaticMarkup(
    <CatalogueDetailView
      state={{
        kind: "page",
        page: {
          availability: "overview",
          ...contextShell(),
          identity: {
            brandName: "Sketch Fixture",
            modelName: "Unfinished Note",
            generationName: "Open Sheet",
            modelSlug: "unfinished-note",
            generationSlug: "open-sheet",
          },
        },
      }}
    />,
  );
  assert.match(incomplete, /Specifications are shown only after you choose a market, model year, and variant/);
  assert.match(incomplete, /Comparison and finance wait/);
  assert.match(incomplete, /id="cost"/);
  assert.doesNotMatch(incomplete, /300 PS|₹/);

  const incompatible = renderToStaticMarkup(
    <CatalogueDetailView
      state={{
        kind: "page",
        page: {
          availability: "incompatible",
          ...contextShell(),
          identity: {
            brandName: "Lumen Fixture",
            modelName: "Twin Coupe",
            generationName: "Series Two",
            modelSlug: "twin-coupe",
            generationSlug: "series-two",
          },
        },
      }}
    />,
  );
  assert.match(incompatible, /not a record of this car/);
  assert.doesNotMatch(incompatible, /300 PS|150 PS|₹/);
});

function known(
  property: string,
  rawValue: string,
  unit: string | null,
  standard: string | null,
  extra?: { freshness?: "current" | "stale" | "not-checked" },
) {
  return {
    property,
    state: "known" as const,
    freshness: extra?.freshness ?? ("current" as const),
    rawValue,
    normalizedValue: rawValue,
    unit,
    measurementStandard: standard,
    unknownReason: null,
    curatedReason: null,
    sourceTitle: "Synthetic fixture dossier",
    sourceUrl: null,
    observedOn: "2026-10-22",
    retrievedOn: "2026-10-23",
    reviewedOn: "2026-10-23",
    reviewStatus: "reviewed",
    policyName: "Reviewed public policy",
    policyAudience: "public",
    policyAttribution: "Reviewed public probe attribution.",
    conflict: null,
  };
}

function contextShell() {
  return {
    privatePreview: true,
    synthetic: true,
    policy: {
      name: "Synthetic preview policy",
      audience: "private-preview",
      attribution: "Synthetic fixture for private preview. Not a manufacturer publication.",
    },
    selector: { generations: [], markets: [], years: [], variants: [], records: [] },
    sections: [
      { id: "overview" as const, label: "Overview", href: "/cars/twin-coupe/series-two#overview", current: true },
      { id: "specs" as const, label: "Specs", href: "/cars/twin-coupe/series-two?section=specs#specs", current: false },
      { id: "market" as const, label: "Market", href: "/cars/twin-coupe/series-two?section=market#market", current: false },
      { id: "cost" as const, label: "India cost", href: "/cars/twin-coupe/series-two?section=cost#cost", current: false },
      { id: "sources" as const, label: "Sources", href: "/cars/twin-coupe/series-two?section=sources#sources", current: false },
    ],
    context: {
      market: null,
      year: null,
      variant: null,
      registration: null,
      section: "overview" as const,
    },
    correctionHref: "https://github.com/aniketmandloi/cart-campuss/issues/new?title=Correction&body=Applicability%3A+not+selected",
    rebadge: null,
    aliases: [],
    image: null,
  };
}

function visibleShell(): Extract<CatalogueCarPage, { availability: "visible" }> {
  return {
    availability: "visible",
    ...contextShell(),
    marketLabel: "No market data",
    productionClaims: [],
    identity: {
      brandName: "Lumen Fixture",
      modelName: "Twin Coupe",
      generationName: "Series Two",
      modelSlug: "twin-coupe",
      generationSlug: "series-two",
      salesMarketName: "India",
      salesMarketId: "mkt_fixture_in",
      modelYearLabel: "2024",
      modelYearId: "year_lumen_in",
      modelYearConvention: "India model-year label. Not the calendar build year.",
      variantName: "Base",
      variantId: "var_lumen_in_base",
      applicabilityId: "app_lumen_in_2024_base",
    },
    facts: [],
    priceReference: null,
  };
}
