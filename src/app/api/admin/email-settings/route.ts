import { requireAdmin } from "@/lib/auth";
import { normalizeSmtpPassword } from "@/lib/emailPasswordCrypto";
import {
  getSmtpConfiguration,
  getEmailNotificationConfig,
  hasSmtpPassword,
  saveEmailNotificationConfig,
  type EmailNotificationConfig,
} from "@/lib/emailSettings";
import { verifySmtpConnection } from "@/lib/emailDelivery";
import { diagnoseEmailDeliveryFailure } from "@/lib/emailDiagnostics";
import { normalizeEmailSubscriptions } from "@/lib/emailSubscriptions";
import type { EmailSubscription } from "@/lib/emailSubscriptions";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    return Response.json(
      {
        config: await getEmailNotificationConfig(),
        smtp_password_configured: await hasSmtpPassword(),
        success: true,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    console.error("Could not load email notification settings.", error);
    return Response.json(
      { error: "Could not load email notification settings.", success: false },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const rawBody: unknown = await request.json();
    if (!isRecord(rawBody)) {
      return Response.json(
        { error: "Email settings must be sent as an object.", success: false },
        { status: 400 }
      );
    }

    const section = rawBody.section;
    if (section !== undefined && section !== "smtp" && section !== "recipients") {
      return Response.json(
        { error: "Choose SMTP settings or email recipients to save.", success: false },
        { status: 400 }
      );
    }

    const smtpKeys = new Set([
      "smtp_host",
      "smtp_port",
      "smtp_secure",
      "smtp_user",
      "smtp_password",
      "from_name",
      "from_email",
    ]);
    const recipientKeys = new Set([
      "subscriptions",
      "send_time",
    ]);
    const allowedKeys = new Set([
      "section",
      ...smtpKeys,
      ...recipientKeys,
    ]);
    const sectionKeys =
      section === "smtp"
        ? new Set(["section", ...smtpKeys])
        : section === "recipients"
          ? new Set(["section", ...recipientKeys])
          : allowedKeys;
    if (Object.keys(rawBody).some((key) => !allowedKeys.has(key) || !sectionKeys.has(key))) {
      return Response.json(
        { error: "One or more email settings are not supported.", success: false },
        { status: 400 }
      );
    }

    const existing = await getEmailNotificationConfig();
    let smtpSettings: Partial<EmailNotificationConfig> = {};
    let recipientSettings: Partial<EmailNotificationConfig> = {};
    let normalizedPassword = "";

    if (section !== "recipients") {
      const host = rawBody.smtp_host;
      const port = rawBody.smtp_port;
      const secure = rawBody.smtp_secure;
      const user = rawBody.smtp_user;
      const password = rawBody.smtp_password;
      const fromName = rawBody.from_name;
      const fromEmail = rawBody.from_email;
      if (
        typeof host !== "string" ||
        host.length > 253 ||
        typeof port !== "number" ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535 ||
        typeof secure !== "boolean" ||
        typeof user !== "string" ||
        user.length > 254 ||
        typeof password !== "string" ||
        password.length > 500 ||
        typeof fromName !== "string" ||
        !fromName.trim() ||
        fromName.trim().length > 100 ||
        typeof fromEmail !== "string" ||
        !isEmail(fromEmail)
      ) {
        return Response.json(
          { error: "Check the SMTP server and sender details.", success: false },
          { status: 400 }
        );
      }

      const smtpHost = host.trim();
      smtpSettings = {
        smtpHost,
        smtpPort: port,
        smtpSecure: secure,
        smtpUser: user.trim(),
        fromName: fromName.trim(),
        fromEmail: fromEmail.trim().toLowerCase(),
      };
      normalizedPassword = normalizeSmtpPassword(password, smtpHost);
    }

    if (section !== "smtp") {
      const subscriptions = rawBody.subscriptions;
      const sendTime = rawBody.send_time;
      if (
        !Array.isArray(subscriptions) ||
        (sendTime !== undefined &&
          (typeof sendTime !== "string" ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime)))
      ) {
        return Response.json(
          { error: "Check the recipient addresses and report schedules.", success: false },
          { status: 400 }
        );
      }

      let normalizedSubscriptions: EmailSubscription[];
      try {
        normalizedSubscriptions = normalizeEmailSubscriptions(subscriptions, {
          sendTime: sendTime ?? existing.sendTime,
        });
      } catch (error: unknown) {
        return Response.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Check each email address and its notification settings.",
            success: false,
          },
          { status: 400 }
        );
      }

      recipientSettings = {
        subscriptions: normalizedSubscriptions,
        ...(sendTime === undefined ? {} : { sendTime }),
      };
    }

    const config: EmailNotificationConfig = {
      ...existing,
      ...smtpSettings,
      ...recipientSettings,
    };
    await saveEmailNotificationConfig(config, normalizedPassword || undefined);

    return Response.json({
      config,
      smtp_password_configured: await hasSmtpPassword(),
      success: true,
    });
  } catch (error: unknown) {
    console.error("Could not save email notification settings.", error);
    return Response.json(
      {
        error:
          error instanceof Error &&
          error.message.startsWith("Set a unique SMTP_PASSWORD_ENCRYPTION_KEY")
            ? error.message
            : "Could not save email notification settings. Check the server logs if the issue continues.",
        success: false,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  let smtpSecrets: string[] = [];
  try {
    const rawBody: unknown = await request.json();
    if (
      !isRecord(rawBody) ||
      rawBody.action !== "verify" ||
      Object.keys(rawBody).some((key) => key !== "action")
    ) {
      return Response.json(
        { error: "Choose the supported SMTP connection check.", success: false },
        { status: 400 }
      );
    }

    const config = await getSmtpConfiguration();
    smtpSecrets = [config.smtpUser, config.smtpPassword].filter(Boolean);
    await verifySmtpConnection(config);
    return Response.json({ success: true });
  } catch (error: unknown) {
    const diagnosis = diagnoseEmailDeliveryFailure(error, smtpSecrets);
    console.error("SMTP connection check failed.", diagnosis);
    return Response.json(
      {
        error: diagnosis.title,
        diagnosis,
        success: false,
      },
      { status: 502 }
    );
  }
}
