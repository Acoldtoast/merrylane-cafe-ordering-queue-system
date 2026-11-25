import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";

export type StaffIdentityImages = {
  id_front: string;
  id_back?: string;
  id_type?: string;
  face_front: string;
  face_left: string;
  face_right: string;
};

type StaffIdentityVerificationImages = Pick<StaffIdentityImages, "id_front" | "face_front"> & {
  id_type?: string;
};

const fields = ["id_front", "face_front", "face_left", "face_right"] as const;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const VERIFICATION_TOKEN_TTL_MS = 10 * 60 * 1000;

function verificationTokenKey(): Buffer {
  const secret = process.env.STAFF_IDENTITY_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("Staff identity storage is not configured.");
  return createHmac("sha256", secret).update("merrylane:staff-identity-verification:v1").digest();
}

function verificationPayload(
  images: StaffIdentityVerificationImages,
  accountName: string,
  issuedAt: number
): string {
  const imageDigest = createHash("sha256")
    .update(images.id_front)
    .update("\0")
    .update(images.face_front)
    .digest("hex");
  return JSON.stringify({
    issuedAt,
    accountName: accountName.trim(),
    idType: images.id_type ?? "",
    imageDigest,
  });
}

export function createStaffIdentityVerificationToken(
  images: StaffIdentityVerificationImages,
  accountName: string,
  issuedAt = Date.now()
): string {
  if (!Number.isSafeInteger(issuedAt) || !accountName.trim()) {
    throw new Error("A valid name and timestamp are required for identity verification.");
  }
  const signature = createHmac("sha256", verificationTokenKey())
    .update(verificationPayload(images, accountName, issuedAt))
    .digest("base64url");
  return `${issuedAt}.${signature}`;
}

export function verifyStaffIdentityVerificationToken(
  token: unknown,
  images: StaffIdentityVerificationImages,
  accountName: string,
  now = Date.now()
): boolean {
  if (typeof token !== "string" || !Number.isSafeInteger(now)) return false;
  const separator = token.indexOf(".");
  if (separator <= 0 || separator !== token.lastIndexOf(".")) return false;
  const issuedAt = Number(token.slice(0, separator));
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > now ||
    now - issuedAt > VERIFICATION_TOKEN_TTL_MS
  ) return false;
  const providedSignature = Buffer.from(token.slice(separator + 1), "base64url");
  if (providedSignature.length !== 32) return false;
  const expectedSignature = createHmac("sha256", verificationTokenKey())
    .update(verificationPayload(images, accountName, issuedAt))
    .digest();
  return timingSafeEqual(providedSignature, expectedSignature);
}

export function staffIdentityVerificationTokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function staffIdentityRevision(images: string, details: string | null) {
  return createHash("sha256").update(JSON.stringify([images, details])).digest("hex");
}

export function keepsStaffIdentityReference(
  previous: StaffIdentityImages,
  next: StaffIdentityImages,
  replacing: "face" | "id"
) {
  const reference = replacing === "face"
    ? ["id_front", "id_back", "id_type"] as const
    : ["face_front", "face_left", "face_right"] as const;
  return reference.every((field) => previous[field] === next[field]);
}

export function parseStaffIdentityImages(value: unknown): StaffIdentityImages | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const images = value as Record<string, unknown>;
  if (images.id_type !== undefined && (typeof images.id_type !== "string" || !["philsys", "drivers_license", "passport", "postal", "voter", "philhealth", "other"].includes(images.id_type))) return null;
  for (const field of [...fields, ...(images.id_back === undefined ? [] : ["id_back"])] ) {
    const image = images[field];
    if (typeof image !== "string" || image.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 30) return null;
    const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match) return null;
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== match[2]) return null;
    const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if ((match[1] === "jpeg" && !jpeg) || (match[1] === "png" && !png)) return null;
  }
  return images as StaffIdentityImages;
}

export function encryptStaffIdentityImages(images: unknown): string {
  const secret = process.env.STAFF_IDENTITY_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("Staff identity storage is not configured.");
  const key = createHmac("sha256", secret).update("merrylane:staff-identity:v1").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(images), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

/**
 * A stable, non-reversible fingerprint of an ID number, scoped to its ID type.
 * Mirrors the other system's duplicate check: formatting differences must not
 * let the same number pass on a second account.
 */
export function staffIdentityFingerprint(idType: string, number: string): string | null {
  const normalized = number.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!normalized) return null;
  const secret = process.env.STAFF_IDENTITY_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("Staff identity storage is not configured.");
  return createHmac("sha256", secret)
    .update(`merrylane:staff-id-number:v1|${idType}|${normalized}`)
    .digest("hex");
}

/** Reports whether another account already stores the same ID number. */
export async function findDuplicateStaffIdentity(
  userId: number | null,
  idType: string,
  number: string
): Promise<boolean> {
  const fingerprint = staffIdentityFingerprint(idType, number);
  if (!fingerprint) return false;
  const row = await getDb()
    .prepare(
      "SELECT user_id FROM staff_identity_registrations WHERE details_fingerprint = ? AND user_id <> ? LIMIT 1"
    )
    .get(fingerprint, userId ?? -1);
  return Boolean(row);
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "23505" ||
    (typeof candidate.message === "string" && /duplicate key|unique constraint/i.test(candidate.message))
  );
}

export function decryptStaffIdentityData(value: string): unknown {
  const secret = process.env.STAFF_IDENTITY_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("Staff identity storage is not configured.");
  const [version, iv, tag, ciphertext] = value.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid identity data.");
  const key = createHmac("sha256", secret).update("merrylane:staff-identity:v1").digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8"));
}

export async function ensureStaffIdentityTable() {
  await getDb().exec(`CREATE TABLE IF NOT EXISTS staff_identity_registrations (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_images TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'awaiting_review',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE staff_identity_registrations ADD COLUMN IF NOT EXISTS encrypted_details TEXT;
  ALTER TABLE staff_identity_registrations ADD COLUMN IF NOT EXISTS details_fingerprint TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS staff_identity_registrations_fingerprint_idx
    ON staff_identity_registrations (details_fingerprint)
    WHERE details_fingerprint IS NOT NULL;
  CREATE TABLE IF NOT EXISTS staff_identity_verification_tokens (
    token_fingerprint TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
  );
  DELETE FROM staff_identity_verification_tokens WHERE expires_at < CURRENT_TIMESTAMP`);
}
