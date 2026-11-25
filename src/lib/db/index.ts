import { PostgresDatabase } from "./postgres";
import path from "node:path";
import { PGliteDatabase } from "./pglite";
import type { Database } from "./types";

declare global {
  var __merrylaneDb: Database | undefined;
}

let _db: Database | null = null;

export function getDbPath(): string {
  const override = process.env.MERRYLANE_DB_DIR;
  if (override && override.trim()) {
    return path.resolve(override);
  }
  return path.join(process.cwd(), "data", "merrylane-pglite");
}

export function isUsingSupabaseDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDb(): Database {
  if (typeof globalThis !== "undefined" && globalThis.__merrylaneDb) {
    return globalThis.__merrylaneDb;
  }
  if (_db) return _db;

  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    _db = PostgresDatabase.open(connectionString);
  } else {
    if (process.env.VERCEL === "1") {
      throw new Error(
        "DATABASE_URL is required on Vercel. Configure the Supabase PostgreSQL connection string in the deployment environment."
      );
    }
    _db = PGliteDatabase.open(getDbPath());
  }

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

export type { Database, DatabaseStatement, RunResult } from "./types";
export type { PGliteDatabase };
