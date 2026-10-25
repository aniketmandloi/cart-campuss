import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CatalogueSearchResult } from "@cart-campuss/api/catalogue";
import { catalogueListHref, catalogueListRecord, parseCatalogueListQuery, readCatalogueScroll, writeCatalogueScroll } from "@cart-campuss/api/catalogue-filters";

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
    const again = parseCatalogueListQuery(catalogueListRecord(parsed.href));
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.href, parsed.href);
    assert.equal(catalogueListHref({ q: "Harbor Probe" }), "/cars?q=Harbor+Probe");
  });

  test("round-trips a scoped price filter and repeated measurement attributes", () => {
    const parsed = parseCatalogueListQuery({
      q: "north",
      priceMin: "100000",
      priceMax: "250000",
      priceCurrency: "inr",
      priceMarket: "mkt_probe",
      priceBasis: "ex-showroom (tax inclusive)",
      priceUnknown: "include",
      attr: ["power:ps", "weight:kerb"],
      condition: "new",
      sellerCountry: "IN",
      mileageMax: "1000",
      auctionStatus: "active",
      loan: "10",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.query.priceCurrency, "INR");
    assert.equal(parsed.query.priceUnknown, "include");
    assert.deepEqual(parsed.query.attr, ["power:ps", "weight:kerb"]);
    assert.equal(parsed.href.includes("condition"), false);
    assert.equal(parsed.href.includes("sellerCountry"), false);
    assert.equal(parsed.href.includes("mileageMax"), false);
    assert.equal(parsed.href.includes("auctionStatus"), false);
    assert.equal(parsed.href.includes("loan"), false);
    const again = parseCatalogueListQuery(catalogueListRecord(parsed.href));
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.href, parsed.href);
    assert.deepEqual(again.query.attr, ["power:ps", "weight:kerb"]);
  });

  test("rejects an incomplete price filter and an attribute without a standard", () => {
    const price = parseCatalogueListQuery({ priceMin: "100", priceCurrency: "INR" });
    assert.equal(price.ok, false);
    if (price.ok) return;
    assert.equal(price.reason, "price");
    assert.equal(parseCatalogueListQuery({ attr: "power" }).ok, false);
    assert.equal(
      parseCatalogueListQuery({
        priceMin: "20",
        priceMax: "10",
        priceCurrency: "INR",
        priceMarket: "mkt_probe",
        priceBasis: "ex-showroom",
        priceUnknown: "include",
      }).ok,
      false,
    );
    assert.equal(
      parseCatalogueListQuery({
        priceMin: "0",
        priceMax: "1",
        priceCurrency: "INR",
        priceMarket: "mkt_probe",
        priceBasis: "x".repeat(201),
        priceUnknown: "include",
      }).ok,
      false,
    );
    const publishedBasis = parseCatalogueListQuery({
      priceMin: "0",
      priceMax: "1",
      priceCurrency: "INR",
      priceMarket: "mkt_probe",
      priceBasis: "ex-showroom (tax inclusive)",
      priceUnknown: "exclude",
    });
    assert.equal(publishedBasis.ok, true);
    const html = renderToStaticMarkup(
      <CatalogueSearchView state={{ kind: "invalid", query: "", privatePreview: false, reason: "price" }} />,
    );
    assert.match(html, /whether records without that price stay included/);
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

  test("the open filter sheet moves focus past the hidden query and restores it on close", async () => {
    const { Window } = await import("happy-dom");
    const dom = new Window({ url: "http://catalogue.local/cars?q=north" });
    const restore = useDom(dom);
    const reactGlobals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = reactGlobals.IS_REACT_ACT_ENVIRONMENT;
    reactGlobals.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      const [{ createRoot }, { act }] = await Promise.all([import("react-dom/client"), import("react")]);
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      await act(async () => {
        root.render(
          <CatalogueSearchView state={{ kind: "results", query: "north", privatePreview: false, result: sheetResult }} />,
        );
      });

      const summary = mustElement("catalogue-filter-summary");
      const details = mustElement("catalogue-filters") as HTMLDetailsElement;
      summary.focus();
      await act(async () => {
        details.open = true;
      });
      assert.equal(document.activeElement?.id, "catalogue-filter-body");

      tab(details, false);
      assert.equal(document.activeElement?.id, "catalogue-filter-price-min");
      tab(details, false);
      assert.equal(document.activeElement?.id, "catalogue-filter-price-max");
      tab(details, false);
      assert.equal(document.activeElement?.id, "catalogue-filter-price-currency");
      tab(details, false);
      assert.equal(document.activeElement?.id, "catalogue-filter-price-market");
      tab(details, false);
      assert.equal(document.activeElement?.id, "catalogue-filter-price-basis");
      tab(details, false);
      assert.equal(document.activeElement?.id, "catalogue-filter-price-unknown");
      tab(details, false);
      assert.equal(document.activeElement?.id, "catalogue-filter-apply");
      tab(details, false);
      assert.equal(document.activeElement?.id, "catalogue-filter-reset");
      tab(details, false);
      assert.equal(document.activeElement?.id, "catalogue-filter-summary");

      mustElement("catalogue-filter-body").focus();
      tab(details, true);
      assert.equal(document.activeElement?.id, "catalogue-filter-summary");
      assert.notEqual(document.activeElement?.id, hiddenQueryId());

      await act(async () => {
        details.open = false;
      });
      assert.equal(document.activeElement?.id, "catalogue-filter-summary");

      await act(async () => {
        root.unmount();
      });
    } finally {
      reactGlobals.IS_REACT_ACT_ENVIRONMENT = previousAct;
      restore();
    }
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
  marketAccess: { mode: "directory" },
  performanceControls: [],
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

function mustElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing #${id}`);
  return element;
}

function hiddenQueryId(): string | undefined {
  const query = document.querySelector<HTMLInputElement>('input[name="q"]');
  return query?.id;
}

function tab(details: HTMLElement, shift: boolean): void {
  details.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true }));
}

function useDom(dom: import("happy-dom").Window): () => void {
  const target = globalThis as unknown as Record<string, unknown>;
  const previous = {
    window: target.window,
    document: target.document,
    HTMLElement: target.HTMLElement,
    Element: target.Element,
    KeyboardEvent: target.KeyboardEvent,
    HTMLInputElement: target.HTMLInputElement,
  };
  target.window = dom;
  target.document = dom.document;
  target.HTMLElement = dom.HTMLElement;
  target.Element = dom.Element;
  target.KeyboardEvent = dom.KeyboardEvent;
  target.HTMLInputElement = dom.HTMLInputElement;
  return () => {
    target.window = previous.window;
    target.document = previous.document;
    target.HTMLElement = previous.HTMLElement;
    target.Element = previous.Element;
    target.KeyboardEvent = previous.KeyboardEvent;
    target.HTMLInputElement = previous.HTMLInputElement;
  };
}
