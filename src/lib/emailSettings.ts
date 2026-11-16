import { SettingsModel, UserModel } from "@/lib/models";
import {
  decryptSmtpPassword,
  encryptSmtpPassword,
} from "./emailPasswordCrypto";
import {
  addEmailSubscriptionRecipients,
  normalizeEmailSubscriptions,
  redirectEmailSubscriptionRecipients,
  type EmailSubscription,
} from "./emailSubscriptions";

export { encryptSmtpPassword };

const EMAIL_CONFIG_KEY = "email_notifications_config";
const SMTP_PASSWORD_KEY = "email_smtp_password";
const DEFAULT_FROM_NAME = "Merrylane Cafe";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AdminEmailRouting {
  redirects: Map<string, string | null>;
  personalEmails: string[];
}

async function getAdminEmailRouting(): Promise<AdminEmailRouting> {
  const admins = (await UserModel.all()).filter((user) => user.role === "admin");
  const redirects = new Map<string, string | null>();
  const personalEmails = new Set<string>();
  for (const admin of admins) {
    const loginEmail = admin.email.trim().toLowerCase();
    if (!loginEmail) continue;
    const personalEmail = (
      await SettingsModel.get(`admin_notification_email_${admin.id}`)
    )
      ?.trim()
      .toLowerCase();
    redirects.set(
      loginEmail,
      personalEmail &&
        personalEmail.length <= 254 &&
        EMAIL_PATTERN.test(personalEmail)
        ? personalEmail
        : null
    );
    if (
      personalEmail &&
      personalEmail.length <= 254 &&
      EMAIL_PATTERN.test(personalEmail)
    ) {
      personalEmails.add(personalEmail);
    }
  }
  return { redirects, personalEmails: [...personalEmails] };
}

export interface EmailNotificationConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  fromName: string;
  fromEmail: string;
  subscriptions: EmailSubscription[];
  sendTime: string;
}

export interface SmtpConfiguration extends EmailNotificationConfig {
  smtpPassword: string;
}

export const DEFAULT_EMAIL_NOTIFICATION_CONFIG: EmailNotificationConfig = {
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  fromName: DEFAULT_FROM_NAME,
  fromEmail: "",
  subscriptions: [],
  sendTime: "08:00",
};

export async function getEmailNotificationConfig(options: {
  includeAdminPersonalEmailRecipients?: boolean;
} = {}): Promise<EmailNotificationConfig> {
  const stored = await SettingsModel.get(EMAIL_CONFIG_KEY);
  if (!stored) return { ...DEFAULT_EMAIL_NOTIFICATION_CONFIG };

  const parsed: unknown = JSON.parse(stored);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Saved email notification settings are invalid.");
  }
  const saved = parsed as Record<string, unknown>;
  const subscriptions = normalizeEmailSubscriptions(saved.subscriptions, {
    recipients: saved.recipients,
    noStockAlerts: saved.noStockAlerts,
    lowStockAlerts: saved.lowStockAlerts,
    salesCadence: saved.salesCadence,
    analyticsCadence: saved.analyticsCadence,
    sendTime: saved.sendTime,
  });
  const adminEmailRouting = subscriptions.length
    ? await getAdminEmailRouting()
    : { redirects: new Map<string, string | null>(), personalEmails: [] };
  let routedSubscriptions = redirectEmailSubscriptionRecipients(
    subscriptions,
    adminEmailRouting.redirects
  );
  if (
    options.includeAdminPersonalEmailRecipients &&
    adminEmailRouting.personalEmails.length
  ) {
    routedSubscriptions = addEmailSubscriptionRecipients(
      routedSubscriptions,
      adminEmailRouting.personalEmails
    );
  }
  return {
    smtpHost:
      typeof saved.smtpHost === "string"
        ? saved.smtpHost
        : DEFAULT_EMAIL_NOTIFICATION_CONFIG.smtpHost,
    smtpPort:
      typeof saved.smtpPort === "number"
        ? saved.smtpPort
        : DEFAULT_EMAIL_NOTIFICATION_CONFIG.smtpPort,
    smtpSecure:
      typeof saved.smtpSecure === "boolean"
        ? saved.smtpSecure
        : DEFAULT_EMAIL_NOTIFICATION_CONFIG.smtpSecure,
    smtpUser:
      typeof saved.smtpUser === "string"
        ? saved.smtpUser
        : DEFAULT_EMAIL_NOTIFICATION_CONFIG.smtpUser,
    fromName:
      typeof saved.fromName === "string"
        ? saved.fromName
        : DEFAULT_EMAIL_NOTIFICATION_CONFIG.fromName,
    fromEmail:
      typeof saved.fromEmail === "string"
        ? saved.fromEmail
        : DEFAULT_EMAIL_NOTIFICATION_CONFIG.fromEmail,
    subscriptions: routedSubscriptions,
    sendTime:
      typeof saved.sendTime === "string"
        ? saved.sendTime
        : DEFAULT_EMAIL_NOTIFICATION_CONFIG.sendTime,
  };
}

export async function hasSmtpPassword(): Promise<boolean> {
  return Boolean(await SettingsModel.get(SMTP_PASSWORD_KEY));
}

export async function saveEmailNotificationConfig(
  config: EmailNotificationConfig,
  smtpPassword?: string
): Promise<void> {
  if (smtpPassword) {
    await SettingsModel.set(
      SMTP_PASSWORD_KEY,
      encryptSmtpPassword(smtpPassword)
    );
  }
  await SettingsModel.set(EMAIL_CONFIG_KEY, JSON.stringify(config));
}

export async function getSmtpConfiguration(): Promise<SmtpConfiguration> {
  const [config, encryptedPassword] = await Promise.all([
    getEmailNotificationConfig({ includeAdminPersonalEmailRecipients: true }),
    SettingsModel.get(SMTP_PASSWORD_KEY),
  ]);
  return {
    ...config,
    smtpPassword: encryptedPassword
      ? decryptSmtpPassword(encryptedPassword)
      : "",
  };
}

export function smtpConnectionIsReady(config: SmtpConfiguration): boolean {
  return Boolean(
    config.smtpHost &&
      config.smtpPort > 0 &&
      config.fromEmail &&
      (!config.smtpUser || config.smtpPassword)
  );
}

export function smtpIsReady(config: SmtpConfiguration): boolean {
  return smtpConnectionIsReady(config) && config.subscriptions.length > 0;
}
