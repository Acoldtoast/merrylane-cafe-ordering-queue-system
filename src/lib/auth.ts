/**
 * Session helpers. JWT is stored in an httpOnly cookie and verified with jose.
 */
import { jwtVerify } from "jose";
import { SettingsModel, UserModel } from "./models";
import type { User } from "./types";

export const JWT_SECRET =
  process.env.JWT_SECRET || "merrylane-secret-change-me-in-production";

export const ADMIN_IDLE_TIMEOUT_OPTIONS = [5, 10, 15, 30, 60] as const;
export const STAFF_IDLE_TIMEOUT_OPTIONS = [5, 10, 15, 30, 60, 0] as const;
export type AdminIdleTimeoutMinutes =
  (typeof ADMIN_IDLE_TIMEOUT_OPTIONS)[number];
export type StaffIdleTimeoutMinutes =
  (typeof STAFF_IDLE_TIMEOUT_OPTIONS)[number];

export async function getAdminIdleTimeoutMinutes(): Promise<AdminIdleTimeoutMinutes> {
  const value = await SettingsModel.get("admin_idle_timeout_minutes");
  const configured = value?.trim() ? Number(value) : Number.NaN;
  return (
    ADMIN_IDLE_TIMEOUT_OPTIONS.find((minutes) => minutes === configured) ?? 5
  );
}

export function isAdminIdleTimeoutMinutes(
  value: unknown
): value is AdminIdleTimeoutMinutes {
  return (
    typeof value === "number" &&
    ADMIN_IDLE_TIMEOUT_OPTIONS.some((minutes) => minutes === value)
  );
}

export async function getStaffIdleTimeoutMinutes(): Promise<StaffIdleTimeoutMinutes> {
  const value = await SettingsModel.get("staff_idle_timeout_minutes");
  const configured = value?.trim() ? Number(value) : Number.NaN;
  return (
    STAFF_IDLE_TIMEOUT_OPTIONS.find((minutes) => minutes === configured) ?? 15
  );
}

export function isStaffIdleTimeoutMinutes(
  value: unknown
): value is StaffIdleTimeoutMinutes {
  return (
    typeof value === "number" &&
    STAFF_IDLE_TIMEOUT_OPTIONS.some((minutes) => minutes === value)
  );
}

export interface UserAuthStatus {
  user: User | null;
  reason?: "session_conflict" | "session_expired";
}

export async function getUserAuthStatus(
  request: Request,
  expectedRole?: "admin" | "staff"
): Promise<UserAuthStatus> {
  const cookieHeader = request.headers.get("cookie");
  // No cookie at all means the user never signed in on this browser;
  // don't report it as an expired session.
  if (!cookieHeader) return { user: null };

  const cookies = Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key]) => key)
  );
  const tokens = expectedRole
    ? [cookies[`auth-${expectedRole}-token`], cookies["auth-token"]]
    : [
        cookies["auth-token"],
        cookies["auth-admin-token"],
        cookies["auth-staff-token"],
      ];
  let sessionConflict = false;
  for (const token of tokens) {
    if (!token) continue;
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(JWT_SECRET)
      );
      if (
        expectedRole &&
        payload.role !== expectedRole
      ) {
        continue;
      }
      const userId = Number(payload.userId);
      if (!userId) continue;
      const user = await UserModel.byId(userId);
      if (!user || user.is_active === 0 || (expectedRole && user.role !== expectedRole)) continue;
      const tokenSessionId = payload.sid ? String(payload.sid) : null;
      if (tokenSessionId !== (user.session_id || null)) {
        sessionConflict = true;
        continue;
      }
      return {
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      };
    } catch {
      continue;
    }
  }
  return {
    user: null,
    reason: sessionConflict ? "session_conflict" : "session_expired",
  };
}

export async function getUser(
  request: Request,
  expectedRole?: "admin" | "staff"
): Promise<User | null> {
  const status = await getUserAuthStatus(request, expectedRole);
  return status.user;
}

export async function requireStaff(request: Request) {
  const user = await getUser(request, "staff");
  if (!user) {
    return {
      user: null,
      error: Response.json(
        { error: "Please sign in to continue.", success: false },
        { status: 401 }
      ),
    };
  }
  return { user, error: null };
}

export async function requireAdmin(request: Request) {
  const user = await getUser(request, "admin");
  if (!user) {
    return {
      user: null,
      error: Response.json(
        { error: "Administrator access is required.", success: false },
        { status: 403 }
      ),
    };
  }
  return { user, error: null };
}
