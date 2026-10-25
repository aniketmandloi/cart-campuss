import type { CSSProperties, ReactNode } from "react";

import type {
  CatalogueAssertion,
  CatalogueCarPage,
  CatalogueFact,
  CatalogueImage,
  CataloguePolicy,
  CatalogueProductionClaim,
  CatalogueSearchResult,
} from "@cart-campuss/api/catalogue";
import type { DossierLink, DossierRecordLink } from "@cart-campuss/api/dossier";

import { CatalogueBrowseSections } from "./browse-view";
import { groupFacts, quickFactSlots, separateCounts } from "./facts";
import type { CatalogueBrowseState } from "./load-state";
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
  | { kind: "redirect"; location: string }
  | { kind: "page"; page: CatalogueCarPage };

type DossierPage = Extract<CatalogueCarPage, { availability: "visible" | "overview" | "incompatible" | "scoped" }>;

export function CatalogueSearchView({
  state,
  registrationId = null,
  browse,
}: {
  state: CatalogueSearchState;
  registrationId?: string | null;
  browse?: CatalogueBrowseState;
}) {
  return (
    <main id="catalogue" className="mx-auto flex w-full max-w-[1120px] flex-col gap-12 px-4 pt-12 pb-16 sm:pt-20">
      <div className="flex max-w-3xl flex-col gap-5">
        <p className="rise text-sm text-muted-foreground" style={stagger(0)}>
          Sourced car records
        </p>
        <h1
          className="rise text-5xl leading-[0.95] font-semibold tracking-[-0.045em] sm:text-7xl"
          style={stagger(1)}
        >
          Search the catalogue
        </h1>
        <p className="rise max-w-xl text-base/relaxed text-muted-foreground" style={stagger(2)}>
          Search by the car name. A complete record names one market, one model year, and one
          variant, with the source beside each fact.
        </p>
      </div>
      {state.privatePreview ? <PreviewNotice /> : null}
      <div className="flex max-w-3xl flex-col gap-6">
        <SearchForm query={state.query} registrationId={registrationId} />
        <SearchStatus state={state} registrationId={registrationId} />
      </div>
      {browse ? <CatalogueBrowseSections state={browse} query={state.query} /> : null}
    </main>
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
  if (state.kind === "redirect") {
    return (
      <Frame>
        <h1 className="text-2xl font-medium">This address has moved</h1>
        <p>The catalogue keeps the current record at its canonical address.</p>
        <TextLink href={state.location}>Open the current record</TextLink>
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
  if (state.page.availability === "redirect") {
    const href = `/cars/${state.page.modelSlug}/${state.page.generationSlug}`;
    return (
      <Frame>
        <h1 className="text-2xl font-medium">This address has moved</h1>
        <p>The catalogue keeps the current record at its canonical address.</p>
        <TextLink href={href}>Open the current record</TextLink>
      </Frame>
    );
  }

  return <DossierPageView page={state.page} />;
}

function DossierPageView({ page }: { page: DossierPage }) {
  const selected = page.availability === "visible";
  const cost = page.sections.find((section) => section.id === "cost");
  return (
    <main id="catalogue" className="mx-auto w-full max-w-[1120px] px-4 pt-8 pb-20 sm:pt-12">
      <div className="grid gap-x-12 gap-y-14 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-12">
          {page.privatePreview ? <PreviewNotice /> : null}
          {page.synthetic ? <p>Synthetic fixture. Not a manufacturer publication.</p> : null}
          <TextLink href="/">Search the catalogue</TextLink>
          <header className="flex flex-col gap-5">
            <p className="rise text-sm text-muted-foreground" style={stagger(0)}>
              {page.identity.brandName}
            </p>
            <h1
              className="rise text-5xl leading-[0.92] font-semibold tracking-[-0.045em] text-balance sm:text-7xl"
              style={stagger(1)}
            >
              {page.identity.modelName}
            </h1>
            {"generationName" in page.identity ? (
              <p className="rise text-lg text-muted-foreground" style={stagger(2)}>
                {page.identity.generationName}
              </p>
            ) : null}
            {page.availability === "scoped" ? (
              <p>
                {page.scope === "model"
                  ? "No generation, model year, or variant is part of this record."
                  : "No market, model year, or variant is part of this record."}
              </p>
            ) : null}
            {page.aliases.map((alias) => (
              <p key={alias}>Also called {alias}</p>
            ))}
            {page.rebadge ? (
              <p>
                Separate model. Related to{" "}
                <TextLink href={page.rebadge.href}>
                  {page.rebadge.brandName} {page.rebadge.modelName}
                </TextLink>
                .
              </p>
            ) : null}
          </header>
          <Photograph image={page.image} />
          {selected ? <SelectedIdentity page={page} /> : null}
          {page.availability === "visible" || page.availability === "scoped" ? (
            <QuickFacts facts={page.facts} />
          ) : null}
          {cost ? (
            <a
              href={cost.href}
              className="flex h-14 items-center justify-between bg-primary px-5 text-base font-medium text-primary-foreground transition-transform duration-200 active:scale-[0.99] lg:hidden"
            >
              Estimate India cost
              <span aria-hidden="true">↓</span>
            </a>
          ) : null}
          <ApplicabilitySelector page={page} />
          <SectionNav page={page} />
          {page.context.registration ? (
            <p>
              Registration jurisdiction: {page.context.registration}. Not a tax calculation.
            </p>
          ) : null}
        </div>
        <CostSection page={page} />
        <div className="flex min-w-0 flex-col gap-14 lg:col-start-1 lg:row-start-2">
          <SpecsSection page={page} />
          <MarketSection page={page} />
          <SourcesSection page={page} />
        </div>
      </div>
    </main>
  );
}

function SelectedIdentity({
  page,
}: {
  page: Extract<CatalogueCarPage, { availability: "visible" }>;
}) {
  const body = page.facts.find((fact) => fact.property === "Body" && fact.state === "known");
  return (
    <section className="rise-on-scroll flex flex-col gap-4 border-t border-border pt-8" aria-labelledby="model-year">
      <h2 id="model-year" className="text-2xl font-semibold tracking-tight">
        Model year {page.identity.modelYearLabel}
      </h2>
      <p>{page.identity.modelYearConvention}</p>
      <p className="text-muted-foreground">
        {page.identity.variantName} · {page.identity.salesMarketName}
      </p>
      {body?.rawValue ? <p>{body.rawValue}</p> : null}
    </section>
  );
}

function QuickFacts({ facts }: { facts: CatalogueFact[] }) {
  return (
    <section className="rise-on-scroll flex flex-col gap-4" aria-labelledby="quick-facts">
      <h2 id="quick-facts" className="text-2xl font-semibold tracking-tight">
        Quick facts
      </h2>
      <dl className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3">
        {quickFactSlots(facts).map((slot) => (
          <div key={slot.label} className="min-w-0 bg-background p-4">
            <dt className="text-sm text-muted-foreground">{slot.label}</dt>
            <dd className="mt-2 text-base">
              {slot.facts.length === 0 ? (
                <Blank />
              ) : (
                slot.facts.map((fact) => (
                  <Rail key={`${fact.property}-${fact.measurementStandard ?? fact.rawValue ?? fact.state}`} freshness={fact.freshness}>
                    <FactState fact={fact} />
                    <ReviewState freshness={fact.freshness} reviewedOn={fact.reviewedOn} />
                  </Rail>
                ))
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ApplicabilitySelector({ page }: { page: DossierPage }) {
  return (
    <section id="overview" className="rise-on-scroll flex flex-col gap-6 scroll-mt-28" aria-labelledby="catalogue-selection">
      <h2 id="catalogue-selection" className="text-2xl font-semibold tracking-tight">
        Overview
      </h2>
      {page.availability === "incompatible" ? (
        <p>This market, model year, and variant are not a record of this car.</p>
      ) : page.availability === "overview" ? (
        <p>Specifications are shown only after you choose a market, model year, and variant.</p>
      ) : page.availability === "scoped" && page.scope === "model" ? (
        <p>This record is the model. It does not name a generation, model year, or variant.</p>
      ) : page.availability === "scoped" ? (
        <p>This record is the generation. It does not name a market, model year, or variant.</p>
      ) : (
        <p>Choose another market, model year, or variant to read that record.</p>
      )}
      <div className="grid gap-6 sm:grid-cols-2">
        <SelectorGroup label="Generation" links={page.selector.generations} />
        <SelectorGroup label="Sales market" links={page.selector.markets} />
        <SelectorGroup label="Model year" links={page.selector.years} />
        <SelectorGroup label="Market variant" links={page.selector.variants} />
      </div>
      {page.selector.records.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">Records</h3>
          <ul className="flex flex-col border-t border-border">
            {page.selector.records.map((record) => (
              <li key={record.href} className="border-b border-border py-3">
                <RecordLink record={record} />
              </li>
            ))}
          </ul>
        </div>
      ) : page.availability === "scoped" && page.scope === "model" ? (
        <p>No generation is part of this record.</p>
      ) : (
        <p>No applicability record is published for this generation.</p>
      )}
    </section>
  );
}

function SelectorGroup({ label, links }: { label: string; links: DossierLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">{label}</h3>
      <ul className="flex flex-wrap gap-2">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              aria-current={link.current ? "true" : undefined}
              className="inline-flex min-h-11 items-center border border-border px-4 text-sm transition-colors duration-200 hover:border-foreground aria-[current=true]:border-foreground aria-[current=true]:bg-foreground aria-[current=true]:text-background"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecordLink({ record }: { record: DossierRecordLink }) {
  return (
    <>
      <TextLink href={record.href} current={record.current}>
        {record.label}
      </TextLink>
      <p className="text-sm text-muted-foreground">{record.detail}</p>
    </>
  );
}

function SectionNav({ page }: { page: DossierPage }) {
  return (
    <nav
      aria-label="Dossier sections"
      className="sticky top-14 z-10 -mx-4 overflow-x-auto border-y border-border bg-background/85 px-4 backdrop-blur-md"
    >
      <ul className="flex gap-6 whitespace-nowrap">
        {page.sections.map((section) => (
          <li key={section.id}>
            <TextLink href={section.href} current={section.current}>
              {section.label}
            </TextLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function CostSection({ page }: { page: DossierPage }) {
  const price = page.availability === "visible" ? page.priceReference : null;
  return (
    <section
      id="cost"
      className="rise-on-scroll flex min-w-0 scroll-mt-28 flex-col gap-6 border border-border bg-card p-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
      aria-labelledby="india-cost"
    >
      <h2 id="india-cost" className="text-2xl font-semibold tracking-tight">
        India cost
      </h2>
      {page.availability === "incompatible" ? (
        <p>This market, model year, and variant are not a record of this car.</p>
      ) : page.availability === "visible" ? (
        <>
          <h3 id="price-reference" className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Price reference
          </h3>
          {price ? (
            <>
              <p className="text-5xl leading-none font-semibold tracking-tight text-data tabular-nums">
                {price.displayAmount}
              </p>
              <div className="flex flex-col gap-2 border-t border-border pt-5 text-sm text-muted-foreground">
                <p>
                  {price.amountMinor} {price.currency} minor units, exponent {price.minorUnitExponent}
                </p>
                <p>{price.basis}</p>
                <p>Tax inclusivity: {price.taxInclusivity}</p>
                <p>Source: {sourceText(price.sourceTitle, price.sourceUrl)}</p>
                {price.sourceIdentifier ? <p>Source identifier: {price.sourceIdentifier}</p> : null}
                <p>Observed {price.observedOn}</p>
                <p>Retrieved {price.retrievedOn}</p>
                {price.fetchedAt ? <p>Fetched {price.fetchedAt}</p> : null}
                {price.lastSuccessfulProviderSyncAt ? (
                  <p>Last provider sync {price.lastSuccessfulProviderSyncAt}</p>
                ) : null}
                <p>Review: {price.reviewStatus}</p>
                <ReviewState freshness={price.freshness} reviewedOn={price.reviewedOn} />
                {price.nextRecheckAt ? <p>Next recheck {price.nextRecheckAt}</p> : null}
                <p>Source policy: {price.policyName}</p>
                <p>Audience: {price.policyAudience}</p>
                <p className="break-words">{price.policyAttribution}</p>
              </div>
            </>
          ) : (
            <p>No reviewed price reference.</p>
          )}
          <p>Not a listing.</p>
          <p>Not a purchase total.</p>
        </>
      ) : (
        <p>Comparison and finance wait until a market, model year, and variant are selected.</p>
      )}
    </section>
  );
}

function SpecsSection({ page }: { page: DossierPage }) {
  const evidenced = page.availability === "visible" || page.availability === "scoped";
  const facts = evidenced ? page.facts : [];
  const claims = evidenced ? page.productionClaims : [];
  return (
    <section id="specs" className="rise-on-scroll flex scroll-mt-28 flex-col gap-10" aria-labelledby="specs-heading">
      <h2 id="specs-heading" className="text-2xl font-semibold tracking-tight">
        Specs
      </h2>
      {evidenced ? (
        <>
          {groupFacts(facts).map((group) => (
            <FactGroup key={group.id} label={group.label} facts={group.facts} />
          ))}
          <ProductionHistory claims={claims} />
          <SeparateCounts facts={separateCounts(facts)} />
        </>
      ) : page.availability === "incompatible" ? (
        <p>This market, model year, and variant are not a record of this car.</p>
      ) : (
        <p>Specifications are shown only after you choose a market, model year, and variant.</p>
      )}
    </section>
  );
}

function FactGroup({ label, facts }: { label: string; facts: CatalogueFact[] }) {
  return (
    <section className="flex flex-col">
      <h3 className="pb-3 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">{label}</h3>
      {facts.length === 0 ? <p><Blank /></p> : facts.map((fact, index) => (
        <FactRecord key={`${fact.property}-${index}`} fact={fact} />
      ))}
    </section>
  );
}

function ProductionHistory({ claims }: { claims: CatalogueProductionClaim[] }) {
  return (
    <section id="production-history" className="flex flex-col gap-4" aria-labelledby="production-heading">
      <h3 id="production-heading" className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Production history
      </h3>
      {claims.length === 0 ? (
        <p>
          Production is <Blank />
        </p>
      ) : (
        claims.map((claim) => (
          <div key={`${claim.scope}-${claim.period}-${claim.status}`} className="flex flex-col gap-1 text-sm">
            <p>
              {claim.status === "completed" ? "Completed" : "Planned"} {claim.count}
            </p>
            <p>
              {claim.scope}. {claim.geography}. {claim.period}.
            </p>
            <p>Counted: {claim.counted}</p>
            <p>Source: {sourceText(claim.sourceTitle, claim.sourceUrl)}</p>
            <p>Source policy: {claim.policyName}</p>
            <p>Audience: {claim.policyAudience}</p>
            <p>{claim.policyAttribution}</p>
            <p>Retrieved {claim.retrievedOn}</p>
            {claim.observedOn ? <p>Observed {claim.observedOn}</p> : null}
            <p>Review: {claim.reviewStatus}</p>
            {claim.reviewedOn ? <p>Reviewed {claim.reviewedOn}</p> : null}
          </div>
        ))
      )}
    </section>
  );
}

function SeparateCounts({ facts }: { facts: CatalogueFact[] }) {
  if (facts.length === 0) return null;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="separate-counts">
      <h3 id="separate-counts" className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Sales, registrations, and exports
      </h3>
      <p>These counts are not production.</p>
      {facts.map((fact, index) => (
        <FactRecord key={`${fact.property}-${index}`} fact={fact} />
      ))}
    </section>
  );
}

function MarketSection({ page }: { page: DossierPage }) {
  const directory = page.availability === "visible" ? (page.marketDirectory ?? []) : [];
  const listings = page.availability === "visible" ? (page.marketListings ?? []) : [];
  const label = page.availability === "visible" ? page.marketLabel : "No market data";
  return (
    <section id="market" className="rise-on-scroll flex scroll-mt-28 flex-col gap-4" aria-labelledby="market-heading">
      <h2 id="market-heading" className="text-2xl font-semibold tracking-tight">
        Market
      </h2>
      <h3 id="market-data" className="text-lg font-medium">
        {label}
      </h3>
      {directory.length === 0 && listings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This record has no directory or feed of market listings.
        </p>
      ) : null}
      {directory.map((entry) => (
        <div key={entry.url} className="flex flex-col gap-1 border-b border-border py-4 text-sm">
          <p>{entry.title}</p>
          <a className="link-draw break-all" href={entry.url} rel="noreferrer noopener" target="_blank">
            {entry.url}
          </a>
          <ReviewState freshness={entry.freshness} reviewedOn={entry.lastReviewedAt} />
          {entry.lastSuccessfulProviderSyncAt ? (
            <p>Last provider sync {entry.lastSuccessfulProviderSyncAt}</p>
          ) : null}
          {entry.nextRecheckAt ? <p>Next recheck {entry.nextRecheckAt}</p> : null}
        </div>
      ))}
      {listings.map((listing) => (
        <div key={listing.url} className="flex flex-col gap-1 border-b border-border py-4 text-sm">
          <p>{listing.title}</p>
          <a className="link-draw break-all" href={listing.url} rel="noreferrer noopener" target="_blank">
            {listing.url}
          </a>
          <p>{listing.priceType}</p>
          {listing.displayAmount ? <p>{listing.displayAmount}</p> : null}
          {listing.amountMinor !== null && listing.currency ? (
            <p>
              {listing.amountMinor} {listing.currency} minor units
            </p>
          ) : null}
          <ListingState listing={listing} />
        </div>
      ))}
    </section>
  );
}

function ReviewState({
  freshness,
  reviewedOn,
}: {
  freshness?: "current" | "stale" | "not-checked";
  reviewedOn: string | null;
}) {
  const date = reviewedOn ?? "an unknown date";
  if (freshness === "stale") return <p>Stale. Last reviewed {date}.</p>;
  if (freshness === "not-checked") return <p>Not checked. Last reviewed {date}.</p>;
  return reviewedOn ? <p>Reviewed {reviewedOn}</p> : null;
}

function ListingState({
  listing,
}: {
  listing: { presentation: "active" | "unknown" | "historical" | "ended"; observedAt: string };
}) {
  if (listing.presentation === "ended") return <p>Ended. Last observed {listing.observedAt}.</p>;
  if (listing.presentation === "unknown") return <p>Status unknown. Last observed {listing.observedAt}.</p>;
  if (listing.presentation === "historical") {
    return <p>Not a current listing. Last observed {listing.observedAt}.</p>;
  }
  return <p>Active as last observed {listing.observedAt}.</p>;
}

function SourcesSection({ page }: { page: DossierPage }) {
  return (
    <section id="sources" className="rise-on-scroll flex scroll-mt-28 flex-col gap-6" aria-labelledby="sources-heading">
      <h2 id="sources-heading" className="text-2xl font-semibold tracking-tight">
        Sources
      </h2>
      <PolicyBlock policy={page.policy} />
      <p>
        <a href={page.correctionHref} className="link-draw inline-flex min-h-11 items-center break-words">
          Report a correction
        </a>
      </p>
    </section>
  );
}

function FactRecord({ fact }: { fact: CatalogueFact }) {
  return (
    <div
      className={`grid gap-x-8 gap-y-3 border-b border-l-2 py-5 pl-4 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] ${RAIL_TONE[fact.freshness ?? "current"]}`}
    >
      <h4 className="font-medium">{fact.property}</h4>
      <div className="flex min-w-0 flex-col gap-1 text-muted-foreground">
        <FactState fact={fact} />
        {fact.curatedReason ? <p>{fact.curatedReason}</p> : null}
        {fact.state === "known" || fact.state === "unknown" ? (
          <>
            <p>
              Normalized: <MaybeValue value={fact.state === "known" ? fact.normalizedValue : null} />
            </p>
            <p>
              Unit: <MaybeValue value={fact.state === "known" ? fact.unit : null} />
            </p>
            <p>
              Standard:{" "}
              <MaybeValue value={fact.state === "known" ? fact.measurementStandard : null} />
            </p>
          </>
        ) : null}
        <p className="break-words">{sourceText(fact.sourceTitle, fact.sourceUrl)}</p>
        <p>{fact.policyName}</p>
        <p>Audience: {fact.policyAudience}</p>
        <p className="break-words">{fact.policyAttribution}</p>
        <p>Retrieved {fact.retrievedOn}</p>
        {fact.observedOn ? <p>Observed {fact.observedOn}</p> : null}
        {fact.fetchedAt ? <p>Fetched {fact.fetchedAt}</p> : null}
        {fact.lastSuccessfulProviderSyncAt ? (
          <p>Last provider sync {fact.lastSuccessfulProviderSyncAt}</p>
        ) : null}
        <p>{fact.reviewStatus}</p>
        <ReviewState freshness={fact.freshness} reviewedOn={fact.reviewedOn} />
        {fact.nextRecheckAt ? <p>Next recheck {fact.nextRecheckAt}</p> : null}
        {fact.factualReviewerRef ? <p>Factual reviewer: {fact.factualReviewerRef}</p> : null}
        {fact.rightsReviewerRef ? <p>Rights reviewer: {fact.rightsReviewerRef}</p> : null}
        {fact.conflict ? <ConflictReading conflict={fact.conflict} /> : null}
      </div>
    </div>
  );
}

function FactState({ fact }: { fact: CatalogueFact }) {
  if (fact.state === "not-applicable") {
    return (
      <>
        <p>Not applicable</p>
        {fact.unknownReason ? <p>{fact.unknownReason}</p> : null}
      </>
    );
  }
  if (fact.state === "withheld") {
    return (
      <>
        <p>Withheld by rights</p>
        {fact.unknownReason ? <p>{fact.unknownReason}</p> : null}
      </>
    );
  }
  if (fact.state === "unknown") {
    return (
      <>
        <Blank />
        {fact.unknownReason ? <p>{fact.unknownReason}</p> : null}
      </>
    );
  }
  return (
    <>
      <p className="text-base text-foreground">{fact.rawValue}</p>
      {fact.measurementStandard ? <p>{fact.measurementStandard}</p> : null}
    </>
  );
}

function ConflictReading({ conflict }: { conflict: CatalogueAssertion }) {
  return (
    <>
      <p>Conflicting reading</p>
      <p>
        Raw: <MaybeValue value={conflict.rawValue} />
      </p>
      <p>
        Normalized: <MaybeValue value={conflict.normalizedValue} />
      </p>
      <p>
        Unit: <MaybeValue value={conflict.unit} />
      </p>
      <p>
        Standard: <MaybeValue value={conflict.measurementStandard} />
      </p>
      <p>Source: {sourceText(conflict.sourceTitle, conflict.sourceUrl)}</p>
      <p>Conflicting source policy: {conflict.policyName}</p>
      <p>Audience: {conflict.policyAudience}</p>
      <p>{conflict.policyAttribution}</p>
      <p>Observed {conflict.observedOn ?? "an unknown date"}</p>
      <p>Retrieved {conflict.retrievedOn}</p>
      <p>Review: {conflict.reviewStatus}</p>
      {conflict.reviewedOn ? <p>Reviewed {conflict.reviewedOn}</p> : null}
      {conflict.factualReviewerRef ? <p>Factual reviewer: {conflict.factualReviewerRef}</p> : null}
      {conflict.rightsReviewerRef ? <p>Rights reviewer: {conflict.rightsReviewerRef}</p> : null}
    </>
  );
}

function PolicyBlock({ policy }: { policy: CataloguePolicy }) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="source-policy">
      <h2 id="source-policy" className="text-lg font-semibold">
        Source policy
      </h2>
      <p>{policy.name}</p>
      <p>Audience: {policy.audience}</p>
      <p className="break-words">{policy.attribution}</p>
      {policy.policyReviewerRef ? <p>Policy reviewer: {policy.policyReviewerRef}</p> : null}
      {policy.factualReviewerRef ? <p>Factual reviewer: {policy.factualReviewerRef}</p> : null}
      {policy.rightsReviewerRef ? <p>Rights reviewer: {policy.rightsReviewerRef}</p> : null}
    </section>
  );
}

function Photograph({ image }: { image: CatalogueImage | null }) {
  if (!image) {
    return (
      <figure className="rise border border-dashed border-border bg-card" style={stagger(3)}>
        <div className="flex aspect-[16/9] items-center justify-center text-muted-foreground" aria-hidden="true">
          <DossierMark />
        </div>
        <figcaption className="border-t border-dashed border-border px-4 py-3 text-sm">
          No catalogue photograph
          <span className="mt-1 block text-muted-foreground">
            This record has no rights-cleared image.
          </span>
        </figcaption>
      </figure>
    );
  }
  return (
    <figure className="rise border border-border bg-card" style={stagger(3)}>
      <img src={image.assetUrl} alt={image.altText} className="h-auto w-full" />
      <figcaption className="flex flex-col gap-1 border-t border-border px-4 py-3 text-sm text-muted-foreground">
        <p>{image.credit}</p>
        <p>{image.licence}</p>
        {image.sourceUrl && /^https?:\/\//i.test(image.sourceUrl) ? (
          <a href={image.sourceUrl} rel="noreferrer" className="break-words">
            {image.sourceUrl}
          </a>
        ) : null}
      </figcaption>
    </figure>
  );
}

function SearchForm({ query, registrationId }: { query: string; registrationId?: string | null }) {
  return (
    <form method="get" action="/" role="search" className="rise flex flex-col gap-3" style={stagger(3)}>
      <label htmlFor="catalogue-query" className="text-sm text-muted-foreground">
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
          className="h-14 w-full border border-border bg-card px-4 text-lg text-foreground transition-colors duration-300 placeholder:text-muted-foreground focus:border-foreground"
        />
        <button
          type="submit"
          className="h-14 bg-primary px-8 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-200 hover:bg-foreground/85 active:scale-[0.98]"
        >
          Search
        </button>
      </div>
      {registrationId ? <input type="hidden" name="registration" value={registrationId} /> : null}
    </form>
  );
}

function SearchStatus({
  state,
  registrationId,
}: {
  state: CatalogueSearchState;
  registrationId?: string | null;
}) {
  if (state.kind === "unconfigured") {
    return <p id="catalogue-results" className="text-muted-foreground">The catalogue database is not configured.</p>;
  }
  if (state.kind === "unavailable") {
    return <p id="catalogue-results" className="text-muted-foreground">The catalogue could not be read.</p>;
  }
  if (state.kind === "invalid") {
    return <p id="catalogue-results" className="text-muted-foreground">Use 80 characters or fewer.</p>;
  }
  if (state.kind === "idle") return null;
  if (state.result.hits.length === 0) {
    return <p id="catalogue-results" className="text-muted-foreground">No published record matches this search.</p>;
  }
  return (
    <ul id="catalogue-results" className="flex flex-col border-t border-border">
      {state.result.hits.map((hit, index) => (
        <li
          key={`${hit.scope}-${hit.scope === "applicability" ? hit.applicabilityId : hit.scope === "generation" ? hit.generationId : hit.modelId}`}
          className="rise border-b border-border"
          style={stagger(index + 4)}
        >
          <a
            href={withRegistration(hit.href, registrationId)}
            className="group grid gap-3 py-5 transition-colors duration-300 hover:bg-card sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-4"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-3 text-xl font-medium tracking-tight">
                {hit.brandName} {hit.modelName}
                <span
                  aria-hidden="true"
                  className="text-muted-foreground transition-transform duration-300 group-hover:translate-x-1 group-hover:text-foreground"
                >
                  →
                </span>
              </span>
              {hit.scope === "model" ? (
                <span className="text-sm text-muted-foreground">No generation is selected.</span>
              ) : hit.scope === "generation" ? (
                <span className="text-sm text-muted-foreground">
                  {hit.generationName}. No variant is selected.
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {hit.generationName} · {hit.salesMarketName} · model year {hit.modelYearLabel} ·{" "}
                  {hit.variantName}
                </span>
              )}
            </span>
            <span className="flex flex-wrap gap-2 text-xs">
              <span className="border border-border px-2 py-1 text-muted-foreground">
                {hit.match === "exact" ? "Exact name" : "Name begins with the query"}
              </span>
              {hit.synthetic ? (
                <span className="border border-stale px-2 py-1 text-stale">Synthetic fixture</span>
              ) : null}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function withRegistration(href: string, registrationId: string | null | undefined): string {
  if (!registrationId) return href;
  const url = new URL(href, "http://catalogue.local");
  if (url.searchParams.has("registration")) return `${url.pathname}${url.search}`;
  url.searchParams.set("registration", registrationId);
  return `${url.pathname}${url.search}`;
}

function PreviewNotice() {
  return (
    <p className="max-w-3xl border-l-2 border-stale pl-4 text-sm text-foreground">
      Private preview. Synthetic records are labelled and stay out of the public catalogue.
    </p>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main id="catalogue" className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-12 pb-16 sm:pt-20">
      {children}
    </main>
  );
}

function stagger(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

function TextLink({
  href,
  children,
  current = false,
}: {
  href: string;
  children: ReactNode;
  current?: boolean;
}) {
  return (
    <a
      href={href}
      aria-current={current ? "true" : undefined}
      className="link-draw inline-flex min-h-11 items-center break-words"
    >
      {children}
    </a>
  );
}

function MaybeValue({ value }: { value: string | null }) {
  if (!value) return <Blank />;
  return value;
}

const RAIL_TONE = {
  current: "border-l-foreground/40",
  stale: "border-l-stale",
  "not-checked": "border-l-faint/35",
} as const;

function Rail({
  freshness = "current",
  children,
}: {
  freshness?: "current" | "stale" | "not-checked";
  children: ReactNode;
}) {
  return (
    <div className={`mb-4 flex min-w-0 flex-col gap-1 border-l-2 pl-4 last:mb-0 ${RAIL_TONE[freshness]}`}>
      {children}
    </div>
  );
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
      <a href={url} rel="noreferrer" className="link-draw">
        {title}
      </a>
    );
  }
  return title;
}
