const DAY_MINUTES = 24 * 60;

export const WEEK_DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

export function minutesOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

export function validLastOrder(value: unknown, opens: unknown, closes: unknown): boolean {
  const cutoff = minutesOf(value);
  const start = minutesOf(opens);
  const end = minutesOf(closes);
  if (cutoff === null || start === null || end === null) return false;
  const closesAt = end <= start ? end + DAY_MINUTES : end;
  const cutoffAt = end <= start && cutoff < start ? cutoff + DAY_MINUTES : cutoff;
  return cutoffAt >= start && cutoffAt < closesAt;
}

export function defaultLastOrder(opens: unknown, closes: unknown): string {
  const start = minutesOf(opens);
  const end = minutesOf(closes);
  if (start === null || end === null) return "";
  const closesAt = end <= start ? end + DAY_MINUTES : end;
  const cutoff = Math.max(start, closesAt - 30) % DAY_MINUTES;
  return `${String(Math.floor(cutoff / 60)).padStart(2, "0")}:${String(cutoff % 60).padStart(2, "0")}`;
}

export function weeklyScheduleError(schedule: unknown): string | null {
  if (!Array.isArray(schedule) || schedule.length !== WEEK_DAYS.length) {
    return "Set hours for each day of the week.";
  }
  const days = new Set<string>();
  for (const day of schedule) {
    if (!day || !WEEK_DAYS.includes(day.day) || days.has(day.day) || typeof day.open !== "boolean") {
      return "Set hours for each day of the week.";
    }
    days.add(day.day);
    if (minutesOf(day.start) === null || minutesOf(day.end) === null) {
      return `${day.day}: Enter valid opening and closing times.`;
    }
    if (!validLastOrder(day.last_order, day.start, day.end)) {
      return `${day.day}: Last order must be between opening and closing, before the shop closes.`;
    }
  }
  return null;
}
