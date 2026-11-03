/**
 * Session helpers. JWT is stored in an httpOnly cookie and verified with jose.
 */
import { jwtVerify } from "jose";
import { UserModel } from "./models";
import type { User } from "./types";

export const JWT_SECRET =
  process.env.JWT_SECRET || "merrylane-secret-change-me-in-production";

export async function getUser(
  request: Request,
  expectedRole?: "admin" | "staff"
): Promise<User | null> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

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
      const user = UserModel.byId(userId);
      if (!user || (expectedRole && user.role !== expectedRole)) continue;
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      };
    } catch {
      continue;
    }
  }
  return null;
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
