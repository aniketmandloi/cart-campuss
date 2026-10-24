# Catalogue dossier

A public car page reads the current reviewed publishing projection. Editing `catalogue_image`, `catalogue_production_claim`, or a generation's publication flag does not change the page. Withdrawal, expiry, suspension, retention, and geography follow the projection's source policy. A separate image or production policy follows that component's own policy.

There are no new environment variables. Use the server and web variables in [publishing-setup.md](publishing-setup.md). `CATALOGUE_ALLOW_FIXTURES` stays `false` on a public server. Set it to `true` only for a private preview of the labelled synthetic fixture. Do not print `DATABASE_URL` or `OPERATOR_TOKEN`.

## Routes

| Address | What it shows |
| --- | --- |
| `/cars/{modelSlug}` | A scoped Model. No generation, model year, or variant. |
| `/cars/{modelSlug}/{generationSlug}` | A scoped Generation, or the context selector when an applicability exists. |
| `?market=&year=&variant=` | One applicability on the generation route. A contextless link does not pick a trim. |
| `?section=` | `overview`, `specs`, `market`, `cost`, or `sources`. All five stay in the HTML. |
| `?registration=` | Page context only. Section links may keep it. The correction issue omits it, including on a model page, along with finance inputs. |

A renamed slug redirects with the query preserved. An incompatible market, year, or variant does not select another car.

Comparison and finance stay on the waiting copy until an applicability is selected. The correction link opens a GitHub issue with the approved public identity and the page address.

## Migrations

Apply these after the first six folders in [publishing-setup.md](publishing-setup.md). `pnpm db:migrate` records each folder name and skips ones it has already applied. Do not use `db:push`. Run this only against a database you intend to migrate. The integration tests start and remove their own Postgres cluster.

7. `packages/db/src/migrations/20261024130000_dossier_reader/migration.sql` — dossier columns, production and image tables, generation aliases, and route redirects. Those catalogue tables are the synthetic fixture path.
8. `packages/db/src/migrations/20261024143000_projection_components/migration.sql` — `production_claims` on the published assertion.
9. `packages/db/src/migrations/20261024150000_scoped_identity/migration.sql` — `identity_scope` and `rights_geographies` on the published assertion. Existing rows stay `applicability`.
10. `packages/db/src/migrations/20261024160000_model_shell/migration.sql` — `catalogue_model_alias`.

## Public import

A record has one of `catalogue`, `generationCatalogue`, or `modelCatalogue`.

`catalogue` is the complete applicability. `canonicalSubjectId` is the applicability id. Country and model-year label match the catalogue block. `permittedFields` includes `brand`, `model`, `generation`, `marketVariant`, `salesMarket`, and `modelYearLabel`.

`generationCatalogue` is `{ brand, model, generation, aliases }`. `canonicalSubjectId` is the generation id. `modelYearLabel` is null. `document.salesMarket` is the rights country and is not inserted as a SalesMarket. `permittedFields` includes `brand`, `model`, and `generation`. The publisher does not mark the generation row published.

`modelCatalogue` is `{ brand, model, aliases }`. `canonicalSubjectId` is the model id. `modelYearLabel` is null. `permittedFields` includes `brand` and `model`. No generation, year, or trim is created.

A lookup name other than the canonical brand, model, or generation name matches only while `alias` is permitted and that name is still on the current assertion. An older index row for a removed alias does not keep the model or generation searchable.

`componentPolicies` is an array of source policies, each with its own `id`. Media and `productionClaims` may set `sourcePolicyId`. Omitting it uses the record policy. A separate policy needs `retrievedAt`. When that policy expires, is suspended, loses retention, or leaves the country, the public page hides that image or production count and keeps the identity facts.

A production count is public only when the governing policy, main or separate, lists `productionClaims` in `permittedFields`. That one field covers the whole claim: scope, geography, period, count, status, what was counted, and the source metadata. Fact permission alone does not publish it. Without `productionClaims`, the count is left out of the assertion and the page, and the other permitted facts stay.

An image uses its own `retrievedAt` and `countryCode` whether it cites the record policy or a separate policy. A missing value inherits the record's effective capture time and country, which is also how older rows without those fields are read. The page shows the image only when that capture is still inside the governing policy's retention and that country is permitted. A later import cannot move an existing capture later. An image that is already past retention rejects the import before a private payload is stored. An image outside the permitted country is omitted; permitted facts can still publish.

The cleanup command in [publishing-setup.md](publishing-setup.md) is manual. When an image or production policy expires, is suspended, passes retention, or is missing, that command removes the copy from every stored generation and deletes the staged or held import that still contains it. Facts and identity that remain permitted stay. There is no scheduler on this branch.

`productionClaims` items are `{ scope, geography, period, count, status, counted, sourceTitle, sourceUrl, observedAt, retrievedAt, reviewedOn, countryCode, sourcePolicyId? }`. `status` is `planned` or `completed`. `counted` must not be sales, registrations, or exports.

Fact fields:

- `state`: `known`, `unknown`, `not-applicable`, or `withheld`.
- `freshness`: `current`, `stale`, or `not-checked`. Default `current`.
- `unknown`, `not-applicable`, and `withheld` require `unknownReason`. The public fact does not keep `rawValue`, `normalizedValue`, `unit`, or `standard`.
- `conflict` may sit beside a `known` or `unknown` fact and then requires `curatedReason`. The conflict keeps its own value, unit, standard, source URL and title, observed and retrieved times, and reviewer refs. `not-applicable` and `withheld` cannot carry a conflict.
- A known value keeps the submitted unit. The page does not convert PS, bhp, or kW.

Save labelled imports locally. Do not commit a live catalogue file.

## Screen checks

Start the web server on port 3001 and the API on port 3000 yourself. Then open:

- `http://localhost:3001/`
- `http://localhost:3001/cars/{modelSlug}`
- `http://localhost:3001/cars/{modelSlug}/{generationSlug}`
- the same generation address with `?section=specs` and with a market, year, and variant
- a renamed slug, which should redirect and keep the query

Confirm True-black flat surfaces and the self-hosted Inter files. On phone and desktop, and at 200% zoom, confirm the five section links, the context selector, the neutral photograph when image rights are absent, and the distinct lines for unknown, not applicable, withheld by rights, stale, not checked, and a conflicting reading. A model address should not show a generation, model year, or variant, and comparison and finance should wait.
