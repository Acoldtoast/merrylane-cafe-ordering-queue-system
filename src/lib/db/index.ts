/**
 * Database adapter using Node's built-in node:sqlite (SQLite3).
 * 
 * NOTE: Node.js v26.7.0 crashes PGlite/WASM with an Abort() error,
 * so we use node:sqlite (built-in, no native deps) instead of PGlite.
 * 
 * The dev server runs with --webpack (not Turbopack) because Turbopack
 * has a junction point bug with PGlite on Windows.
 *
 * Database file: data/merrylane.db (auto-created on first run).
 * Migrations: see scripts/schema.sql
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

declare global {
  var __merrylaneDb: DatabaseSync | undefined;
}

let _db: DatabaseSync | null = null;

function getDbPath(): string {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, "merrylane.db");
}

export function getDb(): DatabaseSync {
  if (typeof globalThis !== "undefined" && globalThis.__merrylaneDb) {
    return globalThis.__merrylaneDb;
  }
  if (_db) return _db;

  const dbPath = getDbPath();
  _db = new DatabaseSync(dbPath);
  _db.exec(
    `PRAGMA journal_mode = WAL;
     PRAGMA foreign_keys = ON;
     PRAGMA busy_timeout = 5000;`
  );

  if (typeof globalThis !== "undefined") {
    globalThis.__merrylaneDb = _db;
  }

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.__merrylaneDb = undefined;
  }
}
