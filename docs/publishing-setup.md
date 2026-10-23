# Publishing setup

Trusted-operator publishing is a server command and an authorized API mutation. Visitors read the current public projection through `catalogue.search` and `catalogue.read`. They cannot publish. Responses omit contracts, private source payloads, and the operator credential.

`canonical_subject_id` is the catalogue applicability id. An import creates that applicability only when it includes an explicit Brand, Model, Generation, MarketVariant, SalesMarket, and ModelYear. Every later publication checks the stored country and model-year label, including when the catalogue block is omitted. Explicit Brand, Model, Generation, MarketVariant, SalesMarket, and ModelYear IDs must still match when supplied. The protected batch rechecks the canonical context before replacing facts. The import does not invent those identities from the display name, and it does not invent a unit, a year, or a known value for an unknown fact. Public facts and the price reference stay on the current publishing assertion. The catalogue fact and price tables remain the synthetic fixture path. A catalogue row marked published is not public unless the current projection still permits that applicability.

`publishing.search` and `publishing.detail` remain operator-projection reads for the publishing checks. The website does not use them.

## Manual environment

1. From the repository root, install the existing lockfile:

   ```bash
   pnpm install
   ```

2. Create `apps/server/.env`. Do not commit it, and do not print these values.

   - `DATABASE_URL`: the Postgres connection string for this app. Use a database you are willing to migrate. Do not point the integration test at it; the test creates its own empty cluster.
   - `OPERATOR_TOKEN`: at least 32 characters. Leave it unset until an operator should be able to publish. Varlock rejects a shorter value. Do not add this key to the web or native schemas.
   - `CATALOGUE_ALLOW_FIXTURES`: `false` for a public server.

   Create `apps/web/.env.local` for the site. It has its own server-only `DATABASE_URL`. Leave that empty and the site says the catalogue database is not configured. Set `CATALOGUE_ALLOW_FIXTURES=false` and `NEXT_PUBLIC_SERVER_URL` to the public API origin, for example `http://127.0.0.1:3000`. That origin is not a secret.

3. Regenerate the typed accessors after the schema change:

   ```bash
   pnpm env:generate
   ```

4. Confirm the database package can see `DATABASE_URL` without printing it. Run this from `packages/db` and expect the word `set`:

   ```bash
   node --input-type=module -e 'import "varlock/auto-load"; console.log(process.env.DATABASE_URL ? "set" : "missing")'
   ```

   From `apps/server`, the same check should print `set` for both `DATABASE_URL` and `OPERATOR_TOKEN` before you run the command.

## Migration

Apply the reviewed SQL in folder order. Do not use `db:push`. These folders are the chain:

1. `packages/db/src/migrations/20261023065345_publishing/migration.sql`
2. `packages/db/src/migrations/20261023083647_catalogue_search/migration.sql`
3. `packages/db/src/migrations/20261023130303_publishing_retention/migration.sql`
4. `packages/db/src/migrations/20261023132821_price_reference_source/migration.sql`
5. `packages/db/src/migrations/20261023142856_projection_price_reference/migration.sql`
6. `packages/db/src/migrations/20261023160000_price_capture_retention/migration.sql`

The retention migration adds source capture timestamps and backfills legacy rows from the earliest policy creation, original fact retrieval, and staging/publication timestamp. The catalogue price migration adds required source columns and expects a price table with no rows when that migration has not been applied yet. The projection price migration adds a nullable `price_reference` column on `publishing_published_assertion`. It does not rewrite catalogue rows. The price capture migration bounds existing assertion capture by price retrieval (UTC midnight for date-only retrieval), backfills matching staged copies to the earliest historical capture and permission deadline, and adds a safe parser used by database read, carry-forward, and cleanup guards. Invalid legacy price retrieval is treated as expired. A database that already applied the catalogue folders still receives the publishing folders, because Drizzle skips only migration names it has recorded. None of these statements drop catalogue data. The historical `todo` statement uses `IF NOT EXISTS`; do not delete that table to make a later diff empty.

```bash
pnpm db:migrate
```

The Neon HTTP migrator runs each statement separately. If a statement fails, fix the database by hand before retrying; that driver does not roll a migration back. For a local Postgres URL, apply the same files in order after removing Drizzle's statement markers:

```bash
for file in packages/db/src/migrations/*/migration.sql; do
  sed 's/--> statement-breakpoint//g' "$file" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f -
done
```

