# Catalogue search

The first catalogue journey is a name search that opens one scoped, sourced record. Public pages read only reviewed, published rows. The synthetic fixture is private preview data and stays out of those pages unless the server is explicitly switched.

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

Apply the reviewed migration on Neon, which is the driver Drizzle Kit uses:

```bash
pnpm db:migrate
```

That command runs Drizzle Kit against `DATABASE_URL` and does not print the connection string. The Neon driver speaks WebSocket, so a local Postgres URL is refused. For a local database, apply the same reviewed file with `psql` after removing Drizzle's statement markers:

```bash
sed 's/--> statement-breakpoint//g' packages/db/src/migrations/20261023083647_catalogue_search/migration.sql | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f -
```

Load the labelled synthetic fixture with `psql` (local PostgreSQL or a Postgres connection string):

```bash
DATABASE_URL='postgres://…' PSQL="$(command -v psql)" pnpm db:seed-fixture
```

Do not commit the URL. Re-running the seed does not duplicate the fixture. Public search still excludes it.

To read the fixture, set `CATALOGUE_ALLOW_FIXTURES=true` for the web process and restart it. Set the same value on the API process if clients call Hono. Turn it back to false before a public deployment. Preview and synthetic pages send `noindex`.

## Checks

```bash
pnpm check-types
CATALOGUE_TEST_DATABASE_URL='postgres://127.0.0.1:5432/catalogue' PSQL="$(command -v psql)" pnpm test
NEXT_PUBLIC_SERVER_URL='http://127.0.0.1:3000' pnpm --filter web build
pnpm --filter server build
```

`NEXT_PUBLIC_SERVER_URL` is the starter's public API origin. It is not a secret. The web build reads it through Varlock and fails closed when it is empty.

`CATALOGUE_TEST_DATABASE_URL` must be `localhost` or `127.0.0.1`. Without it, `pnpm test` still checks money formatting and the empty states, and skips the database journey with that reason. The database journey creates a unique schema, applies the reviewed migrations there, and drops only that schema. A `public` qualifier in migration SQL is rewritten in that test process and is not written back to the migration files. The journey does not drop or rewrite the `public` schema.

The native workspace is part of `pnpm check-types`. This slice does not add a native catalogue screen.

## What you should see

1. With no web `DATABASE_URL`, `/` says the catalogue database is not configured and names no car.
2. With the flag false, searching the fixture name says no published record matches. Opening `/cars/sample-hatch/series-one` says it is not in the public catalogue and does not print the fixture brand, price, or internal note.
3. With the flag true, the same search returns one synthetic result. The overview lists the market, model year, and variant and does not show specifications. The selected URL shows the source, raw value, normalized value, unit, measurement standard, review, policy, an explicit unknown, the conflicting torque beside the curated value, the price reference in minor units, “Not a listing.”, “No market data”, and the model-year convention. There is no photograph and no `<img>`.
4. The price figure is the only sport-accent (`#c6f24e`) text. The Search button is the white inverted action, with black text. The name field is graphite. The ground is black. Type is the self-hosted Inter file, with the SIL license linked from the footer.
5. Keyboard: the skip link appears on focus, then the name field, Search, and result links show a white focus outline. At 200% zoom the page stays one column and the fact table scrolls inside its region. Reduced motion does not change the page, because it does not animate.
