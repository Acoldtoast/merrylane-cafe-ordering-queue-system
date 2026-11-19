import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

function deriveKey(secret: string, context: string): Buffer {
  return createHmac("sha256", secret).update(context).digest();
}

function smtpPasswordEncryptionKey(): Buffer {
  const secret = process.env.SMTP_PASSWORD_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error(
      "Set a unique SMTP_PASSWORD_ENCRYPTION_KEY with at least 32 characters in .env.local before saving an SMTP password."
    );
  }
  return deriveKey(secret, "merrylane:smtp-password:v2");
}

function legacySmtpPasswordEncryptionKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "The saved SMTP password uses the previous JWT_SECRET key. JWT_SECRET must be configured in .env.local before the legacy SMTP password can be decoded; otherwise enter the Google app password again and save it to encrypt it with this installation's SMTP key."
    );
  }
  return deriveKey(secret, "merrylane:smtp-password:v1");
}

export function normalizeSmtpPassword(password: string, host: string): string {
  return host.trim().toLowerCase() === "smtp.gmail.com"
    ? password.replace(/\s+/g, "")
    : password;
}

export function encryptSmtpPassword(password: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", smtpPasswordEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(password, "utf8"),
    cipher.final(),
  ]);
  return [
    "v2",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptSmtpPassword(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(":");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Saved SMTP password has an unsupported format.");
  }

  const key =
    version === "v1"
      ? legacySmtpPasswordEncryptionKey()
      : version === "v2"
        ? smtpPasswordEncryptionKey()
        : null;
  if (!key) {
    throw new Error("Saved SMTP password has an unsupported format.");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivValue, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      version === "v1"
        ? "Could not decrypt the saved SMTP password. Check that the previous JWT_SECRET has not changed."
        : "Could not decrypt the saved SMTP password. Check that SMTP_PASSWORD_ENCRYPTION_KEY has not changed."
    );
  }
}
