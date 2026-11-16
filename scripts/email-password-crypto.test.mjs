import assert from "node:assert/strict";
import {
  createCipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import test from "node:test";
import {
  decryptSmtpPassword,
  encryptSmtpPassword,
  normalizeSmtpPassword,
} from "../src/lib/emailPasswordCrypto.ts";

function withEnvironment(updates, callback) {
  const original = new Map(
    Object.keys(updates).map((key) => [key, process.env[key]])
  );
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    callback();
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function encryptLegacyPassword(password, secret) {
  const key = createHmac("sha256", secret)
    .update("merrylane:smtp-password:v1")
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(password, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

test("encrypts and decrypts SMTP passwords without JWT_SECRET", () => {
  withEnvironment(
    {
      SMTP_PASSWORD_ENCRYPTION_KEY: "local-key-".repeat(6),
      JWT_SECRET: undefined,
    },
    () => {
      const encrypted = encryptSmtpPassword("google-app-password");
      assert.match(encrypted, /^v2:/);
      assert.equal(decryptSmtpPassword(encrypted), "google-app-password");
    }
  );
});

test("decrypts passwords saved with the previous JWT_SECRET key", () => {
  const legacySecret = "previous-jwt-secret-".repeat(2);
  withEnvironment(
    {
      JWT_SECRET: legacySecret,
      SMTP_PASSWORD_ENCRYPTION_KEY: "new-local-key-".repeat(4),
    },
    () => {
      const encrypted = encryptLegacyPassword("legacy-app-password", legacySecret);
      assert.equal(decryptSmtpPassword(encrypted), "legacy-app-password");
    }
  );
});

test("requires a configured local key to save SMTP passwords", () => {
  withEnvironment(
    {
      SMTP_PASSWORD_ENCRYPTION_KEY: undefined,
      JWT_SECRET: undefined,
    },
    () => {
      assert.throws(
        () => encryptSmtpPassword("google-app-password"),
        /SMTP_PASSWORD_ENCRYPTION_KEY/
      );
    }
  );
});

test("removes Gmail app-password grouping spaces but preserves other provider passwords", () => {
  assert.equal(
    normalizeSmtpPassword("abcd efgh ijkl mnop", " SMTP.GMAIL.COM "),
    "abcdefghijklmnop"
  );
  assert.equal(
    normalizeSmtpPassword("password with spaces", "smtp.office365.com"),
    "password with spaces"
  );
});
