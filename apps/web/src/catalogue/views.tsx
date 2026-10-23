import type { ReactNode } from "react";

import type {
  CatalogueCarPage,
  CatalogueFact,
  CatalogueSearchResult,
} from "@cart-campuss/api/catalogue";

import { DossierMark } from "./mark";

export type CatalogueSearchState = {
  query: string;
  privatePreview: boolean;
} & (
  | { kind: "unconfigured" }
  | { kind: "unavailable" }
  | { kind: "invalid" }
  | { kind: "idle" }
  | { kind: "results"; result: CatalogueSearchResult }
);

export type CatalogueDetailState =
  | { kind: "unconfigured" }
  | { kind: "unavailable" }
  | { kind: "page"; page: CatalogueCarPage };

export function CatalogueSearchView({ state }: { state: CatalogueSearchState }) {
  return (
    <Frame>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-medium">Search the catalogue</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Search by the car name. A result opens one market, one model year, and one variant, with
          the source beside each fact.
        </p>
      </div>
      {state.privatePreview ? <PreviewNotice /> : null}
      <SearchForm query={state.query} />
      <SearchStatus state={state} />
    </Frame>
  );
}

export function CatalogueDetailView({ state }: { state: CatalogueDetailState }) {
  if (state.kind === "unconfigured") {
    return (
      <Frame>
        <h1 className="text-3xl font-medium">Catalogue</h1>
        <p>The catalogue database is not configured.</p>
        <TextLink href="/">Search the catalogue</TextLink>
      </Frame>
    );
  }
  if (state.kind === "unavailable") {
    return (
      <Frame>
        <h1 className="text-3xl font-medium">Catalogue</h1>
        <p>The catalogue could not be read.</p>
        <TextLink href="/">Search the catalogue</TextLink>
      </Frame>
    );
  }
  if (state.page.availability === "not-in-public-catalogue") {
    return (
      <Frame>
        <h1 className="text-3xl font-medium">Not in the public catalogue</h1>
        <p>This address does not match a published record.</p>
        <TextLink href="/">Search the catalogue</TextLink>
      </Frame>
    );
  }

  const { page } = state;
  return (
    <Frame>
      {page.privatePreview ? <PreviewNotice /> : null}
      {page.synthetic ? (
        <p>Synthetic fixture. Not a manufacturer publication.</p>
      ) : null}
      <TextLink href="/">Search the catalogue</TextLink>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{page.identity.brandName}</p>
        <h1 className="text-3xl font-medium">{page.identity.modelName}</h1>
        <p>{page.identity.generationName}</p>
      </div>
      <Photograph />
      {page.availability === "overview" ? <Overview page={page} /> : <Dossier page={page} />}
    </Frame>
  );
}

function Overview({
  page,
}: {
  page: Extract<CatalogueCarPage, { availability: "overview" }>;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="catalogue-selection">
      <h2 id="catalogue-selection" className="text-base font-medium">
        Choose a record
      </h2>
      <p className="text-sm text-muted-foreground">
        Specifications are shown only after you choose a market, model year, and variant.
      </p>
      <ul>
        {page.selections.map((selection) => (
          <li key={selection.href} className="border-b border-border">
            <TextLink href={selection.href}>
              {selection.salesMarketName}, model year {selection.modelYearLabel},{" "}
              {selection.variantName}
            </TextLink>
          </li>
        ))}
      </ul>
      <PolicyBlock policy={page.policy} />
    </section>
  );
}

function Dossier({ page }: { page: Extract<CatalogueCarPage, { availability: "visible" }> }) {
  const { identity, priceReference } = page;
  return (
    <>
      <section className="flex flex-col gap-2" aria-labelledby="model-year">
        <h2 id="model-year" className="text-base font-medium">
          Model year {identity.modelYearLabel}
        </h2>
        <p>{identity.modelYearConvention}</p>
        <p>
          {identity.variantName} · {identity.salesMarketName}
        </p>
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="price-reference">
        <h2 id="price-reference" className="text-base font-medium">
          Price reference
        </h2>
        {priceReference ? (
          <>
            <p className="text-[1.75rem] font-medium leading-none text-[var(--data)]">
              {priceReference.displayAmount}
            </p>
            <p className="text-sm text-muted-foreground">
              {priceReference.amountMinor} {priceReference.currency} minor units, exponent{" "}
              {priceReference.minorUnitExponent}
            </p>
            <p>{priceReference.basis}</p>
            <p>Tax inclusivity: {priceReference.taxInclusivity}</p>
            <p>Observed {priceReference.observedOn}</p>
            <p>Review: {priceReference.reviewStatus}</p>
            <p>Source policy: {priceReference.policyName}</p>
          </>
        ) : (
          <p>No reviewed price reference.</p>
        )}
        <p>Not a listing.</p>
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="market-data">
        <h2 id="market-data" className="text-base font-medium">
          {page.marketLabel}
        </h2>
        <p className="text-sm text-muted-foreground">
          This record has no directory or feed of market listings.
        </p>
      </section>
      <PolicyBlock policy={page.policy} />
      <Facts facts={page.facts} />
    </>
  );
}

