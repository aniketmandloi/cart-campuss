import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogueContextHref, correctionIssueUrl, parseDossierSection } from "@cart-campuss/api/dossier";

test("canonical links keep the requested record and drop overview and finance noise", () => {
  assert.equal(parseDossierSection("cost"), "cost");
  assert.equal(parseDossierSection("finance"), "overview");
  assert.equal(
    catalogueContextHref({
      modelSlug: "twin-coupe",
      generationSlug: "series-two",
      market: "mkt_fixture_in",
      year: "year_lumen_in",
      variant: "var_lumen_in_base",
      section: "cost",
      registration: "reg_fixture_mh",
    }),
    "/cars/twin-coupe/series-two?market=mkt_fixture_in&year=year_lumen_in&variant=var_lumen_in_base&section=cost&registration=reg_fixture_mh",
  );
  assert.equal(
    catalogueContextHref({
      modelSlug: "twin-coupe",
      generationSlug: "series-two",
      section: "overview",
    }),
    "/cars/twin-coupe/series-two",
  );
});

test("a correction issue carries public identity and leaves out registration", () => {
  const href = correctionIssueUrl({
    brandName: "Lumen Fixture",
    modelName: "Twin Coupe",
    generationName: "Series Two",
    applicabilityId: "app_lumen_in_2024_base",
    salesMarketId: "mkt_fixture_in",
    modelYearId: "year_lumen_in",
    variantId: "var_lumen_in_base",
    pagePath: "/cars/twin-coupe/series-two?market=mkt_fixture_in&year=year_lumen_in&variant=var_lumen_in_base",
  });
  const url = new URL(href);
  const body = url.searchParams.get("body") ?? "";
  assert.equal(url.origin + url.pathname, "https://github.com/aniketmandloi/cart-campuss/issues/new");
  assert.match(url.searchParams.get("title") ?? "", /Lumen Fixture Twin Coupe Series Two/);
  assert.match(body, /Brand: Lumen Fixture/);
  assert.match(body, /Model: Twin Coupe/);
  assert.match(body, /Generation: Series Two/);
  assert.match(body, /Applicability: app_lumen_in_2024_base/);
  assert.match(body, /Sales market: mkt_fixture_in/);
  assert.match(body, /Model year: year_lumen_in/);
  assert.match(body, /Market variant: var_lumen_in_base/);
  assert.match(body, /Page: \/cars\/twin-coupe\/series-two/);
  assert.doesNotMatch(body, /registration|income|emi|finance|reg_fixture_mh/i);
});
