import type { CatalogueBrandPage, CatalogueCollectionView, CatalogueHome } from "@cart-campuss/api/browse";
import { Button } from "@cart-campuss/ui/components/button";

import type { CatalogueBrandState, CatalogueBrowseState } from "./load-state";

export function CatalogueBrowseSections({
  state,
  query,
}: {
  state: CatalogueBrowseState;
  query: string;
}) {
  if (state.kind === "unconfigured") return null;
  if (state.kind === "unavailable") {
    return <p>The catalogue could not be read.</p>;
  }
  const home = state.home;
  return (
    <div className="flex flex-col gap-16">
      <CoverageNote home={home} />
      <JurisdictionForm home={home} query={query} />
      <BrandIndex home={home} />
      <Collections home={home} />
    </div>
  );
}

export function CatalogueBrandView({ state }: { state: CatalogueBrandState }) {
  if (state.kind === "unconfigured") {
    return (
      <main id="catalogue" className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 pt-12 pb-16">
        <h1 className="text-3xl font-medium">Catalogue</h1>
        <p>The catalogue database is not configured.</p>
        <a href="/" className="inline-flex min-h-11 items-center">Search the catalogue</a>
      </main>
    );
  }
  if (state.kind === "unavailable") {
    return (
      <main id="catalogue" className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 pt-12 pb-16">
        <h1 className="text-3xl font-medium">Catalogue</h1>
        <p>The catalogue could not be read.</p>
        <a href="/" className="inline-flex min-h-11 items-center">Search the catalogue</a>
      </main>
    );
  }
  if (state.page.availability === "not-in-public-catalogue") {
    return (
      <main id="catalogue" className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 pt-12 pb-16">
        <h1 className="text-3xl font-medium">Not in the public catalogue</h1>
        <p>This address does not match a published brand.</p>
        <a href="/" className="inline-flex min-h-11 items-center">Search the catalogue</a>
      </main>
    );
  }
  return <BrandPage page={state.page} />;
}

function CoverageNote({ home }: { home: CatalogueHome }) {
  const { coverage } = home;
  return (
    <section id="coverage" className="flex max-w-3xl flex-col gap-3" aria-labelledby="coverage-heading">
      <h2 id="coverage-heading" className="text-2xl font-semibold tracking-tight">
        Catalogue coverage
      </h2>
      {coverage.publishedOn ? (
        <p>Public projection published {coverage.publishedOn}.</p>
      ) : (
        <p>No public projection is published.</p>
      )}
      <p>
        {countNoun(coverage.brands, "brand", "brands")}, {countNoun(coverage.models, "model", "models")}, and{" "}
        {countNoun(coverage.applicabilityRecords, "applicability record", "applicability records")} in this
        catalogue. These counts are not production totals, seller stock, or worldwide completeness.
      </p>
      <p>Unpublished records are omitted. A missing record is not zero production or zero stock.</p>
      {coverage.brands === 0 && coverage.models === 0 && coverage.applicabilityRecords === 0 ? (
        <p>No public records are published.</p>
      ) : null}
    </section>
  );
}

