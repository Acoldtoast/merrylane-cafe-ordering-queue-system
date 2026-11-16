import { SignJWT } from "jose";
import { NextResponse } from "next/server";
import {
  getStaffIdleTimeoutMinutes,
  JWT_SECRET,
  requireStaff,
} from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { isPastManilaShopClose } from "@/lib/authSecurity";
import { SettingsModel, UserModel } from "@/lib/models";

const staffSessionSeconds = 12 * 60 * 60;

async function staffSessionResponse(
  userId: number,
  action: "active" | "locked",
  idleTimeoutMinutes?: number
) {
  const sessionId = (await UserModel.byId(userId))?.session_id || null;
  const token = await new SignJWT({
    userId,
    role: "staff",
    sid: sessionId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + staffSessionSeconds)
    .sign(new TextEncoder().encode(JWT_SECRET));
  const response = NextResponse.json({
    action,
    ...(idleTimeoutMinutes === undefined
      ? {}
      : { idle_timeout_minutes: idleTimeoutMinutes }),
    success: true,
  });
  response.cookies.set("auth-staff-token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: staffSessionSeconds,
    path: "/",
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function POST(request: Request) {
  try {
    const auth = await requireStaff(request);
    if (auth.error || !auth.user) {
      return auth.error || Response.json(
        { error: "Please sign in to continue.", success: false },
        { status: 401 }
      );
    }

    const body = await request.json();
    const lastActivityAt = Number(body.last_activity_at);
    const now = new Date();
    const idleSince =
      Number.isFinite(lastActivityAt) &&
      lastActivityAt > 0 &&
      lastActivityAt <= now.getTime()
        ? new Date(lastActivityAt)
        : now;
    const idleTimeoutMinutes = await getStaffIdleTimeoutMinutes();
    const idleAt = new Date(
      idleSince.getTime() + idleTimeoutMinutes * 60 * 1000
    );
    const idleMinutes =
      (now.getTime() - idleSince.getTime()) / 60_000;
    const closingTimeRaw = await SettingsModel.get("closing_time");
    const closingTime =
      typeof closingTimeRaw === "string" && closingTimeRaw.trim()
        ? closingTimeRaw
        : "00:00";
    const shopClosed = isPastManilaShopClose(idleSince, now, closingTime);

    // Read configurable idle warning and countdown settings (defaults: 10 min
    // warning, 60 sec countdown = sign out at 11 minutes idle).
    const warningMinutesRaw = await SettingsModel.get(
      "staff_idle_warning_minutes"
    );
    const countdownSecondsRaw = await SettingsModel.get(
      "staff_idle_countdown_seconds"
    );
    const warningMinutes =
      Number(warningMinutesRaw) && Number.isFinite(Number(warningMinutesRaw))
        ? Number(warningMinutesRaw)
        : 10;
    const countdownSeconds =
      Number(countdownSecondsRaw) && Number.isFinite(Number(countdownSecondsRaw))
        ? Number(countdownSecondsRaw)
        : 60;
    const signoutMinutes = warningMinutes + countdownSeconds / 60;

    // Past shop closing time: warn at configured warning minutes, sign out at
    // configured signout minutes, regardless of the configured staff idle
    // timeout. This ensures short-timeout sessions also get the warning card
    // before sign-out.
    if (shopClosed) {
      if (idleMinutes >= signoutMinutes) {
        // Record the sign-out at when the staff member actually stopped activity,
        // not when the background check runs, so the duty log reflects the real
        // end of their shift (e.g. 10:15 or 12:05) rather than a later poll time.
        const logoutAt = SettingsModel.localDateTime(idleSince);
        await UserModel.recordLogout(auth.user.id, logoutAt);
        await UserModel.setSession(auth.user.id, null);
        logActivity(auth.user, {
          area: "Access",
          action: "auth.auto_logout",
          summary: `Automatically signed out after remaining idle past shop closing at ${logoutAt}`,
          entity_type: "user",
          entity_id: auth.user.id,
        });
        const response = NextResponse.json({
          action: "signed_out",
          success: true,
        });
        response.cookies.set("auth-staff-token", "", {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: 0,
          path: "/",
        });
        response.headers.set("Cache-Control", "no-store, max-age=0");
        return response;
      }

      if (idleMinutes >= warningMinutes) {
        const secondsUntilSignout = Math.ceil(
          (signoutMinutes - idleMinutes) * 60
        );
        return NextResponse.json({
          action: "idle_warning",
          success: true,
          seconds_until_signout: Math.max(0, secondsUntilSignout),
        });
      }

      // Within the grace period after closing: still active, no warning yet.
      return staffSessionResponse(auth.user.id, "active", idleTimeoutMinutes);
    }

    // Shop not yet closed: use the configured staff idle timeout.
    if (idleTimeoutMinutes === 0) {
      return staffSessionResponse(auth.user.id, "active", 0);
    }

    if (idleAt > now) {
      return staffSessionResponse(auth.user.id, "active", idleTimeoutMinutes);
    }

    return staffSessionResponse(auth.user.id, "locked");
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not check the staff session.",
        success: false,
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
