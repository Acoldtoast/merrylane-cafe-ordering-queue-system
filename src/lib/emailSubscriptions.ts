import type { EmailCadence } from "./emailSchedule";

export interface EmailSubscription {
  email: string;
  noStockAlerts: boolean;
  lowStockAlerts: boolean;
  salesCadence: EmailCadence;
  analyticsCadence: EmailCadence;
  reportSendTime: string;
}

const CADENCE_RANK: Record<EmailCadence, number> = {
  off: 0,
  monthly: 1,
  weekly: 2,
  daily: 3,
};

interface LegacyEmailSettings {
  recipients?: unknown;
  noStockAlerts?: unknown;
  lowStockAlerts?: unknown;
  salesCadence?: unknown;
  analyticsCadence?: unknown;
  sendTime?: unknown;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CADENCES = new Set<string>(["off", "daily", "weekly", "monthly"]);
const DEFAULT_SEND_TIME = "08:00";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCadence(value: unknown): value is EmailCadence {
  return typeof value === "string" && CADENCES.has(value);
}

function isSendTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function reportTimeFromEntry(
  entry: Record<string, unknown>,
  fallback: string
): string {
  if (isSendTime(entry.reportSendTime)) return entry.reportSendTime;
  // Keep the active sales time if legacy report times differ.
  if (entry.salesCadence !== "off" && isSendTime(entry.salesSendTime)) {
    return entry.salesSendTime;
  }
  if (entry.analyticsCadence !== "off" && isSendTime(entry.analyticsSendTime)) {
    return entry.analyticsSendTime;
  }
  if (isSendTime(entry.salesSendTime)) return entry.salesSendTime;
  if (isSendTime(entry.analyticsSendTime)) return entry.analyticsSendTime;
  return fallback;
}

export function normalizeEmailSubscriptions(
  value: unknown,
  legacy: LegacyEmailSettings = {}
): EmailSubscription[] {
  const defaultSendTime = isSendTime(legacy.sendTime)
    ? legacy.sendTime
    : DEFAULT_SEND_TIME;
  let entries: unknown[];
  if (value === undefined) {
    if (legacy.recipients === undefined) return [];
    if (!Array.isArray(legacy.recipients)) {
      throw new Error("Saved email recipients are invalid.");
    }
    const salesCadence = isCadence(legacy.salesCadence)
      ? legacy.salesCadence
      : "off";
    const analyticsCadence = isCadence(legacy.analyticsCadence)
      ? legacy.analyticsCadence
      : "off";
    entries = legacy.recipients.map((email) => ({
      email,
      noStockAlerts: legacy.noStockAlerts === true,
      lowStockAlerts: legacy.lowStockAlerts === true,
      salesCadence,
      analyticsCadence,
      reportSendTime: defaultSendTime,
    }));
  } else if (Array.isArray(value)) {
    entries = value;
  } else {
    throw new Error("Email subscriptions must be a list.");
  }

  if (entries.length > 20) {
    throw new Error("Add no more than 20 email addresses.");
  }

  const seen = new Set<string>();
  return entries.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.email !== "string" ||
      typeof entry.noStockAlerts !== "boolean" ||
      typeof entry.lowStockAlerts !== "boolean" ||
      !isCadence(entry.salesCadence) ||
      !isCadence(entry.analyticsCadence) ||
      (entry.salesSendTime !== undefined && !isSendTime(entry.salesSendTime)) ||
      (entry.analyticsSendTime !== undefined &&
        !isSendTime(entry.analyticsSendTime)) ||
      (entry.reportSendTime !== undefined && !isSendTime(entry.reportSendTime))
    ) {
      throw new Error("Check each email address and its notification settings.");
    }

    const email = entry.email.trim().toLowerCase();
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
      throw new Error("Enter a valid email address for each recipient.");
    }
    if (seen.has(email)) {
      throw new Error("Each email address can only be added once.");
    }
    seen.add(email);

    return {
      email,
      noStockAlerts: entry.noStockAlerts,
      lowStockAlerts: entry.lowStockAlerts,
      salesCadence: entry.salesCadence,
      analyticsCadence: entry.analyticsCadence,
      reportSendTime: reportTimeFromEntry(entry, defaultSendTime),
    };
  });
}

export function redirectEmailSubscriptionRecipients(
  subscriptions: EmailSubscription[],
  redirects: ReadonlyMap<string, string | null>
): EmailSubscription[] {
  const redirected = new Map<string, EmailSubscription>();
  for (const subscription of subscriptions) {
    const redirect = redirects.get(subscription.email);
    if (redirect === null) continue;
    const email = redirect ?? subscription.email;
    const current = redirected.get(email);
    if (!current) {
      redirected.set(email, { ...subscription, email });
      continue;
    }

    redirected.set(email, {
      ...current,
      noStockAlerts: current.noStockAlerts || subscription.noStockAlerts,
      lowStockAlerts: current.lowStockAlerts || subscription.lowStockAlerts,
      salesCadence:
        CADENCE_RANK[current.salesCadence] >= CADENCE_RANK[subscription.salesCadence]
          ? current.salesCadence
          : subscription.salesCadence,
      analyticsCadence:
        CADENCE_RANK[current.analyticsCadence] >= CADENCE_RANK[subscription.analyticsCadence]
          ? current.analyticsCadence
          : subscription.analyticsCadence,
    });
  }
  return [...redirected.values()];
}

export function addEmailSubscriptionRecipients(
  subscriptions: EmailSubscription[],
  recipients: string[]
): EmailSubscription[] {
  const copies = subscriptions.flatMap((subscription) =>
    recipients.map((email) => ({ ...subscription, email }))
  );
  return redirectEmailSubscriptionRecipients(
    [...subscriptions, ...copies],
    new Map()
  );
}
