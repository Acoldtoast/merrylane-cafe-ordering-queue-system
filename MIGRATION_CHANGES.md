# PGlite to Supabase migration changes

This note summarizes the project changes made to support moving the cafe app from its local
PGlite database to Supabase PostgreSQL. It does not contain database passwords, API keys, or other
secret values.

## What changed

The app can use either database:

- **Local development:** PGlite remains the default when `DATABASE_URL` is not set.
- **Hosted deployment:** setting the server-side `DATABASE_URL` makes the app use Supabase
  PostgreSQL. On Vercel, the app reports a configuration error if `DATABASE_URL` is missing rather
  than silently starting with an empty local database.

The existing model/query code was kept compatible with both adapters. Local PGlite data was copied
to Supabase, then row counts were checked. The migration reported 29 tables and 1,224 rows copied.
The original local database and a separate migration safety snapshot were retained.

## Files added

| File | Purpose |
| --- | --- |
| `src/lib/db/types.ts` | Shared database interface used by both database adapters. |
| `src/lib/db/postgres.ts` | PostgreSQL pool adapter used when `DATABASE_URL` is configured. |
| `scripts/migrate-pglite-to-supabase.mjs` | Migration utility for copying the PGlite schema, data, constraints, indexes, and sequences to PostgreSQL, with row-count verification. |
| `scripts/database-routing.test.mjs` | Tests for selecting the local or hosted database adapter and hosted configuration behavior. |
| `.env.migrate.example` | Placeholder template showing the migration connection variable; it must not contain a real connection string. |
| `.vercelignore` | Excludes local environment files, database data/backups, dependencies, and build output from a Vercel CLI upload. |
| `MIGRATION_CHANGES.md` | This summary of the migration work. |

## Files edited

| File | Change |
| --- | --- |
| `src/lib/db/index.ts` | Selects PostgreSQL when `DATABASE_URL` is set, otherwise uses PGlite locally; requires PostgreSQL configuration on Vercel. |
| `src/lib/db/pglite.ts` | Implements the shared database interface. |
| `src/lib/models.ts` | Uses the shared interface so existing model queries work with either database. |
| `src/lib/authSecurity.ts` | Uses the shared database interface for its database operations. |
| `src/lib/autoBackup.ts` | Avoids local filesystem backup behavior when using the hosted database. |
| `src/app/api/admin/backup/route.ts` | Handles backup requests appropriately for hosted database mode. |
| `scripts/migrate-pglite-to-supabase.mjs` | Handles PostgreSQL key, index, foreign-key, and nullability ordering during migration. |
| `scripts/fix-next-dev-debug-stream.js` | Applies the development-only Next.js debug-stream patch and checks that it targets the installed Next.js version (`16.4.6`). |
| `next.config.ts` | Configures Next.js to externalize the PostgreSQL driver. |
| `package.json` and `package-lock.json` | Add the PostgreSQL driver and types, plus migration and database test commands. |
| `.env.example` | Documents `DATABASE_URL` without providing a real value. |
| `.gitignore` | Keeps private environment and migration files out of source control while allowing the safe example template. |
| `README.md` | Documents database modes, migration setup, and the development patch. |

## Configuration and secret handling

- The running app reads `DATABASE_URL` from its server environment (locally, this can be in
  `.env.local`; on Vercel, add it as an environment variable).
- The one-time migration script reads `SUPABASE_MIGRATION_URL` from the private local file
  `.env.migrate.local`.
- Never share or commit `.env.local`, `.env.migrate.local`, actual connection strings, passwords,
  API keys, or encryption keys. Share `.env.example` or `.env.migrate.example` only after confirming
  they contain placeholders, not real credentials.
- `.vercelignore` helps omit sensitive/local files from CLI deployments; it is not a replacement
  for checking the files selected for upload.

## Validation recorded

- The migration completed for 29 tables and 1,224 rows, with row-count verification.
- The PostgreSQL adapter was checked against the migrated database and successfully read sample
  table counts.
- The production build and selected database/model/order tests passed after the database changes.

The Vercel project has not been linked or deployed as part of this migration work. A Vercel
deployment still needs its own environment variables configured before it can connect to Supabase.
