import { NextResponse, type NextRequest } from "next/server";
import {
  createUserRecoveryCode,
  invalidateUserRecoveryCode,
  markUserRecoveryCodeSent,
  resetUserPasswordWithCode,
} from "@/lib/authSecurity";
import { getSmtpConfiguration } from "@/lib/emailSettings";
import { createSmtpTransport } from "@/lib/emailDelivery";
import { SettingsModel, UserModel } from "@/lib/models";

const EMAIL_TTL_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 60;

function isValidEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const username =
      typeof body?.username === "string" ? body.username.trim() : "";
    if (!username) {
      return NextResponse.json(
        { error: "Enter a valid username.", success: false },
        { status: 400 }
      );
    }

    const user = await UserModel.byUsername(username);
    // Always respond success to avoid account enumeration.
    if (!user || user.is_active === 0) {
      return NextResponse.json({
        success: true,
        message: "If the account exists, a recovery code has been sent.",
        retry_after_seconds: RESEND_COOLDOWN_SECONDS,
      });
    }

    const savedAdminEmail =
      user.role === "admin"
        ? (await SettingsModel.get(`admin_notification_email_${user.id}`))?.trim()
        : "";
    const recoveryEmail =
      user.role === "admin"
        ? savedAdminEmail && isValidEmail(savedAdminEmail)
          ? savedAdminEmail
          : ""
        : user.email;
    if (!recoveryEmail) {
      return NextResponse.json(
        {
          error:
            "A personal recovery email is not configured. Ask an administrator to update the account settings.",
          success: false,
        },
        { status: 409 }
      );
    }
    const result = await createUserRecoveryCode(user.id);
    if (result.status === "throttled") {
      return NextResponse.json({
        success: true,
        throttled: true,
        retry_after_seconds: result.retryAfterSeconds,
        message:
          "A recovery code was sent recently. Please wait before requesting another.",
      });
    }

    const code = result.code;
    // Send the code via the configured SMTP.
    let transport: ReturnType<typeof createSmtpTransport> | undefined;
    try {
      const config = await getSmtpConfiguration();
      transport = createSmtpTransport(config);
      await transport.sendMail({
        from: { name: config.fromName, address: config.fromEmail || config.smtpUser },
        to: recoveryEmail,
        subject: "Merrylane Cafe password recovery code",
        text: `Your recovery code is ${code}. It expires in ${EMAIL_TTL_MINUTES} minutes. If you did not request this, ignore this email.`,
        html: `<p>Your recovery code is <strong>${code}</strong>.</p><p>It expires in ${EMAIL_TTL_MINUTES} minutes. If you did not request this, ignore this email.</p>`,
      });
    } catch (mailError) {
      await invalidateUserRecoveryCode(user.id);
      console.error("Could not send recovery code email.", mailError);
      return NextResponse.json(
        {
          error:
            "The recovery code could not be emailed. Check the email settings and try again.",
          success: false,
        },
        { status: 502 }
      );
    } finally {
      transport?.close();
    }

    await markUserRecoveryCodeSent(user.id);
    return NextResponse.json({
      success: true,
      message: "A recovery code has been sent to the saved recovery email.",
      retry_after_seconds: RESEND_COOLDOWN_SECONDS,
    });
  } catch (error) {
    console.error("Could not create recovery code.", error);
    return NextResponse.json(
      { error: "Could not send a recovery code. Please try again.", success: false },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!username || !code || !password) {
      return NextResponse.json(
        { error: "Username, code, and password are required.", success: false },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: "Use a password with at least 6 characters.", success: false },
        { status: 400 }
      );
    }

    const user = await UserModel.byUsername(username);
    if (!user) {
      return NextResponse.json(
        { error: "The recovery code is invalid or expired.", success: false },
        { status: 400 }
      );
    }

    const result = await resetUserPasswordWithCode(user.id, code, password);
    if (result.status === "invalid_code") {
      return NextResponse.json(
        { error: "The recovery code is invalid or expired.", success: false },
        { status: 400 }
      );
    }
    if (result.status === "password_unchanged") {
      return NextResponse.json(
        { error: "Choose a different password.", success: false },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Your password has been updated. You can sign in now.",
    });
  } catch (error) {
    console.error("Could not reset password.", error);
    return NextResponse.json(
      { error: "Could not reset the password. Please try again.", success: false },
      { status: 500 }
    );
  }
}