import { UserModel } from "./models";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RecoverableUser = NonNullable<
  Awaited<ReturnType<typeof UserModel.byEmail>>
>;

export function isRecoverableUser(
  user: Awaited<ReturnType<typeof UserModel.byEmail>>
): user is RecoverableUser {
  return Boolean(
    user &&
      user.is_active !== 0 &&
      (user.role === "admin" || user.role === "staff")
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeRecoveryEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && EMAIL_PATTERN.test(email) ? email : null;
}
