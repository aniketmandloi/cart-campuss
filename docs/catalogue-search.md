# Catalogue search

The first catalogue journey is a name search that opens one scoped, sourced record. Public pages read the current reviewed publishing projection. A catalogue row marked published is not a second copy of those facts and is not visible without that projection. The synthetic fixture is private preview data and stays out of those pages unless the server is explicitly switched.

## Install

From the repository root, with the lockfile unchanged:

```bash
pnpm install --frozen-lockfile
```

After an env schema change, regenerate the checked-in types:

```bash
pnpm env:generate
```

## Database

Put `DATABASE_URL` in `apps/server/.env`. The web process has its own server-only `DATABASE_URL` in `apps/web/.env.local`. Leave it empty and the site renders an unconfigured catalogue instead of fixture HTML. `CATALOGUE_ALLOW_FIXTURES` defaults to false in both schemas and is not a client variable.

Apply the reviewed migrations on Neon, which is the driver Drizzle Kit uses. Do not use `db:push`. The folders, including `20261024130000_dossier_reader` and the later projection folders, are listed in [publishing-setup.md](publishing-setup.md). Dossier routes and the public import fields are in [catalogue-dossier.md](catalogue-dossier.md).

```bash
pnpm db:migrate
```

That command runs Drizzle Kit against `DATABASE_URL` and does not print the connection string. The Neon driver speaks WebSocket, so a local Postgres URL is refused. For a local database, apply the reviewed files in order with `psql` after removing Drizzle's statement markers. Do this before seeding. The price migration adds required source columns, so it expects a price table with no rows yet:

```bash
for file in packages/db/src/migrations/*/migration.sql; do
  sed 's/--> statement-breakpoint//g' "$file" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f -
done
```

Load the labelled synthetic fixture with `psql` (local PostgreSQL or a Postgres connection string):

```bash
DATABASE_URL='postgres://…' PSQL="$(command -v psql)" pnpm db:seed-fixture
```

Do not commit the URL. Re-running the seed does not duplicate the fixture. Public search still excludes it.

To read the fixture, set `CATALOGUE_ALLOW_FIXTURES=true` for the web process and restart it. Set the same value on the API process if clients call Hono. Turn it back to false before a public deployment. Preview and synthetic pages send `noindex`.

## Checks

```bash
pnpm format:check
pnpm static-analysis
CATALOGUE_TEST_DATABASE_URL='postgres://127.0.0.1:5432/catalogue' PSQL="$(command -v psql)" pnpm test
NEXT_PUBLIC_SERVER_URL='http://127.0.0.1:3000' pnpm --filter web build
pnpm --filter server build
```

`pnpm format:check` reads tracked text and fails on a CR byte, a missing final newline, or trailing whitespace. It skips symlinks, empty files, and files that contain a NUL byte. It does not rewrite files, wrap lines, or format money. `pnpm test` still checks Indian digit grouping; that is a catalogue result, not this check.

`pnpm static-analysis` runs the existing workspace TypeScript checks (`tsc --noEmit` through `pnpm check-types`). The scope is every package that defines `check-types`, including the native workspace as types only. It does not run ESLint or another linter, format files, execute the journey, open a browser, or build a simulator.

`NEXT_PUBLIC_SERVER_URL` is the starter's public API origin. It is not a secret. The web build reads it through Varlock and fails closed when it is empty.

`CATALOGUE_TEST_DATABASE_URL` must be `localhost` or `127.0.0.1`. Without it, `pnpm test` still checks money grouping and the empty states, and skips the database journey with that reason. The database journey creates a unique schema, applies the reviewed migrations there, and drops only that schema. A `public` qualifier in migration SQL is rewritten in that test process and is not written back to the migration files. The journey does not drop or rewrite the `public` schema.

The native workspace is part of `pnpm check-types`. This slice does not add a native catalogue screen.

The name-index plan is not part of `pnpm test`. Run it separately. It creates a unique schema, explains the prefix search, checks that `catalogue_alias_name_idx` uses `text_pattern_ops`, and drops only that schema:

```bash
CATALOGUE_TEST_DATABASE_URL='postgres://127.0.0.1:5432/catalogue' PSQL="$(command -v psql)" pnpm db:diagnose-search
```

`DATABASE_URL` is used when `CATALOGUE_TEST_DATABASE_URL` is empty. The database must be on localhost. The diagnostic does not drop `public`.

## Visual direction

The catalogue screens use the Taste app-screen direction True-black flat, seed 764579268. The dealt sheet is [catalogue-search-direction.json](design/catalogue-search-direction.json). The design-study concept used a different draw, seed 887344209, and its photograph and sample figures are not catalogue evidence.

## What you should see

1. With no web `DATABASE_URL`, `/` says the catalogue database is not configured and names no car.
2. With the flag false, searching the fixture name says no published record matches. Opening `/cars/sample-hatch/series-one` says it is not in the public catalogue and does not print the fixture brand, price, or internal note.
3. With the flag true, the same search returns one synthetic result. The overview lists the market, model year, and variant and does not show specifications. The selected URL shows the source, raw value, normalized value, unit, measurement standard, review, policy, an explicit unknown, and the price reference in minor units. The conflicting torque stays beside the curated value and keeps its own raw and normalized values, unit, measurement standard, source URL, review date, and source policy. The price names its source sheet and source identifier separately from the source policy, and says “Not a listing.” The page also says “No market data” and states the model-year convention. There is no photograph and no `<img>`.
4. The price figure is the only sport-accent (`#c6f24e`) text. The Search button is the white inverted action, with black text. The name field is graphite. The ground is black. Type is the self-hosted Inter file, with the SIL license linked from the footer.
5. Keyboard: the skip link appears on focus, then the name field, Search, and result links show a white focus outline. At 200% zoom the page stays one column and the fact table scrolls inside its region. Reduced motion does not change the page, because it does not animate.
