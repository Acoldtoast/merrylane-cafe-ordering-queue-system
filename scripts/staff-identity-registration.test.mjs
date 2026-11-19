import assert from "node:assert/strict";
import { createDecipheriv, createHmac } from "node:crypto";
import test from "node:test";
import {
  createStaffIdentityVerificationToken,
  encryptStaffIdentityImages,
  parseStaffIdentityImages,
  verifyStaffIdentityVerificationToken,
} from "../src/lib/staffIdentityRegistration.ts";

test("identity registration validates images and encrypts all four", () => {
  const previous = process.env.STAFF_IDENTITY_ENCRYPTION_KEY;
  try {
    process.env.STAFF_IDENTITY_ENCRYPTION_KEY = "test-only-identity-key-at-least-32-characters";
    const image = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 217]).toString("base64")}`;
    const images = { id_front: image, face_front: image, face_left: image, face_right: image };
    assert.deepEqual(parseStaffIdentityImages(images), images);
    assert.equal(parseStaffIdentityImages({ ...images, face_left: "" }), null);
    assert.equal(parseStaffIdentityImages({ ...images, id_front: "data:image/png;base64,ZmFrZQ==" }), null);
    const encrypted = encryptStaffIdentityImages(images);
    assert.ok(!encrypted.includes(image));
    const [version, iv, tag, ciphertext] = encrypted.split(":");
    assert.equal(version, "v1");
    const key = createHmac("sha256", process.env.STAFF_IDENTITY_ENCRYPTION_KEY).update("merrylane:staff-identity:v1").digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString();
    assert.deepEqual(JSON.parse(plain), images);
  } finally {
    if (previous === undefined) delete process.env.STAFF_IDENTITY_ENCRYPTION_KEY;
    else process.env.STAFF_IDENTITY_ENCRYPTION_KEY = previous;
  }
});

test("staff identity verification tokens bind the checked ID, face, name and ID type", () => {
  const previous = process.env.STAFF_IDENTITY_ENCRYPTION_KEY;
  try {
    process.env.STAFF_IDENTITY_ENCRYPTION_KEY = "test-only-identity-key-at-least-32-characters";
    const images = {
      id_front: "data:image/jpeg;base64,aWQ=",
      face_front: "data:image/jpeg;base64,ZmFjZQ==",
      id_type: "philsys",
    };
    const issuedAt = 1_800_000_000_000;
    const token = createStaffIdentityVerificationToken(images, "Juan Dela Cruz", issuedAt);

    assert.equal(verifyStaffIdentityVerificationToken(token, images, "Juan Dela Cruz", issuedAt), true);
    assert.equal(verifyStaffIdentityVerificationToken(token, images, "Maria Dela Cruz", issuedAt), false);
    assert.equal(verifyStaffIdentityVerificationToken(token, { ...images, id_type: "passport" }, "Juan Dela Cruz", issuedAt), false);
    assert.equal(verifyStaffIdentityVerificationToken(token, { ...images, face_front: "changed" }, "Juan Dela Cruz", issuedAt), false);
    assert.equal(verifyStaffIdentityVerificationToken(token, images, "Juan Dela Cruz", issuedAt + 10 * 60 * 1000 + 1), false);
  } finally {
    if (previous === undefined) delete process.env.STAFF_IDENTITY_ENCRYPTION_KEY;
    else process.env.STAFF_IDENTITY_ENCRYPTION_KEY = previous;
  }
});
