import assert from "node:assert/strict";
import test from "node:test";
import { closeDb, getDb } from "../src/lib/db/index.ts";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalVercel = process.env.VERCEL;

test.after(async () => {
  await closeDb();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

test("Vercel refuses to fall back to an ephemeral local database", () => {
  delete process.env.DATABASE_URL;
  process.env.VERCEL = "1";
  assert.throws(() => getDb(), /DATABASE_URL is required on Vercel/);
});

test("DATABASE_URL selects the hosted PostgreSQL adapter", async () => {
  process.env.VERCEL = "1";
  process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/test";

  const database = getDb();
  assert.equal(database.constructor.name, "PostgresDatabase");
  await closeDb();
});
