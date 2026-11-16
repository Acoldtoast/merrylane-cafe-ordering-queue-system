<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Performance by default

- Treat load speed as an acceptance requirement for every new or changed feature, on desktop and phones.
- Reuse the portal's route-code and API-data prefetch helpers so likely destinations are ready before navigation; consume prefetched responses instead of repeating requests.
- Avoid blocking initial UI on nonessential work, redundant requests, or loading every feature's data at once. Keep direct/deep-link entry reliable.
- Verify loading and navigation behavior, and run the smallest relevant performance/build checks with the feature's tests.

## Database (PGlite only)

This system uses **PGlite** (PostgreSQL compiled to WASM) as its sole database. All persistence goes through `src/lib/db/index.ts` (`getDb()`), which opens a PGlite instance from `data/merrylane-pglite`.

- **Do NOT use SQLite syntax** (`datetime('now')`, `INSERT OR IGNORE`, `PRAGMA`, etc.) in new code. Use native PostgreSQL syntax (`CURRENT_TIMESTAMP`, `NOW()`, `INSERT ... ON CONFLICT`, `information_schema.columns`, etc.).
- The PGlite adapter (`src/lib/db/pglite.ts`) has a `convertSql()` function that translates some SQLite syntax for backward compatibility, but new code should not rely on this.
- **Do NOT use SQLite** as a fallback or for any new integration. All new data access must go through PGlite.
- There is no SQLite database in this project any more; `data/merrylane.db` does not exist and nothing reads it.
- New integrations, new tables, and new features must use PGlite (PostgreSQL) syntax exclusively.
