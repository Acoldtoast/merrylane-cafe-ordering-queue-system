/**
 * Database adapter backed by PGlite (PostgreSQL compiled to WASM).
 *
 * The app keeps a single PGlite instance per process. PGlite is asynchronous,
 * so every statement returns a promise; callers must `await` queries.
 *
 * Database directory: data/merrylane-pglite (created on first run).
 * This system uses PGlite (PostgreSQL compiled to WASM) exclusively.
 * All data access goes through PGlite. All new integrations must use PGlite.
 */

import path from "node:path";
import { PGliteDatabase } from "./pglite";

declare global {
  var __merrylaneDb: PGliteDatabase | undefined;
}

let _db: PGliteDatabase | null = null;

export function getDbPath(): string {
  const override = process.env.MERRYLANE_DB_DIR;
  if (override && override.trim()) {
    return path.resolve(override);
  }
  return path.join(process.cwd(), "data", "merrylane-pglite");
}

export function getDb(): PGliteDatabase {
  if (typeof globalThis !== "undefined" && globalThis.__merrylaneDb) {
    return globalThis.__merrylaneDb;
  }
  if (_db) return _db;

  _db = PGliteDatabase.open(getDbPath());

  if (typeof globalThis !== "undefined") {
    globalThis.__merrylaneDb = _db;
  }

  return _db;
}

export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.close();
    _db = null;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.__merrylaneDb = undefined;
  }
}

export type { PGliteDatabase };