function JurisdictionForm({ home, query }: { home: CatalogueHome; query: string }) {
  const states = home.jurisdictions.filter((place) => place.kind === "state");
  const territories = home.jurisdictions.filter((place) => place.kind === "union-territory");
  return (
    <section className="flex max-w-3xl flex-col gap-3" aria-labelledby="registration-heading">
      <h2 id="registration-heading" className="text-2xl font-semibold tracking-tight">
        Registration jurisdiction
      </h2>
      <p>Choose the Indian state or union territory where you would register a vehicle. This site does not request your location.</p>
      {home.registration ? (
        <p>Registration jurisdiction: {home.registration.name}. Not a tax calculation.</p>
      ) : null}
      <form method="get" action="/" className="flex flex-col gap-3">
        <label htmlFor="registration-jurisdiction" className="text-sm text-muted-foreground">
          Registration place
        </label>
        <select
          id="registration-jurisdiction"
          name="registration"
          defaultValue={home.registration?.id ?? ""}
          className="h-14 w-full max-w-xl border border-border bg-card px-4 text-base text-foreground"
        >
          <option value="">No jurisdiction selected</option>
          <optgroup label="States">
            {states.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Union territories">
            {territories.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </optgroup>
        </select>
        {query ? <input type="hidden" name="q" value={query} /> : null}
        <Button type="submit" className="h-14 w-full max-w-xl px-8 sm:w-auto">
          Save registration place
        </Button>
      </form>
    </section>
  );
}

function BrandIndex({ home }: { home: CatalogueHome }) {
  return (
    <section id="brands" className="flex flex-col gap-4" aria-labelledby="brands-heading">
      <h2 id="brands-heading" className="text-2xl font-semibold tracking-tight">
        Brands
      </h2>
      <p>Published brands in this catalogue.</p>
      {home.brands.length === 0 ? (
        <p>No published brand is in this catalogue.</p>
      ) : (
        <ul id="published-brands" className="flex flex-col border-t border-border">
          {home.brands.map((brand) => (
            <li key={brand.slug} className="border-b border-border py-4">
              <a href={brand.href} className="inline-flex min-h-11 items-center text-xl font-medium">
                {brand.name}
              </a>
              <p>{countNoun(brand.modelCount, "model", "models")} in this catalogue.</p>
            </li>
          ))}
        </ul>
      )}
      {home.fixtureBrands.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-medium">Synthetic fixtures</h3>
          <p>Not included in the public counts.</p>
          <ul id="fixture-brands" className="flex flex-col border-t border-border">
            {home.fixtureBrands.map((brand) => (
              <li key={brand.slug} className="border-b border-border py-4">
                <a href={brand.href} className="inline-flex min-h-11 items-center text-xl font-medium">
                  {brand.name}
                </a>
                <p>Synthetic fixture. Not a manufacturer publication.</p>
                <p>{countNoun(brand.modelCount, "model", "models")} in this catalogue.</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Collections({ home }: { home: CatalogueHome }) {
  return (
    <section id="collections" className="flex flex-col gap-4" aria-labelledby="collections-heading">
      <h2 id="collections-heading" className="text-2xl font-semibold tracking-tight">
        Curated collections
      </h2>
      {home.collections.length === 0 ? (
        <p>No curated collection is published.</p>
      ) : (
        <div className="flex flex-col gap-8">
          {home.collections.map((collection) => (
            <CollectionCard key={collection.slug} collection={collection} />
          ))}
        </div>
      )}
      {home.fixtureCollections.length > 0 ? (
        <div className="flex flex-col gap-4">
          <h3 className="text-lg font-medium">Synthetic fixtures</h3>
          <p>Not included in the public counts.</p>
          {home.fixtureCollections.map((collection) => (
            <CollectionCard key={collection.slug} collection={collection} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CollectionCard({ collection }: { collection: CatalogueCollectionView }) {
  return (
    <article className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 className="text-xl font-medium">{collection.name}</h3>
      {collection.synthetic ? <p>Synthetic fixture. Not a manufacturer publication.</p> : null}
      <p>{collection.summary}</p>
      {collection.members.length === 0 ? (
        <p>No published record remains in this collection.</p>
      ) : (
        <ul className="flex flex-col">
          {collection.members.map((member) => (
            <li key={member.href} className="py-2">
              <a href={member.href} className="inline-flex min-h-11 items-center font-medium">
                {member.brandName} {member.modelName}
              </a>
              <p>
                {member.generationName
                  ? `${member.generationName}. No variant is selected.`
                  : "No generation is selected."}
              </p>
              {member.synthetic ? <p>Synthetic fixture.</p> : null}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function BrandPage({ page }: { page: Extract<CatalogueBrandPage, { availability: "visible" }> }) {
  const shown = page.publicGroups.reduce((sum, group) => sum + group.recordCount, 0);
  return (
    <main id="catalogue" className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-4 pt-12 pb-16">
      {page.privatePreview ? (
        <p>Private preview. Synthetic records are labelled and stay out of the public catalogue.</p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        <a href={page.registration ? `/?registration=${page.registration.id}` : "/"} className="inline-flex min-h-11 items-center">
          Search the catalogue
        </a>
      </p>
      <header className="flex flex-col gap-3">
        <h1 className="text-5xl leading-[0.95] font-semibold tracking-[-0.045em] sm:text-7xl">{page.brandName}</h1>
        {page.synthetic ? <p>Synthetic fixture. Not a manufacturer publication.</p> : null}
        {page.registration ? (
          <p>Registration jurisdiction: {page.registration.name}. Not a tax calculation.</p>
        ) : null}
      </header>
      <nav id="brand-chips" aria-label="Narrow this brand" className="flex flex-wrap gap-2">
        {page.chips.map((chip) => (
          <a
            key={`${chip.label}-${chip.href}`}
            href={chip.href}
            aria-current={chip.current ? "true" : undefined}
            className="inline-flex min-h-11 items-center border border-border px-4 text-sm"
          >
            {chip.label} <span className="ml-2 tabular-nums">{chip.count}</span>
          </a>
        ))}
      </nav>
      <p id="brand-results">
        {countNoun(shown, "record", "records")} in this catalogue. Not a production total, seller stock, or worldwide completeness.
      </p>
      {page.narrowed && page.publicGroups.length === 0 ? (
        <p>No published record matches this narrowing.</p>
      ) : null}
      <ul id="brand-records" className="flex flex-col border-t border-border">
        {page.publicGroups.map((group) => (
          <li key={`${group.status}-${group.generationId ?? group.modelSlug}`} className="flex flex-col gap-2 border-b border-border py-5">
            <h2 className="text-2xl font-semibold tracking-tight">{group.modelName}</h2>
            <p>{group.generationName ?? "No generation is part of this record."}</p>
            <p>
              {group.status === "applicability"
                ? "Applicability records"
                : group.status === "generation"
                  ? "Generation record"
                  : "Model record"}
              . {countNoun(group.recordCount, "record", "records")} in this catalogue.
            </p>
            <a href={group.href} className="inline-flex min-h-11 items-center font-medium">
              Open the overview
            </a>
          </li>
        ))}
      </ul>
      {page.syntheticGroups.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="fixture-groups">
          <h2 id="fixture-groups" className="text-lg font-medium">
            Synthetic fixtures
          </h2>
          <p>Not included in the public counts.</p>
          <ul className="flex flex-col border-t border-border">
            {page.syntheticGroups.map((group) => (
              <li key={`${group.generationId ?? group.modelSlug}`} className="flex flex-col gap-2 border-b border-border py-5">
                <h3 className="text-xl font-medium">{group.modelName}</h3>
                <p>Synthetic fixture. Not a manufacturer publication.</p>
                <p>{group.generationName ?? "No generation is part of this record."}</p>
                <a href={group.href} className="inline-flex min-h-11 items-center font-medium">
                  Open the overview
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function countNoun(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
