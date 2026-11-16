import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { NextResponse } from "next/server";
import {
  ADMIN_IDLE_TIMEOUT_OPTIONS,
  getAdminIdleTimeoutMinutes,
  getStaffIdleTimeoutMinutes,
  isAdminIdleTimeoutMinutes,
  isStaffIdleTimeoutMinutes,
  JWT_SECRET,
  requireAdmin,
  STAFF_IDLE_TIMEOUT_OPTIONS,
} from "@/lib/auth";
import {
  SettingsModel,
  UserModel,
  verifyPassword,
} from "@/lib/models";
import { logActivity } from "@/lib/activityLog";
import { startAutoBackupScheduler } from "@/lib/autoBackup";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function notificationEmailKey(userId: number): string {
  return `admin_notification_email_${userId}`;
}

export async function GET(request: Request) {
  startAutoBackupScheduler();

  const auth = await requireAdmin(request);
  if (auth.error || !auth.user) {
    return auth.error || Response.json(
      { error: "Administrator access is required.", success: false },
      { status: 403 }
    );
  }

  const [
    personalEmail,
    idleTimeoutMinutes,
    staffIdleTimeoutMinutes,
    staffIdleWarningMinutes,
    staffIdleCountdownSeconds,
    facebookUrl,
    twitterUrl,
    tiktokUrl,
    instagramUrl,
    socialMediaEnabled,
  ] = await Promise.all([
    SettingsModel.get(notificationEmailKey(auth.user.id)),
    getAdminIdleTimeoutMinutes(),
    getStaffIdleTimeoutMinutes(),
    SettingsModel.get("staff_idle_warning_minutes"),
    SettingsModel.get("staff_idle_countdown_seconds"),
    SettingsModel.get("facebook_url"),
    SettingsModel.get("twitter_url"),
    SettingsModel.get("tiktok_url"),
    SettingsModel.get("instagram_url"),
    SettingsModel.get("social_media_enabled"),
  ]);

  return Response.json(
    {
      user: {
        id: auth.user.id,
        name: auth.user.name,
        username: auth.user.username,
        role: auth.user.role,
      },
      personal_email: personalEmail || "",
      idle_timeout_minutes: idleTimeoutMinutes,
      staff_idle_timeout_minutes: staffIdleTimeoutMinutes,
      staff_idle_warning_minutes:
        Number(staffIdleWarningMinutes) || 10,
      staff_idle_countdown_seconds:
        Number(staffIdleCountdownSeconds) || 60,
      facebook_url: facebookUrl || "",
      twitter_url: twitterUrl || "",
      tiktok_url: tiktokUrl || "",
      instagram_url: instagramUrl || "",
      social_media_enabled: socialMediaEnabled !== "false",
      idle_timeout_options: ADMIN_IDLE_TIMEOUT_OPTIONS,
      staff_idle_timeout_options: STAFF_IDLE_TIMEOUT_OPTIONS,
      success: true,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PATCH(request: Request) {
  startAutoBackupScheduler();

  try {
    const auth = await requireAdmin(request);
    if (auth.error || !auth.user) {
      return auth.error || Response.json(
        { error: "Administrator access is required.", success: false },
        { status: 403 }
      );
    }

    const rawBody: unknown = await request.json();
    if (!isRecord(rawBody)) {
      return Response.json(
        { error: "Settings must be sent as an object.", success: false },
        { status: 400 }
      );
    }
    const body = rawBody;
    const allowedKeys = new Set([
      "name",
      "personal_email",
      "current_password",
      "new_password",
      "idle_timeout_minutes",
      "staff_idle_timeout_minutes",
      "staff_idle_warning_minutes",
      "staff_idle_countdown_seconds",
      "facebook_url",
      "twitter_url",
      "tiktok_url",
      "instagram_url",
      "social_media_enabled",
    ]);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      return Response.json(
        { error: "One or more settings are not supported.", success: false },
        { status: 400 }
      );
    }

    const hasName = Object.prototype.hasOwnProperty.call(body, "name");
    const hasPersonalEmail = Object.prototype.hasOwnProperty.call(
      body,
      "personal_email"
    );
    const hasNewPassword = Object.prototype.hasOwnProperty.call(
      body,
      "new_password"
    );
    const updatesProfile = hasName || hasPersonalEmail || hasNewPassword;
    const hasIdleTimeout = Object.prototype.hasOwnProperty.call(
      body,
      "idle_timeout_minutes"
    );
    const hasStaffIdleTimeout = Object.prototype.hasOwnProperty.call(
      body,
      "staff_idle_timeout_minutes"
    );
    if (!updatesProfile && !hasIdleTimeout && !hasStaffIdleTimeout) {
      return Response.json(
        { error: "Choose a setting to update.", success: false },
        { status: 400 }
      );
    }

    const name =
      typeof body.name === "string" ? body.name.trim() : undefined;
    const personalEmail =
      typeof body.personal_email === "string"
        ? body.personal_email.trim().toLowerCase()
        : undefined;
    if (
      (hasName && name === undefined) ||
      (hasPersonalEmail && personalEmail === undefined)
    ) {
      return Response.json(
        { error: "Name and personal email must be text values.", success: false },
        { status: 400 }
      );
    }
    if (name !== undefined && (!name || name.length > 80)) {
      return Response.json(
        { error: "Name must be between 1 and 80 characters.", success: false },
        { status: 400 }
      );
    }
    if (
      personalEmail !== undefined &&
      personalEmail !== "" &&
      (personalEmail.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail))
    ) {
      return Response.json(
        { error: "Enter a valid email address, or leave it blank.", success: false },
        { status: 400 }
      );
    }
    if (
      hasIdleTimeout &&
      !isAdminIdleTimeoutMinutes(body.idle_timeout_minutes)
    ) {
      return Response.json(
        { error: "Choose an available idle timeout.", success: false },
        { status: 400 }
      );
    }
    if (
      hasStaffIdleTimeout &&
      !isStaffIdleTimeoutMinutes(body.staff_idle_timeout_minutes)
    ) {
      return Response.json(
        { error: "Choose an available staff idle timeout.", success: false },
        { status: 400 }
      );
    }

    const account = await UserModel.byId(auth.user.id);
    if (!account) {
      return Response.json(
        { error: "Administrator account was not found.", success: false },
        { status: 404 }
      );
    }

    let newPassword: string | undefined;
    if (hasNewPassword) {
      const currentPasswordHash = await UserModel.passwordHashById(auth.user.id);
      if (
        typeof body.current_password !== "string" ||
        !currentPasswordHash ||
        !verifyPassword(body.current_password, currentPasswordHash)
      ) {
        return Response.json(
          { error: "Your current password is incorrect.", success: false },
          { status: 401 }
        );
      }
    }
    if (hasNewPassword) {
      if (typeof body.new_password !== "string") {
        return Response.json(
          { error: "Enter a valid new password.", success: false },
          { status: 400 }
        );
      }
      newPassword = body.new_password.trim();
      if (newPassword.length < 6) {
        return Response.json(
          { error: "Use a password with at least 6 characters.", success: false },
          { status: 400 }
        );
      }
    }

    if (hasName) {
      await UserModel.update(account.id, { name });
    }
    if (hasPersonalEmail && personalEmail !== undefined) {
      await SettingsModel.set(notificationEmailKey(account.id), personalEmail);
    }
    if (newPassword) {
      await UserModel.resetPassword(account.id, newPassword);
    }
    if (hasIdleTimeout) {
      await SettingsModel.set(
        "admin_idle_timeout_minutes",
        String(body.idle_timeout_minutes)
      );
    }
    if (hasStaffIdleTimeout) {
      await SettingsModel.set(
        "staff_idle_timeout_minutes",
        String(body.staff_idle_timeout_minutes)
      );
    }
    const hasStaffIdleWarning = Object.prototype.hasOwnProperty.call(
      body,
      "staff_idle_warning_minutes"
    );
    const hasStaffIdleCountdown = Object.prototype.hasOwnProperty.call(
      body,
      "staff_idle_countdown_seconds"
    );
    if (hasStaffIdleWarning) {
      const warningMinutes = Number(body.staff_idle_warning_minutes);
      if (!Number.isFinite(warningMinutes) || warningMinutes < 1) {
        return Response.json(
          { error: "Staff idle warning minutes must be at least 1.", success: false },
          { status: 400 }
        );
      }
      await SettingsModel.set(
        "staff_idle_warning_minutes",
        String(warningMinutes)
      );
    }
    if (hasStaffIdleCountdown) {
      const countdownSeconds = Number(body.staff_idle_countdown_seconds);
      if (!Number.isFinite(countdownSeconds) || countdownSeconds < 10) {
        return Response.json(
          { error: "Staff idle countdown seconds must be at least 10.", success: false },
          { status: 400 }
        );
      }
      await SettingsModel.set(
        "staff_idle_countdown_seconds",
        String(countdownSeconds)
      );
    }
    const socialMediaFields = [
      "facebook_url",
      "twitter_url",
      "tiktok_url",
      "instagram_url",
    ] as const;
    for (const field of socialMediaFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        const value = String(body[field] || "");
        await SettingsModel.set(field, value);
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "social_media_enabled")) {
      await SettingsModel.set(
        "social_media_enabled",
        String(!!body.social_media_enabled)
      );
    }

    let sessionId = account.session_id || null;
    if (newPassword) {
      sessionId = randomUUID();
      await UserModel.setSession(account.id, sessionId);
    }

    const updatedUser = await UserModel.byId(account.id);
    if (!updatedUser) {
      return Response.json(
        { error: "Updated administrator account could not be loaded.", success: false },
        { status: 500 }
      );
    }
    const [
      idleTimeoutMinutes,
      staffIdleTimeoutMinutes,
      updatedPersonalEmail,
      staffIdleWarningMinutes,
      staffIdleCountdownSeconds,
      facebookUrl,
      twitterUrl,
      tiktokUrl,
      instagramUrl,
      socialMediaEnabled,
    ] = await Promise.all([
      getAdminIdleTimeoutMinutes(),
      getStaffIdleTimeoutMinutes(),
      SettingsModel.get(notificationEmailKey(updatedUser.id)),
      SettingsModel.get("staff_idle_warning_minutes"),
      SettingsModel.get("staff_idle_countdown_seconds"),
      SettingsModel.get("facebook_url"),
      SettingsModel.get("twitter_url"),
      SettingsModel.get("tiktok_url"),
      SettingsModel.get("instagram_url"),
      SettingsModel.get("social_media_enabled"),
    ]);
    const response = NextResponse.json({
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        username: updatedUser.username,
        role: updatedUser.role,
      },
      personal_email: updatedPersonalEmail || "",
      idle_timeout_minutes: idleTimeoutMinutes,
      staff_idle_timeout_minutes: staffIdleTimeoutMinutes,
      staff_idle_warning_minutes:
        Number(staffIdleWarningMinutes) || 10,
      staff_idle_countdown_seconds:
        Number(staffIdleCountdownSeconds) || 60,
      facebook_url: facebookUrl || "",
      twitter_url: twitterUrl || "",
      tiktok_url: tiktokUrl || "",
      instagram_url: instagramUrl || "",
      social_media_enabled: socialMediaEnabled !== "false",
      success: true,
    });

    if (newPassword || hasIdleTimeout) {
      const maxAge = idleTimeoutMinutes * 60;
      const tokenBuilder = new SignJWT({
        userId: updatedUser.id,
        role: "admin",
        sid: sessionId,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + maxAge);
      const token = await tokenBuilder.sign(
        new TextEncoder().encode(JWT_SECRET)
      );
      response.cookies.set("auth-admin-token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge,
        path: "/",
      });
    }

    if (updatesProfile) {
      logActivity(auth.user, {
        area: "Accounts",
        action: "account.settings_updated",
        summary: "Updated administrator account settings",
        entity_type: "user",
        entity_id: updatedUser.id,
      });
    }
    if (hasIdleTimeout) {
      logActivity(auth.user, {
        area: "Settings",
        action: "settings.updated",
        summary: `Changed administrator idle timeout to ${idleTimeoutMinutes} minutes`,
        entity_type: "settings",
        entity_id: null,
      });
    }
    if (hasStaffIdleTimeout) {
      logActivity(auth.user, {
        area: "Settings",
        action: "settings.updated",
        summary: `Changed staff idle timeout to ${
          staffIdleTimeoutMinutes === 0
            ? "Never"
            : `${staffIdleTimeoutMinutes} minutes`
        }`,
        entity_type: "settings",
        entity_id: null,
      });
    }
    if (hasStaffIdleWarning) {
      logActivity(auth.user, {
        area: "Settings",
        action: "settings.updated",
        summary: `Changed staff idle warning minutes to ${body.staff_idle_warning_minutes}`,
        entity_type: "settings",
        entity_id: null,
      });
    }
    if (hasStaffIdleCountdown) {
      logActivity(auth.user, {
        area: "Settings",
        action: "settings.updated",
        summary: `Changed staff idle countdown seconds to ${body.staff_idle_countdown_seconds}`,
        entity_type: "settings",
        entity_id: null,
      });
    }
    if (Object.prototype.hasOwnProperty.call(body, "facebook_url")) {
      logActivity(auth.user, {
        area: "Settings",
        action: "settings.updated",
        summary: "Changed Facebook social media URL",
        entity_type: "settings",
        entity_id: null,
      });
    }
    if (Object.prototype.hasOwnProperty.call(body, "twitter_url")) {
      logActivity(auth.user, {
        area: "Settings",
        action: "settings.updated",
        summary: "Changed Twitter social media URL",
        entity_type: "settings",
        entity_id: null,
      });
    }
    if (Object.prototype.hasOwnProperty.call(body, "tiktok_url")) {
      logActivity(auth.user, {
        area: "Settings",
        action: "settings.updated",
        summary: "Changed TikTok social media URL",
        entity_type: "settings",
        entity_id: null,
      });
    }
    if (Object.prototype.hasOwnProperty.call(body, "instagram_url")) {
      logActivity(auth.user, {
        area: "Settings",
        action: "settings.updated",
        summary: "Changed Instagram social media URL",
        entity_type: "settings",
        entity_id: null,
      });
    }
    if (Object.prototype.hasOwnProperty.call(body, "social_media_enabled")) {
      logActivity(auth.user, {
        area: "Settings",
        action: "settings.updated",
        summary: `Toggled social media icons ${
          body.social_media_enabled ? "on" : "off"
        }`,
        entity_type: "settings",
        entity_id: null,
      });
    }

    return response;
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not save settings.",
        success: false,
      },
      { status: 500 }
    );
  }
}
