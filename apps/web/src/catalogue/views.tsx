import type { ReactNode } from "react";

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

import { groupFacts, quickFactSlots, separateCounts } from "./facts";
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

export function CatalogueSearchView({ state }: { state: CatalogueSearchState }) {
  return (
    <Frame>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-medium">Search the catalogue</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Search by the car name. A complete record names one market, one model year, and one
          variant, with the source beside each fact.
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
    <main id="catalogue" className="mx-auto w-full max-w-[1120px] px-4 py-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-8">
          {page.privatePreview ? <PreviewNotice /> : null}
          {page.synthetic ? <p>Synthetic fixture. Not a manufacturer publication.</p> : null}
          <TextLink href="/">Search the catalogue</TextLink>
          <header className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{page.identity.brandName}</p>
            <h1 className="text-2xl font-medium">{page.identity.modelName}</h1>
            {"generationName" in page.identity ? <p>{page.identity.generationName}</p> : null}
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
              className="inline-flex min-h-11 items-center bg-primary px-5 text-sm font-medium text-primary-foreground lg:hidden"
            >
              Estimate India cost
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
        <div className="flex min-w-0 flex-col gap-8">
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
    <section className="flex flex-col gap-2" aria-labelledby="model-year">
      <h2 id="model-year" className="text-base font-medium">
        Model year {page.identity.modelYearLabel}
      </h2>
      <p>{page.identity.modelYearConvention}</p>
      <p>
        {page.identity.variantName} · {page.identity.salesMarketName}
      </p>
      {body?.rawValue ? <p>{body.rawValue}</p> : null}
    </section>
  );
}

