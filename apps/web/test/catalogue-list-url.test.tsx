import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CatalogueSearchResult } from "@cart-campuss/api/catalogue";
import {
  catalogueControlFocusable,
  catalogueListHref,
  nextCatalogueSheetControl,
  parseCatalogueListQuery,
  readCatalogueScroll,
  writeCatalogueScroll,
} from "@cart-campuss/api/catalogue-filters";

import { CatalogueSearchView } from "../src/catalogue/views";

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

  test("remembers list scroll for the same filter URL", () => {
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
  });

  test("the open filter sheet tabs past the hidden query to the visible controls", () => {
    const html = renderToStaticMarkup(
      <CatalogueSearchView state={{ kind: "results", query: "north", privatePreview: false, result: sheetResult }} />,
    );
    const controls = controlsInSheet(html);
    const query = controls.find((control) => control.name === "q");
    const body = controls.find((control) => control.name === "body");
    assert.equal(query?.type, "hidden");
    assert.equal(query && catalogueControlFocusable(query), false);
    assert.equal(body?.focusable, true);
    assert.equal(nextCatalogueSheetControl(controls, body?.id ?? "", true), "catalogue-filter-summary");
    assert.equal(nextCatalogueSheetControl(controls, body?.id ?? "", false), "catalogue-filter-apply");
    assert.equal(nextCatalogueSheetControl(controls, "catalogue-filter-summary", true), "catalogue-filter-reset");
  });
});

const sheetResult: CatalogueSearchResult = {
  query: "north",
  privatePreview: false,
  hits: [],
  suggestions: [],
  page: 1,
  pageSize: 20,
  total: 1,
  pageCount: 1,
  ambiguous: false,
  miss: null,
  href: "/cars?q=north",
  chips: [
    {
      dimension: "body",
      label: "sedan",
      value: "sedan",
      count: 1,
      href: "/cars?q=north&body=sedan",
      current: false,
    },
  ],
};

function controlsInSheet(html: string): Array<{
  id: string;
  name: string;
  type: string | null;
  hidden: boolean;
  disabled: boolean;
  focusable: boolean;
}> {
  const start = html.indexOf('id="catalogue-filters"');
  const sheet = html.slice(start, html.indexOf("</details>", start));
  return [...sheet.matchAll(/<(summary|a|button|input|select|textarea)\b([^>]*)>/gi)].map((match) => {
    const attrs = match[2] ?? "";
    const type = /(?:^|\s)type="([^"]*)"/i.exec(attrs)?.[1] ?? null;
    const control = {
      id: /(?:^|\s)id="([^"]*)"/i.exec(attrs)?.[1] ?? "",
      name: /(?:^|\s)name="([^"]*)"/i.exec(attrs)?.[1] ?? "",
      type,
      hidden: type === "hidden",
      disabled: /(?:^|\s)disabled(?:\s|=|$)/i.test(attrs),
    };
    return { ...control, focusable: catalogueControlFocusable(control) };
  });
}
