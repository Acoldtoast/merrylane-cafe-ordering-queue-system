import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureStaffIdentityTable,
  staffIdentityFingerprint,
  staffIdentityVerificationTokenFingerprint,
} from "../src/lib/staffIdentityRegistration.ts";
import { staffIdCheckLabel, staffIdDuplicateTone } from "../src/lib/staffIdCheckLabels.ts";
import { PGliteDatabase } from "../src/lib/db/pglite.ts";

test("ID number fingerprints ignore formatting and stay scoped to the ID type", () => {
  const previous = process.env.STAFF_IDENTITY_ENCRYPTION_KEY;
  try {
    process.env.STAFF_IDENTITY_ENCRYPTION_KEY = "test-only-identity-key-at-least-32-characters";
    const plain = staffIdentityFingerprint("philsys", "1234-5678-9012-3456");
    assert.equal(plain, staffIdentityFingerprint("philsys", "1234567890123456"));
    assert.equal(plain, staffIdentityFingerprint("philsys", " 1234 5678 9012 3456 "));
    assert.notEqual(plain, staffIdentityFingerprint("passport", "1234-5678-9012-3456"));
    assert.equal(staffIdentityFingerprint("philsys", "---"), null);
    assert.equal(staffIdentityFingerprint("philsys", ""), null);
    assert.match(plain ?? "", /^[0-9a-f]{64}$/);
    assert.ok(!(plain ?? "").includes("1234"));
  } finally {
    if (previous === undefined) delete process.env.STAFF_IDENTITY_ENCRYPTION_KEY;
    else process.env.STAFF_IDENTITY_ENCRYPTION_KEY = previous;
  }
});

test("check labels match the other system's pass, check, problem and not-checked wording", () => {
  assert.equal(staffIdCheckLabel("pass"), "Passed");
  assert.equal(staffIdCheckLabel("check"), "Check");
  assert.equal(staffIdCheckLabel("problem"), "Problem");
  assert.equal(staffIdCheckLabel("unknown"), "Not checked");
  assert.equal(staffIdDuplicateTone("unique"), "pass");
  assert.equal(staffIdDuplicateTone("duplicate"), "problem");
  assert.equal(staffIdDuplicateTone("checking"), "check");
  assert.equal(staffIdDuplicateTone("idle"), "unknown");
  assert.equal(staffIdDuplicateTone("unavailable"), "unknown");
});

test("the stored fingerprint index rejects a reused ID number", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "merrylane-id-fingerprint-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const database = PGliteDatabase.open(path.join(root, "pgdata"));
  try {
    await database.exec(`
      CREATE TABLE staff_identity_registrations (
        user_id INTEGER PRIMARY KEY,
        encrypted_images TEXT NOT NULL,
        encrypted_details TEXT,
        details_fingerprint TEXT
      );
      CREATE UNIQUE INDEX staff_identity_registrations_fingerprint_idx
        ON staff_identity_registrations (details_fingerprint)
        WHERE details_fingerprint IS NOT NULL;
    `);
    await database
      .prepare("INSERT INTO staff_identity_registrations (user_id, encrypted_images, details_fingerprint) VALUES (?, ?, ?)")
      .run(1, "images", "fingerprint-a");
    await assert.rejects(
      database
        .prepare("INSERT INTO staff_identity_registrations (user_id, encrypted_images, details_fingerprint) VALUES (?, ?, ?)")
        .run(2, "images", "fingerprint-a")
    );
    await database
      .prepare("INSERT INTO staff_identity_registrations (user_id, encrypted_images, details_fingerprint) VALUES (?, ?, ?)")
      .run(3, "images", "fingerprint-b");
    await database
      .prepare("INSERT INTO staff_identity_registrations (user_id, encrypted_images) VALUES (?, ?)")
      .run(4, "images");

    const other = await database
      .prepare("SELECT user_id FROM staff_identity_registrations WHERE details_fingerprint = ? AND user_id <> ? LIMIT 1")
      .get("fingerprint-a", 1);
    assert.equal(other, undefined);
    const duplicate = await database
      .prepare("SELECT user_id FROM staff_identity_registrations WHERE details_fingerprint = ? AND user_id <> ? LIMIT 1")
      .get("fingerprint-a", 99);
    assert.equal(duplicate.user_id, 1);
  } finally {
    await database.close();
  }
});

test("staff identity verification tokens can be consumed only once", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "merrylane-identity-token-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const database = PGliteDatabase.open(path.join(root, "pgdata"));
  const previousDatabase = globalThis.__merrylaneDb;
  globalThis.__merrylaneDb = database;
  try {
    await database.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
    await ensureStaffIdentityTable();
    const fingerprint = staffIdentityVerificationTokenFingerprint("one-time-token");
    const insertToken = () => database
      .prepare("INSERT INTO staff_identity_verification_tokens (token_fingerprint, expires_at) VALUES (?, CURRENT_TIMESTAMP + INTERVAL '10 minutes') ON CONFLICT (token_fingerprint) DO NOTHING")
      .run(fingerprint);

    assert.equal((await insertToken()).changes, 1);
    assert.equal((await insertToken()).changes, 0);
  } finally {
    globalThis.__merrylaneDb = previousDatabase;
    await database.close();
  }
});
