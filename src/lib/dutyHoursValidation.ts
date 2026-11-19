/** Validates optional same-day duty ranges without changing stored schedules. */
export function validDutyHours(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value !== "string") return false;
  const match = /^\s*(1[0-2]|[1-9]):([0-5]\d)\s*(AM|PM)\s*[–-]\s*(1[0-2]|[1-9]):([0-5]\d)\s*(AM|PM)\s*$/i.exec(value);
  if (!match) return false;
  const minutes = (hour: string, minute: string, period: string) =>
    (Number(hour) % 12 + (period.toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(minute);
  return minutes(match[4], match[5], match[6]) > minutes(match[1], match[2], match[3]);
}
