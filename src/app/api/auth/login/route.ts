import { UserModel, verifyPassword } from "@/lib/models";
import { getAdminIdleTimeoutMinutes, getJwtSecret, getUser, getUserAuthStatus } from "@/lib/auth";
import {
  clearDeviceLoginFailures,
  clearUserAuthSecurity,
  clearUsernameLoginFailures,
  getDeviceLoginRestriction,
  getUsernameLoginRestriction,
  recordDeviceLoginFailure,
  recordUsernameLoginFailure,
} from "@/lib/authSecurity";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { logActivity } from "@/lib/activityLog";
import { getLoginDeviceContext, setLoginDeviceCookie } from "@/lib/loginDevice";

function formatCooldownDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (remainingSeconds > 0) {
    parts.push(
      `${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`
    );
  }
  return parts.join(" and ");
}

function cooldownMessage(seconds: number, untilNextDay = false): string {
  if (untilNextDay) {
    return "Too many sign-in attempts. Please try again tomorrow.";
  }
  return `Too many sign-in attempts. Please try again in ${formatCooldownDuration(seconds)}.`;
}

export async function POST(request: NextRequest) {
  const loginDevice = getLoginDeviceContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    setLoginDeviceCookie(NextResponse.json(body, init), loginDevice);

  try {
    const rawBody = await request.text();
    const body: unknown = rawBody ? JSON.parse(rawBody) : null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return respond(
        { error: "Username and password are required.", success: false },
        { status: 400 }
      );
    }
    const { username, password } = body as {
      username?: unknown;
      password?: unknown;
    };

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      !username.trim() ||
      !password
    ) {
      return respond(
        { error: "Username and password are required.", success: false },
        { status: 400 }
      );
    }
    if (username.length > 80 || password.length > 128) {
      return respond(
        { error: "Username or password is too long.", success: false },
        { status: 400 }
      );
    }

    // Track failures by username as well as by device: the device cookie can
    // be rotated by an attacker, but the guessed username cannot.
    const loginId = username.trim().toLowerCase();
    await UserModel.ensureColumns();
    const deviceRestriction = await getDeviceLoginRestriction(loginDevice.id);
    const usernameRestriction = await getUsernameLoginRestriction(loginId);
    const activeCooldown =
      deviceRestriction.status === "cooldown"
        ? deviceRestriction
        : usernameRestriction.status === "cooldown"
          ? usernameRestriction
          : null;
    if (activeCooldown) {
      return respond(
        {
          error: cooldownMessage(
            activeCooldown.retryAfterSeconds,
            activeCooldown.untilNextDay
          ),
          failed_attempts: activeCooldown.failedAttempts,
          retry_after_seconds: activeCooldown.retryAfterSeconds,
          until_next_day: activeCooldown.untilNextDay === true,
          success: false,
        },
        {
          status: 429,
          headers: { "Retry-After": String(activeCooldown.retryAfterSeconds) },
        }
      );
    }

    const user = await UserModel.byUsername(loginId);
    if (
      !user ||
      user.is_active === 0 ||
      (user.role !== "admin" && user.role !== "staff") ||
      !verifyPassword(password, user.password_hash)
    ) {
      // Record the failure against both identifiers before responding.
      // Record failures one at a time: PGlite runs a single connection, so
      // concurrent transactions on the same client conflict.
      const deviceFailure = await recordDeviceLoginFailure(loginDevice.id);
      const usernameFailure = await recordUsernameLoginFailure(loginId);
      const cooldown =
        deviceFailure.status === "cooldown"
          ? deviceFailure
          : usernameFailure.status === "cooldown"
            ? usernameFailure
            : null;
      if (cooldown) {
        return respond(
          {
            error: cooldownMessage(
              cooldown.retryAfterSeconds,
              cooldown.untilNextDay
            ),
            failed_attempts: cooldown.failedAttempts,
            retry_after_seconds: cooldown.retryAfterSeconds,
            until_next_day: cooldown.untilNextDay === true,
            success: false,
          },
          {
            status: 429,
            headers: { "Retry-After": String(cooldown.retryAfterSeconds) },
          }
        );
      }
      return respond(
        {
          error: "Those credentials don't match our records.",
          failed_attempts: Math.max(
            deviceFailure.failedAttempts,
            usernameFailure.failedAttempts
          ),
          success: false,
        },
        { status: 401 }
      );
    }

    // Upgrade legacy sha256 passwords to scrypt on a successful login.
    if (user.password_hash?.startsWith("sha256_")) {
      await UserModel.resetPassword(user.id, String(password));
    }

    const sessionId = randomUUID();
    await UserModel.setSession(user.id, sessionId);

    const maxAge =
      user.role === "admin"
        ? (await getAdminIdleTimeoutMinutes()) * 60
        : 12 * 60 * 60;
    const tokenBuilder = new SignJWT({
      userId: user.id,
      role: user.role,
      sid: sessionId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt();
    if (maxAge > 0) {
      tokenBuilder.setExpirationTime(Math.floor(Date.now() / 1000) + maxAge);
    }
    const token = await tokenBuilder.sign(
      new TextEncoder().encode(getJwtSecret())
    );

    logActivity(user, {
      area: "Access",
      action: "auth.login",
      summary: `Signed in as ${
        user.role === "admin" ? "administrator" : "staff"
      }`,
      entity_type: "user",
      entity_id: user.id,
    });
    await UserModel.recordLogin(user.id);
    await clearDeviceLoginFailures(loginDevice.id);
    await clearUsernameLoginFailures(loginId);
    await clearUserAuthSecurity(user.id);

    const response = respond({
      user: { id: user.id, name: user.name, username: user.username, email: user.email, role: user.role },
      success: true,
    });

    const cookieOpts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/" as const,
    };

    // Only one session should be active per browser. Signing in as a role
    // expires any cookie for the other role (and the generic auth-token) so
    // switching accounts in the same browser always starts a clean session.
    response.cookies.set(`auth-admin-token`, "", { ...cookieOpts, maxAge: 0 });
    response.cookies.set(`auth-staff-token`, "", { ...cookieOpts, maxAge: 0 });
    response.cookies.set("auth-token", "", { ...cookieOpts, maxAge: 0 });

    response.cookies.set(`auth-${user.role}-token`, token, {
      ...cookieOpts,
      ...(maxAge > 0 ? { maxAge } : {}),
    });

    return response;
  } catch (error: unknown) {
    console.error("Could not complete sign-in.", error);
    return respond(
      {
        error: "Could not sign in. Please try again.",
        success: false,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const area = new URL(request.url).searchParams.get("area");
  const expectedRole = area === "admin" || area === "staff" ? area : undefined;
  const user = expectedRole === "staff"
    ? (await getUserAuthStatus(request, "staff", true, true)).user
    : expectedRole ? await getUser(request, expectedRole) : await getUser(request);
  if (user) {
    await UserModel.recordLogout(user.id);
    logActivity(user, {
      area: "Access",
      action: "auth.logout",
      summary: "Signed out",
      entity_type: "user",
      entity_id: user.id,
    });
    await UserModel.setSession(user.id, null);
  }
  const response = NextResponse.json({ success: true });
  if (area === "admin" || area === "staff") {
    response.cookies.set(`auth-${area}-token`, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
      path: "/",
    });
  }
  response.cookies.set("auth-token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
  return response;
}