function QuickFacts({ facts }: { facts: CatalogueFact[] }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="quick-facts">
      <h2 id="quick-facts" className="text-base font-medium">
        Quick facts
      </h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        {quickFactSlots(facts).map((slot) => (
          <div key={slot.label} className="min-w-0">
            <dt className="text-sm text-muted-foreground">{slot.label}</dt>
            <dd className="text-sm">
              {slot.facts.length === 0 ? (
                <Blank />
              ) : (
                slot.facts.map((fact) => (
                  <div key={`${fact.property}-${fact.measurementStandard ?? fact.rawValue ?? fact.state}`}>
                    <FactState fact={fact} />
                    <Freshness fact={fact} />
                  </div>
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
    <section id="overview" className="flex flex-col gap-4" aria-labelledby="catalogue-selection">
      <h2 id="catalogue-selection" className="text-base font-medium">
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
      <SelectorGroup label="Generation" links={page.selector.generations} />
      <SelectorGroup label="Sales market" links={page.selector.markets} />
      <SelectorGroup label="Model year" links={page.selector.years} />
      <SelectorGroup label="Market variant" links={page.selector.variants} />
      {page.selector.records.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Records</h3>
          <ul>
            {page.selector.records.map((record) => (
              <li key={record.href} className="border-b border-border py-2">
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
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{label}</h3>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <TextLink href={link.href} current={link.current}>
              {link.label}
            </TextLink>
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
    <nav aria-label="Dossier sections">
      <ul className="flex flex-wrap gap-x-4">
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
    <section id="cost" className="flex min-w-0 flex-col gap-2 lg:row-span-2" aria-labelledby="india-cost">
      <h2 id="india-cost" className="text-base font-medium">
        India cost
      </h2>
      {page.availability === "incompatible" ? (
        <p>This market, model year, and variant are not a record of this car.</p>
      ) : page.availability === "visible" ? (
        <>
          <h3 id="price-reference" className="text-base font-medium">
            Price reference
          </h3>
          {price ? (
            <>
              <p className="text-2xl font-medium tabular-nums leading-none text-[var(--data)]">
                {price.displayAmount}
              </p>
              <p className="text-sm text-muted-foreground">
                {price.amountMinor} {price.currency} minor units, exponent {price.minorUnitExponent}
              </p>
              <p>{price.basis}</p>
              <p>Tax inclusivity: {price.taxInclusivity}</p>
              <p>Source: {sourceText(price.sourceTitle, price.sourceUrl)}</p>
              {price.sourceIdentifier ? <p>Source identifier: {price.sourceIdentifier}</p> : null}
              <p>Observed {price.observedOn}</p>
              <p>Retrieved {price.retrievedOn}</p>
              <p>Review: {price.reviewStatus}</p>
              {price.reviewedOn ? <p>Reviewed {price.reviewedOn}</p> : null}
              <p>Source policy: {price.policyName}</p>
              <p>Audience: {price.policyAudience}</p>
              <p className="break-words">{price.policyAttribution}</p>
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
    <section id="specs" className="flex flex-col gap-6" aria-labelledby="specs-heading">
      <h2 id="specs-heading" className="text-base font-medium">
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
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{label}</h3>
      {facts.length === 0 ? <p><Blank /></p> : facts.map((fact, index) => (
        <FactRecord key={`${fact.property}-${index}`} fact={fact} />
      ))}
    </section>
  );
}

function ProductionHistory({ claims }: { claims: CatalogueProductionClaim[] }) {
  return (
    <section id="production-history" className="flex flex-col gap-3" aria-labelledby="production-heading">
      <h3 id="production-heading" className="text-sm font-medium">
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
    <section className="flex flex-col gap-3" aria-labelledby="separate-counts">
      <h3 id="separate-counts" className="text-sm font-medium">
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
  return (
    <section id="market" className="flex flex-col gap-2" aria-labelledby="market-heading">
      <h2 id="market-heading" className="text-base font-medium">
        Market
      </h2>
      <h3 id="market-data" className="text-base font-medium">
        {page.availability === "visible" ? page.marketLabel : "No market data"}
      </h3>
      <p className="text-sm text-muted-foreground">
        This record has no directory or feed of market listings.
      </p>
    </section>
  );
}

function SourcesSection({ page }: { page: DossierPage }) {
  return (
    <section id="sources" className="flex flex-col gap-3" aria-labelledby="sources-heading">
      <h2 id="sources-heading" className="text-base font-medium">
        Sources
      </h2>
      <PolicyBlock policy={page.policy} />
      <p>
        <a href={page.correctionHref} className="inline-flex min-h-11 items-center break-words">
          Report a correction
        </a>
      </p>
    </section>
  );
}

function FactRecord({ fact }: { fact: CatalogueFact }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 text-sm">
      <h4 className="font-medium">{fact.property}</h4>
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
      <p>{fact.reviewStatus}</p>
      <Freshness fact={fact} />
      {fact.factualReviewerRef ? <p>Factual reviewer: {fact.factualReviewerRef}</p> : null}
      {fact.rightsReviewerRef ? <p>Rights reviewer: {fact.rightsReviewerRef}</p> : null}
      {fact.conflict ? <ConflictReading conflict={fact.conflict} /> : null}
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
      <p>{fact.rawValue}</p>
      {fact.measurementStandard ? <p>{fact.measurementStandard}</p> : null}
    </>
  );
}

function Freshness({ fact }: { fact: CatalogueFact }) {
  const date = fact.reviewedOn ?? "an unknown date";
  if (fact.freshness === "stale") return <p>Stale. Last reviewed {date}.</p>;
  if (fact.freshness === "not-checked") return <p>Not checked. Last reviewed {date}.</p>;
  return fact.reviewedOn ? <p>Reviewed {fact.reviewedOn}</p> : null;
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
      <h2 id="source-policy" className="text-base font-medium">
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
  return (
    <figure className="bg-card">
      <img src={image.assetUrl} alt={image.altText} className="h-auto w-full" />
      <figcaption className="flex flex-col gap-1 px-4 py-3 text-sm">
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
    return <p id="catalogue-results">The catalogue database is not configured.</p>;
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
        <li
          key={`${hit.scope}-${hit.scope === "applicability" ? hit.applicabilityId : hit.scope === "generation" ? hit.generationId : hit.modelId}`}
          className="border-b border-border py-3"
        >
          <TextLink href={hit.href}>
            {hit.brandName} {hit.modelName}
          </TextLink>
          {hit.scope === "model" ? (
            <p className="text-sm text-muted-foreground">No generation is selected.</p>
          ) : hit.scope === "generation" ? (
            <p className="text-sm text-muted-foreground">
              {hit.generationName}. No variant is selected.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {hit.generationName} · {hit.salesMarketName} · model year {hit.modelYearLabel} ·{" "}
              {hit.variantName}
            </p>
          )}
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
      className="inline-flex min-h-11 items-center break-words hover:underline"
    >
      {children}
    </a>
  );
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
