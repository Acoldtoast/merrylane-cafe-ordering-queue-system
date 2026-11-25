export interface SettingsAuditScheduleEntry {
  day: string;
  enabled?: boolean;
  open?: boolean;
  start?: string;
  end?: string;
  last_order?: string;
}

interface SettingsAuditInput {
  previousValues: Record<string, string | undefined>;
  nextValues: Record<string, unknown>;
  previousSchedule: readonly SettingsAuditScheduleEntry[];
  nextSchedule?: unknown;
}

const DEFAULT_VALUES: Record<string, string> = {
  cafe_name: "Merrylane Cafe",
  cafe_location: "Lipa City, Batangas",
  wifi_ssid: "MERLYLANE-WIFI",
  gcash_number: "0917 123 4567",
  gcash_name: "Merrylane Cafe",
  gcash_qr_data_url: "",
  ordering_closed: "false",
  last_order_time: "21:00",
  opening_time: "09:00",
  closing_time: "22:00",
  service_charge_pct: "0",
  vat_mode: "none",
  vat_inclusive: "false",
  vat_rate_pct: "0",
  days_operating: "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
  staff_idle_warning_minutes: "10",
  staff_idle_countdown_seconds: "60",
  facebook_url: "",
  twitter_url: "",
  tiktok_url: "",
  instagram_url: "",
  social_media_enabled: "true",
};

const FIELD_LABELS: Record<string, string> = {
  cafe_name: "Cafe name",
  cafe_location: "Location",
  wifi_ssid: "Wi-Fi name",
  gcash_number: "GCash number",
  gcash_name: "GCash account name",
  gcash_qr_data_url: "GCash QR",
  ordering_closed: "Customer ordering",
  last_order_time: "Last-order cutoff",
  opening_time: "Opening time",
  closing_time: "Closing time",
  service_charge_pct: "Service charge",
  vat_mode: "VAT pricing",
  vat_inclusive: "VAT setting",
  vat_rate_pct: "VAT rate",
  days_operating: "Operating days",
  staff_idle_warning_minutes: "Staff idle warning minutes",
  staff_idle_countdown_seconds: "Staff idle countdown seconds",
};

const SCHEDULE_MIRRORS = new Set([
  "last_order_time",
  "opening_time",
  "closing_time",
]);
const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function settingsAuditChanges({
  previousValues,
  nextValues,
  previousSchedule,
  nextSchedule,
}: SettingsAuditInput): string[] {
  const changes: string[] = [];
  const hasSchedule = Array.isArray(nextSchedule);

  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    if (!Object.prototype.hasOwnProperty.call(nextValues, key)) continue;
    if (hasSchedule && SCHEDULE_MIRRORS.has(key)) continue;

    const previousValue = Object.prototype.hasOwnProperty.call(previousValues, key)
      ? previousValues[key]
      : DEFAULT_VALUES[key];
    const nextValue = nextValues[key];
    if (sameSettingValue(key, previousValue, nextValue)) continue;

    if (key === "gcash_qr_data_url") {
      const hadImage = Boolean(previousValue);
      const hasImage = Boolean(nextValue);
      changes.push(
        hasImage
          ? hadImage
            ? "GCash QR image replaced."
            : "GCash QR image added."
          : "GCash QR image removed."
      );
      continue;
    }

    if (key === "ordering_closed") {
      changes.push(
        `Customer ordering changed from ${booleanLabel(previousValue, "Open", "Paused")} to ${booleanLabel(nextValue, "Open", "Paused")}.`
      );
      continue;
    }

    if (key === "vat_mode") {
      changes.push(
        `VAT pricing changed from ${vatModeLabel(previousValue)} to ${vatModeLabel(nextValue)}.`
      );
      continue;
    }

    if (key === "vat_inclusive") {
      changes.push(
        `Add VAT to menu prices changed from ${booleanLabel(previousValue, "On", "Off")} to ${booleanLabel(nextValue, "On", "Off")}.`
      );
      continue;
    }

    if (key === "service_charge_pct" || key === "vat_rate_pct") {
      changes.push(
        `${FIELD_LABELS[key]} changed from ${formatPercent(previousValue)} to ${formatPercent(nextValue)}.`
      );
      continue;
    }

    if (key === "days_operating") {
      changes.push(
        `Operating days changed from ${formatDays(previousValue)} to ${formatDays(nextValue)}.`
      );
      continue;
    }

    const formatter = SCHEDULE_MIRRORS.has(key) ? formatTime : formatText;
    changes.push(
      `${label} changed from ${formatter(previousValue)} to ${formatter(nextValue)}.`
    );
  }

  if (Array.isArray(nextSchedule)) {
    const previousByDay = new Map(
      previousSchedule.map((entry) => [entry.day, entry])
    );
    for (const value of nextSchedule) {
      if (!isScheduleEntry(value)) continue;
      const previous = previousByDay.get(value.day);
      if (!previous) {
        changes.push(`${value.day}: set.`);
        continue;
      }

      const dayChanges: string[] = [];
      const previousOpen = scheduleOpen(previous);
      const nextOpen = scheduleOpen(value);
      if (previousOpen !== nextOpen) {
        dayChanges.push(
          `status changed from ${previousOpen ? "Open" : "Closed"} to ${nextOpen ? "Open" : "Closed"}`
        );
      }
      addScheduleTimeChange(dayChanges, "opening time", previous.start, value.start);
      addScheduleTimeChange(dayChanges, "closing time", previous.end, value.end);
      addScheduleTimeChange(
        dayChanges,
        "last-order cutoff",
        previous.last_order,
        value.last_order
      );
      if (dayChanges.length) {
        changes.push(`${value.day}: ${dayChanges.join("; ")}.`);
      }
    }
  }

  return changes;
}

