export type EmailCadence = "off" | "daily" | "weekly" | "monthly";

export interface ReportWindow {
  key: string;
  start: string;
  end: string;
}

function manilaParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  if (!year || !month || !day || !hour || !minute) {
    throw new Error("Unable to determine the Manila reporting time.");
  }
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
  };
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function reportWindow(
  cadence: EmailCadence,
  now: Date,
  sendTime: string,
  kind: "sales" | "analytics"
): ReportWindow | null {
  if (cadence === "off") return null;
  const current = manilaParts(now);
  if (current.time < sendTime) return null;

  if (cadence === "daily") {
    const end = shiftDate(current.date, -1);
    return { key: `${kind}:daily:${end}`, start: end, end };
  }

  const today = new Date(`${current.date}T00:00:00.000Z`);
  if (cadence === "weekly") {
    const daysSinceMonday = (today.getUTCDay() + 6) % 7;
    const weekStart = shiftDate(current.date, -daysSinceMonday);
    const end = shiftDate(weekStart, -1);
    const start = shiftDate(end, -6);
    return { key: `${kind}:weekly:${start}:${end}`, start, end };
  }

  const monthStart = `${current.date.slice(0, 7)}-01`;
  const previousMonthEnd = shiftDate(monthStart, -1);
  const previousMonthStart = `${previousMonthEnd.slice(0, 7)}-01`;
  return {
    key: `${kind}:monthly:${previousMonthStart}:${previousMonthEnd}`,
    start: previousMonthStart,
    end: previousMonthEnd,
  };
}