Publication itself is different: the command submits the projection switch as one Neon HTTP batch, and Postgres commits or rolls back that batch as a whole.

## Operator command

Run this from the repository root. The process reads the server Varlock environment and does not print `OPERATOR_TOKEN` or `DATABASE_URL`.

```bash
pnpm --filter server operator -- apply path/to/import.json
```

Exit 0 means the import was staged, published, or replayed. Exit 2 means it was held: identity, rights, a fixture, or a names-only record blocked publication, and the previous public projection is unchanged. Exit 1 means authorization, validation, or the database rejected the command.

The JSON file has `idempotencyKey`, `providerKey`, `sourcePolicy`, `records`, and `publish`. Fact and image permissions default to `denied`. A record is published only when `publish` is true and every record in the file has a certain identity, a passed factual review, a passed rights review, a reviewed unexpired policy, a permitted fact, a permitted sales-market geography, attribution, the display name among the permitted fields, and at least one sourced fact that is not only a name. `provenance: "fixture"` never enters the public projection. The same idempotency key with the same file replays without a second public record. The same key with a different file is rejected.

A SourcePolicy ID identifies an immutable reviewed revision. Exact content can be reused by other imports, including concurrent imports. Changing its provider, permissions, reviewer, or other terms requires a new policy ID; staged and held imports cannot rewrite a live revision. A new cleared revision atomically advances the applicability policy pointer without changing its identity, provider ownership, or old policy/history. An existing applicability can omit the catalogue block when its reviewed document still matches the stored context; a new policy revision needs its own explicit display name. Retained components keep the earlier absolute retention/permission deadline even when a new revision grants more time. The stored effective capture bound is shortened when necessary to preserve that deadline. After cleanup, a genuinely new capture can renew the same identity under a newly reviewed policy; changing a review or one component does not recapture the rest.

Both fact and media source URLs accept only HTTP/HTTPS. Public detail parsing also drops unsafe legacy fact/media URLs. Search and detail share the same eligibility check: when no safe non-identity sourced fact remains, both withhold the entire record. Private links in legacy public metadata also withhold the record. Private-contact screening covers common domestic phone formats, contact-labelled numbers, and decoded URL query keys normalized with the forbidden property keys; an unrelated malformed escape cannot disable query screening. Registration screening includes Indian patterns and the common current UK plate format, without joining separate specification units into a plate. These patterns do not establish worldwide plate/contact coverage, and rights reviewers must still withhold private identifiers.

A catalogue record also needs `sourcePolicy.displayName`, explicit `brand`, `model`, `generation`, `marketVariant`, `salesMarket`, and `modelYearLabel` in `permittedFields`, and a `catalogue` object whose country and model-year label match the record. Every permitted fact that will be published needs `sourceTitle`. The optional price requires explicit `priceReference` permission for the entire dated amount, basis, and source metadata. Without it the public assertion omits the price while other cleared facts remain publishable. Each identity permission covers that structured component's names, IDs, slugs, and context metadata (including model-year convention). Additional lookup names require `alias`; search checks them against the current assertion rather than historical index rows. A replacement without the catalogue block may withhold optional aliases/year in the publishing projection. The visitor catalogue withholds the whole applicability until all required identity context is currently permitted, rather than attaching facts to an incomplete identity. Save this labelled test shape locally and do not commit it. It is not a live catalogue record.