function sameSettingValue(key: string, previous: unknown, next: unknown) {
  if (key === "ordering_closed" || key === "vat_inclusive") {
    return asBoolean(previous) === asBoolean(next);
  }
  if (key === "service_charge_pct" || key === "vat_rate_pct") {
    const previousAmount = Number(previous || 0);
    const nextAmount = Number(next || 0);
    return Number.isFinite(previousAmount) && Number.isFinite(nextAmount)
      ? previousAmount === nextAmount
      : String(previous ?? "").trim() === String(next ?? "").trim();
  }
  if (SCHEDULE_MIRRORS.has(key)) {
    return formatTime(previous) === formatTime(next);
  }
  if (key === "days_operating") {
    return formatDays(previous) === formatDays(next);
  }
  return String(previous ?? "").trim() === String(next ?? "").trim();
}

function asBoolean(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function booleanLabel(value: unknown, trueLabel: string, falseLabel: string) {
  return asBoolean(value) ? trueLabel : falseLabel;
}

function vatModeLabel(value: unknown) {
  return value === "add"
    ? "added to menu prices"
    : value === "included"
      ? "already included in menu prices"
      : "off";
}

function formatPercent(value: unknown) {
  const amount = Number(value || 0);
  return `${Number.isFinite(amount) ? amount : String(value ?? 0)}%`;
}

function formatTime(value: unknown) {
  const text = String(value ?? "").trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return text || "not set";
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

function formatText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? `“${text}”` : "blank";
}

function formatDays(value: unknown) {
  const days = String(value ?? "")
    .split(",")
    .map((day) => day.trim())
    .filter(Boolean);
  days.sort((a, b) => {
    const aIndex = WEEKDAYS.indexOf(a);
    const bIndex = WEEKDAYS.indexOf(b);
    return (aIndex < 0 ? WEEKDAYS.length : aIndex) -
      (bIndex < 0 ? WEEKDAYS.length : bIndex);
  });
  return days.length ? days.join(", ") : "none";
}

function isScheduleEntry(value: unknown): value is SettingsAuditScheduleEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "day" in value &&
    typeof value.day === "string"
  );
}

function scheduleOpen(entry: SettingsAuditScheduleEntry) {
  return Boolean(entry.enabled ?? entry.open);
}

function addScheduleTimeChange(
  changes: string[],
  label: string,
  previous: string | undefined,
  next: string | undefined
) {
  if (formatTime(previous) === formatTime(next)) return;
  changes.push(`${label} changed from ${formatTime(previous)} to ${formatTime(next)}`);
}