function Facts({ facts }: { facts: CatalogueFact[] }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="sourced-facts">
      <h2 id="sourced-facts" className="text-base font-medium">
        Sourced facts
      </h2>
      <div className="overflow-x-auto" tabIndex={0} aria-label="Sourced facts">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              <Column>Property</Column>
              <Column>Raw</Column>
              <Column>Normalized</Column>
              <Column>Unit</Column>
              <Column>Standard</Column>
              <Column>Source</Column>
              <Column>Review</Column>
            </tr>
          </thead>
          <tbody>
            {facts.map((fact) => (
              <tr key={`${fact.property}-${fact.rawValue ?? fact.unknownReason ?? "unknown"}`}>
                <Cell>{fact.property}</Cell>
                <Cell>
                  {fact.state === "unknown" ? (
                    <>
                      <Blank />
                      {fact.unknownReason ? <p>{fact.unknownReason}</p> : null}
                    </>
                  ) : (
                    <>
                      <p>{fact.rawValue}</p>
                      {fact.curatedReason ? <p>{fact.curatedReason}</p> : null}
                    </>
                  )}
                  {fact.conflict ? (
                    <p>
                      Conflicting reading {fact.conflict.rawValue} from {fact.conflict.sourceTitle}
                      , observed {fact.conflict.observedOn ?? "an unknown date"}, review{" "}
                      {fact.conflict.reviewStatus}.
                    </p>
                  ) : null}
                </Cell>
                <Cell>
                  <MaybeValue value={fact.normalizedValue} />
                </Cell>
                <Cell>
                  <MaybeValue value={fact.unit} />
                </Cell>
                <Cell>
                  <MaybeValue value={fact.measurementStandard} />
                </Cell>
                <Cell>
                  <p>{sourceText(fact.sourceTitle, fact.sourceUrl)}</p>
                  <p>{fact.policyName}</p>
                  <p>Audience: {fact.policyAudience}</p>
                  <p>{fact.policyAttribution}</p>
                  <p>Retrieved {fact.retrievedOn}</p>
                  {fact.observedOn ? <p>Observed {fact.observedOn}</p> : null}
                </Cell>
                <Cell>
                  <p>{fact.reviewStatus}</p>
                  {fact.reviewedOn ? <p>Reviewed {fact.reviewedOn}</p> : null}
                </Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PolicyBlock({
  policy,
}: {
  policy: { name: string; audience: string; attribution: string };
}) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="source-policy">
      <h2 id="source-policy" className="text-base font-medium">
        Source policy
      </h2>
      <p>{policy.name}</p>
      <p>Audience: {policy.audience}</p>
      <p>{policy.attribution}</p>
    </section>
  );
}

function Photograph() {
  return (
    <figure className="bg-card">
      <div className="flex h-36 items-center justify-center" aria-hidden="true">
        <DossierMark />
      </div>
      <figcaption className="px-4 py-3 text-sm">
        No catalogue photograph
        <span className="mt-1 block text-muted-foreground">
          This record has no rights-cleared image.
        </span>
      </figcaption>
    </figure>
  );
}

function SearchForm({ query }: { query: string }) {
  return (
    <form method="get" action="/" role="search" className="flex flex-col gap-3">
      <label htmlFor="catalogue-query" className="text-sm">
        Car name
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="catalogue-query"
          name="q"
          defaultValue={query}
          maxLength={80}
          autoComplete="off"
          enterKeyHint="search"
          className="min-h-11 w-full border border-border bg-card px-3 text-base text-foreground"
        />
        <button
          type="submit"
          className="min-h-11 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          Search
        </button>
      </div>
    </form>
  );
}

function SearchStatus({ state }: { state: CatalogueSearchState }) {
  if (state.kind === "unconfigured") {
    return (
      <p id="catalogue-results">
        The catalogue database is not configured.
      </p>
    );
  }
  if (state.kind === "unavailable") {
    return <p id="catalogue-results">The catalogue could not be read.</p>;
  }
  if (state.kind === "invalid") {
    return <p id="catalogue-results">Use 80 characters or fewer.</p>;
  }
  if (state.kind === "idle") return null;
  if (state.result.hits.length === 0) {
    return <p id="catalogue-results">No published record matches this search.</p>;
  }
  return (
    <ul id="catalogue-results">
      {state.result.hits.map((hit) => (
        <li key={hit.applicabilityId} className="border-b border-border py-3">
          <TextLink href={hit.href}>
            {hit.brandName} {hit.modelName}
          </TextLink>
          <p className="text-sm text-muted-foreground">
            {hit.generationName} · {hit.salesMarketName} · model year {hit.modelYearLabel} ·{" "}
            {hit.variantName}
          </p>
          <p className="text-sm">
            {hit.match === "exact" ? "Exact name" : "Name begins with the query"}
          </p>
          {hit.synthetic ? <p className="text-sm">Synthetic fixture</p> : null}
        </li>
      ))}
    </ul>
  );
}

function PreviewNotice() {
  return (
    <p>Private preview. Synthetic records are labelled and stay out of the public catalogue.</p>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main id="catalogue" className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8">
      {children}
    </main>
  );
}

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="inline-flex min-h-11 items-center hover:underline">
      {children}
    </a>
  );
}

function Column({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="border-b border-border py-3 pr-4 font-medium">
      {children}
    </th>
  );
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="border-b border-border py-3 pr-4 align-top">{children}</td>;
}

function MaybeValue({ value }: { value: string | null }) {
  if (!value) return <Blank />;
  return value;
}

function Blank() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only"> not documented</span>
    </>
  );
}

function sourceText(title: string, url: string | null) {
  if (url && /^https?:\/\//i.test(url)) {
    return (
      <a href={url} rel="noreferrer">
        {title}
      </a>
    );
  }
  return title;
}