```json
{
  "idempotencyKey": "labeled-test-dossier",
  "providerKey": "manual-test",
  "publish": true,
  "sourcePolicy": {
    "id": "00000000-0000-4000-8000-000000000011",
    "providerKey": "manual-test",
    "displayName": "Labeled test policy",
    "factPermission": "permitted",
    "imagePermission": "denied",
    "permittedFields": ["displayName", "alias", "modelYearLabel", "power", "torque", "salesMarket", "priceReference", "brand", "model", "generation", "marketVariant"],
    "permittedGeographies": ["IN"],
    "attribution": "Reviewed sample attribution",
    "retentionSeconds": 86400,
    "derivativeRestriction": "No derivative use.",
    "aggregationRestriction": "No aggregation.",
    "refreshIntervalSeconds": 7776000,
    "permissionExpiresAt": "2030-01-01T00:00:00.000Z",
    "takedownObligation": "Withdraw on request.",
    "deletionObligation": "Delete when retention ends.",
    "contractText": "Rights contract stays on the source policy and is not shown.",
    "suspended": false,
    "reviewerRef": "policy-reviewer",
    "reviewedAt": "2026-10-22T00:00:00.000Z"
  },
  "records": [
    {
      "externalId": "ext-labeled-dossier",
      "provenance": "manual",
      "document": {
        "displayName": "Unindexed labeled dossier",
        "aliases": [],
        "canonicalSubjectId": "subject-labeled-dossier",
        "salesMarket": "IN",
        "modelYearLabel": "2026",
        "facts": [
          {
            "property": "power",
            "rawValue": "100 PS",
            "normalizedValue": "100",
            "state": "known",
            "unknownReason": null,
            "unit": "PS",
            "standard": "PS",
            "sourceUrl": "https://example.test/sources/labeled-dossier",
            "sourceTitle": "Labeled test dossier",
            "providerKey": "manual-test",
            "observedAt": "2026-10-22T00:00:00.000Z",
            "retrievedAt": "2026-10-22T00:00:00.000Z"
          },
          {
            "property": "torque",
            "rawValue": "not-a-measurement",
            "normalizedValue": null,
            "state": "unknown",
            "unknownReason": "The labelled test does not include a measured torque.",
            "unit": "invented-unit",
            "standard": null,
            "sourceUrl": "https://example.test/sources/labeled-dossier",
            "sourceTitle": "Labeled test dossier",
            "providerKey": "manual-test",
            "observedAt": null,
            "retrievedAt": "2026-10-22T00:00:00.000Z"
          }
        ],
        "media": []
      },
      "catalogue": {
        "brand": { "id": "brand-labeled-dossier", "name": "Labeled Dossier", "slug": "brand-labeled-dossier" },
        "model": { "id": "model-labeled-dossier", "name": "Labeled Dossier Model", "slug": "model-labeled-dossier" },
        "generation": { "id": "gen-labeled-dossier", "name": "Labeled Mark", "slug": "mark" },
        "marketVariant": { "id": "var-labeled-dossier", "name": "Base" },
        "salesMarket": { "id": "mkt-labeled-in", "name": "India", "countryCode": "IN" },
        "modelYear": {
          "id": "year-labeled-2026",
          "label": "2026",
          "convention": "Manufacturer model-year label. Not the calendar build year."
        },
        "aliases": [],
        "priceReference": {
          "amountMinor": 250000,
          "currency": "INR",
          "minorUnitExponent": 2,
          "basis": "official price reference",
          "taxInclusivity": "unspecified",
          "observedOn": "2026-10-22",
          "retrievedOn": "2026-10-22",
          "reviewedOn": "2026-10-22",
          "sourceTitle": "Labeled test price sheet",
          "sourceUrl": "https://example.test/prices/labeled-dossier",
          "sourceIdentifier": null
        }
      },
      "identity": {
        "outcome": "certain",
        "canonicalSubjectId": "subject-labeled-dossier",
        "reviewerRef": "identity-reviewer",
        "note": "Operator confirmed this labelled test subject."
      },
      "factualReview": {
        "outcome": "passed",
        "reviewerRef": "fact-reviewer",
        "reviewedAt": "2026-10-22T00:00:00.000Z"
      },
      "rightsReview": {
        "outcome": "passed",
        "reviewerRef": "rights-reviewer",
        "reviewedAt": "2026-10-22T00:00:00.000Z"
      }
    }
  ]
}
```

Use a new policy id for a real import. Reusing this id with different terms is rejected.

The HTTP mutation is `publishing.submit`. It accepts the same JSON and requires `Authorization: Bearer` matching `OPERATOR_TOKEN`. A token inside the JSON does not authorize the call. `publishing.search` and `publishing.detail` still read the current projection, including records that have no catalogue block. The website reads `catalogue.search` and `catalogue.read` instead.

## Screen checks

Start the API and the web app yourself after the migrate and the operator command. With `CATALOGUE_ALLOW_FIXTURES=false`:

1. `/` with no web `DATABASE_URL` says the catalogue database is not configured and names no car.
2. Search `labeled dossier`. The result is Labeled Dossier, Labeled Dossier Model, Labeled Mark, India, model year 2026, Base, and says Exact name. Searching `unindexed labeled dossier` says no published record matches.
3. Open that result. The heading is Labeled Dossier Model, not the display name Unindexed labeled dossier. The page shows Labeled test policy, Audience: public, Policy reviewer: policy-reviewer, Factual reviewer: fact-reviewer, Rights reviewer: rights-reviewer, the source title Labeled test dossier, 100 PS, the unknown-torque sentence, ₹2,500.00, 250000 INR minor units, Labeled test price sheet, Not a listing, No market data, Not the calendar build year, and No catalogue photograph. It does not show the torque raw value, the unit invented-unit, the contract sentence, or an `<img>`.
4. Search `kestrel` says no published record matches. `/cars/sample-hatch/series-one` says it is not in the public catalogue.
5. A record whose policy is suspended, whose retention has passed, or whose assertions cleanup has deleted disappears from that same search and its detail URL says it is not in the public catalogue. Refresh the page; the responses send `Cache-Control: private, no-store`.

The fixture checks with the flag on are in [catalogue-search.md](catalogue-search.md).

## Retention cleanup

Search and detail check the stored policy on every read, including alias search. Expired permissions, suspended sources, and copies at their retention deadline disappear immediately, without waiting for cleanup. A missing policy cannot appear in those reads. Later projection generations preserve the original capture time. A source document and its media use the oldest fact or price retrieval time, capped at import receipt; this deliberately uses the shortest lifetime for the whole copy. Restaging the same provider and external ID always preserves the oldest capture for the whole row, so changing facts or the private payload cannot renew unchanged media or other retained components. Public insertion reads that effective staged capture after the upsert inside the protected batch. This deliberately shortens the lifetime of newer components too; the price capture migration also protects legacy assertions and their matching staged copies. Price retrieval must be an ISO date or UTC timestamp. Inputs already beyond their retention deadline, including zero-retention copies, are rejected without storing a private payload.

Use the same server-only Varlock environment and operator credential for the bounded cleanup command:

```bash
pnpm --filter server operator -- cleanup
```

It atomically deletes due staged documents/private payloads and published assertions/media from **every** generation, including the current one. It deletes on permission expiry, suspension, or the source capture plus `retentionSeconds` deadline. It reports only deletion counts; database details and bound private parameters are excluded from errors. Unexpired permitted history remains; import hashes/results, generation metadata, and reviewed policy terms remain for audit and replay. Replaying a cleaned import returns its historical result and does not restore source copies. Import and cleanup writes take the same transaction-scoped advisory lock in their Neon HTTP batch. An import that observed a staged copy subsequently changed or deleted by another operation rolls back and must be retried. Copies carried into another projection are read from their surviving database rows inside that batch. The batch checks new-copy deadlines before commit with PostgreSQL `clock_timestamp()`, including time spent waiting for the lock; an expired publication rolls back the entire projection switch. Held or staged imports cannot retain copies whose policies are already expired or suspended. This command does not invent a sale or a provider outage.

Run cleanup after each import, immediately after an operator suspension, and at least once a minute while copies are stored. For terms requiring deletion exactly at a deadline, arrange the command to run by that deadline; if that cadence cannot satisfy the source's terms, keep that source out of storage. This branch adds no scheduler. Issue #13 owns scheduled rechecks, fuller withdrawal/audit workflows, and cache invalidation. Operators must also apply the source's deletion obligations to import files, exports, caches, and backup retention; this command only purges these database tables. Free-text restrictions/obligations still require the rights reviewer to confirm that this conservative behavior satisfies the actual terms.

After migrations and before serving traffic, run cleanup once. A failed cleanup exits 1; retry it and keep affected sources suspended until successful. The anonymous reads remain fail-closed while cleanup is delayed. No populated database migration, cleanup, hosted Neon execution, or scheduler installation was performed by this change.

## Integration test

The test does not read `DATABASE_URL`. It runs `initdb` in a temporary directory with Postgres.app, serves that cluster through the Neon HTTP `queries` protocol, and deletes the directory when the run ends. It needs `/Applications/Postgres.app/Contents/Versions/latest/bin`.

The rollback check uses `commitNeonHttpBatch`, the same helper as publication. That calls Drizzle `batch()` on the Neon HTTP client, which posts one `queries` array. The temporary bridge runs that array in a single Postgres transaction. A duplicate primary key in the batch must leave the previous projection pointer and its rows unchanged. `db.transaction()` throws on this driver; the test expects that error rather than treating an interactive transaction as available.

```bash
pnpm --filter server test
```

Do not start the dev server for this check. Do not point this test at a populated Neon database.
