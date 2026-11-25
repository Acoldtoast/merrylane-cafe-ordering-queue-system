export function peso(value: number | string | null | undefined) {
  const amount = Number(value || 0);
  return `₱${Math.round(amount).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function clockTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = parseDbDate(value);
  if (!date) return "—";
  return date.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = parseDbDate(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  });
}

/**
 * A date and time together, e.g. "Oct 28 · 5:02 PM". Used anywhere a row can
 * come from an earlier day, so the day is never ambiguous.
 */
export function dateTimeLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = parseDbDate(value);
  if (!date) return "—";
  return `${shortDate(value)} · ${clockTime(value)}`;
}

/**
 * Time only for today's entries, full date and time for anything older.
 */
export function smartDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = parseDbDate(value);
  if (!date) return "—";
  return localDayKey(date) === localDayKey(new Date())
    ? clockTime(value)
    : dateTimeLabel(value);
}

/** "9:00 AM" from a stored "HH:MM" setting. */
export function timeLabel(value: string | null | undefined) {
  if (!value) return "—";
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return "—";
  const date = new Date();
  date.setHours(Number(match[1]) || 0, Number(match[2]) || 0, 0, 0);
  return date.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Local YYYY-MM-DD key (never UTC, so a late-night entry stays on its day). */
export function localDayKey(value: string | Date) {
  const date = typeof value === "string" ? parseDbDate(value) : value;
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

/** "Today", "Yesterday", or the weekday and date for older days. */
export function dayHeading(value: string | null | undefined) {
  const date = value ? parseDbDate(value) : null;
  if (!date) return "";
  const now = new Date();
  const key = localDayKey(date);
  const today = localDayKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === today) return "Today";
  if (key === localDayKey(yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Full calendar date, e.g. "October 28, 2026". */
export function calendarDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = parseDbDate(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function fullDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = parseDbDate(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "long",
    day: "numeric",
  });
}

export function relativeTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = parseDbDate(value);
  if (!date) return "—";
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return shortDate(value);
}

export function elapsedSince(value: string | null | undefined) {
  if (!value) return "";
  const date = parseDbDate(value);
  if (!date) return "";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  return `${minutes} min`;
}

function parseDbDate(value: string) {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function orderTypeLabel(value?: string | null) {
  return value === "take_out" ? "Take out" : "Dine in";
}

export function statusLabel(value?: string | null) {
  switch (value) {
    case "pending":
      return "Awaiting confirmation";
    case "payment_pending":
      return "Payment pending";
    case "confirmed":
      return "Confirmed";
    case "preparing":
      return "Preparing";
    case "ready":
      return "Served · awaiting customer";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Pending";
  }
}

export function timeOfDay() {
  const hour = new Date().getHours();
  if (hour < 11) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
