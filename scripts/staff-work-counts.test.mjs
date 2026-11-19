import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PGliteDatabase } from "../src/lib/db/pglite.ts";
import { countStaffWork } from "../src/lib/staffWorkCounts.ts";

test("sidebar counts active work and paid serving orders after one hour", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "merrylane-work-counts-"));
  const db = PGliteDatabase.open(path.join(root, "pgdata"));
  globalThis.__merrylaneDb = db;
  t.after(async () => {
    globalThis.__merrylaneDb = undefined;
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await db.exec(`
    CREATE TABLE orders (status TEXT NOT NULL, payment_status TEXT NOT NULL DEFAULT 'verified', ready_at TEXT);
    CREATE TABLE waiter_requests (status TEXT NOT NULL);
    INSERT INTO orders (status) VALUES ('confirmed'), ('preparing'), ('ready'), ('completed'), ('cancelled');
    INSERT INTO orders (status, payment_status, ready_at)
    VALUES ('ready', 'verified', to_char(timezone('Asia/Manila', CURRENT_TIMESTAMP) - INTERVAL '61 minutes', 'YYYY-MM-DD HH24:MI:SS')),
           ('ready', 'verified', to_char(timezone('Asia/Manila', CURRENT_TIMESTAMP) - INTERVAL '59 minutes', 'YYYY-MM-DD HH24:MI:SS')),
           ('ready', 'pending', to_char(timezone('Asia/Manila', CURRENT_TIMESTAMP) - INTERVAL '61 minutes', 'YYYY-MM-DD HH24:MI:SS'));
    INSERT INTO waiter_requests (status) VALUES ('pending'), ('acknowledged'), ('resolved');
  `);
  assert.deepEqual(await countStaffWork(), { orders: 3, requests: 2 });
  await db.exec("UPDATE orders SET status = 'ready' WHERE status = 'preparing'");
  await db.exec("UPDATE waiter_requests SET status = 'resolved' WHERE status = 'acknowledged'");
  assert.deepEqual(await countStaffWork(), { orders: 2, requests: 1 });
});
