# Publishing setup

Trusted-operator publishing is a server command and an authorized API mutation. Visitors can search and open the current public projection. They cannot publish, and responses omit contracts, private source payloads, and the operator credential.

Issue #10 is still open. Its unmerged catalogue work reads Brand, Model, Generation, SalesMarket, ModelYear, MarketVariant, and a model-year applicability record, plus aliases, sourced facts, and price references, through `catalogue.search` and `catalogue.read`. That source-policy row is a public name, audience, attribution, and preview flag. It does not store a contract, retention, or a derivative restriction.

This branch does not create those catalogue tables and does not import that branch. The visitor reads checked here are `publishing.search` and `publishing.detail`. They follow the current row of `publishing_projection_pointer`. `canonical_subject_id` is the stable subject key those catalogue reads can later use as an applicability id.

When issue #10 is on `origin/main`, the remaining integration is:

- Map each current published assertion onto that catalogue's applicability, identity, aliases, and sourced facts.
- Keep fixtures, uncertain matches, and held imports out of rows whose publication status is published.
- Serve the public website from `catalogue.search` and `catalogue.read`, still limited to the current projection.
- Keep `publishing_source_policy.contract_text`, staged `private_payload`, and `OPERATOR_TOKEN` out of those responses. The catalogue policy's public attribution does not replace this SourcePolicy.
- Carry both the operator credential and the catalogue preview flag on the API context. Publishing mutations stay on the server command and `publishing.submit`.

## Manual environment

1. From the repository root, install the existing lockfile:

   ```bash
   pnpm install
   ```

2. Create `apps/server/.env`. Do not commit it, and do not put these values in `apps/web` or `apps/native`.

   - `DATABASE_URL`: the Neon Postgres connection string for this app. Use a database you are willing to migrate. Do not point the integration test at it; the test creates its own empty cluster.
   - `OPERATOR_TOKEN`: at least 32 characters. Leave it unset until an operator should be able to publish. Varlock rejects a shorter value.

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

The reviewed SQL is in `packages/db/src/migrations/20261023065345_publishing/migration.sql` and `packages/db/src/migrations/20261023130303_publishing_retention/migration.sql`. The second migration adds source capture timestamps. It backfills legacy rows from the earliest policy creation, original fact retrieval, and staging/publication timestamp, conservatively shortening retention when the original capture is uncertain. Apply it with Drizzle Kit. Do not use `db:push` for this change.

```bash
pnpm --filter @cart-campuss/db db:migrate
```

The Neon HTTP migrator runs each statement separately. If a statement fails, fix the database by hand before retrying; that driver does not roll a migration back. The `todo` statement uses `IF NOT EXISTS` so a database that already received the starter table from `db:push` can still apply the publishing tables.

Publication itself is different: the command submits the projection switch as one Neon HTTP batch, and Postgres commits or rolls back that batch as a whole.

## Operator command

Run this from the repository root. The process reads the server Varlock environment and does not print `OPERATOR_TOKEN` or `DATABASE_URL`.

```bash
pnpm --filter server operator -- apply path/to/import.json
```

Exit 0 means the import was staged, published, or replayed. Exit 2 means it was held: identity, rights, a fixture, or a names-only record blocked publication, and the previous public projection is unchanged. Exit 1 means authorization, validation, or the database rejected the command.

The JSON file has `idempotencyKey`, `providerKey`, `sourcePolicy`, `records`, and `publish`. Fact and image permissions default to `denied`. A record is published only when `publish` is true and every record in the file has a certain identity, a passed factual review, a passed rights review, a reviewed unexpired policy, a permitted fact, a permitted sales-market geography, attribution, the display name among the permitted fields, and at least one sourced fact that is not only a name. `provenance: "fixture"` never enters the public projection. The same idempotency key with the same file replays without a second public record. The same key with a different file is rejected.

A SourcePolicy ID identifies an immutable reviewed revision. Exact content can be reused by other imports, including concurrent imports. Changing its provider, permissions, reviewer, or other terms requires a new policy ID; staged and held imports cannot rewrite a live revision.

Both fact and media source URLs accept only HTTP/HTTPS. Public detail parsing also drops unsafe legacy fact/media URLs. Search and detail share the same eligibility check: when no safe non-identity sourced fact remains, both withhold the entire record. Private links in legacy public metadata also withhold the record. Private-contact screening covers common domestic phone formats, contact-labelled numbers, and decoded URL query keys normalized with the forbidden property keys; an unrelated malformed escape cannot disable query screening. Registration screening includes Indian patterns and the common current UK plate format, without joining separate specification units into a plate. These patterns do not establish worldwide plate/contact coverage, and rights reviewers must still withhold private identifiers.

The HTTP mutation is `publishing.submit`. It accepts the same JSON and requires `Authorization: Bearer` matching `OPERATOR_TOKEN`. A token inside the JSON does not authorize the call. `publishing.search` and `publishing.detail` are anonymous reads of the current projection.

## Retention cleanup

Search and detail check the stored policy on every read, including alias search. Expired permissions, suspended sources, and copies at their retention deadline disappear immediately, without waiting for cleanup. A missing policy cannot appear in those reads. Later projection generations preserve the original capture time. A source document and its media use the oldest fact retrieval time, capped at import receipt; this deliberately uses the shortest lifetime for the whole copy. Restaging the same provider and external ID always preserves the oldest capture for the whole row, so changing facts or the private payload cannot renew unchanged media or other retained components. Public insertion reads that effective staged capture after the upsert inside the protected batch. This deliberately shortens the lifetime of newer components too; no new retention column or migration is needed. Inputs already beyond their retention deadline, including zero-retention copies, are rejected without storing a private payload.

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
