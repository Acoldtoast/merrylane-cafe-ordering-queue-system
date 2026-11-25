/**
 * Service charge percentages are typed by admins and stored in settings as
 * text, so a blank, malformed or out-of-range value must never reach order
 * arithmetic (where NaN would poison a total silently).
 */
export function parseServiceChargePct(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed =
    typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return fallback;
  return Math.round(parsed * 100) / 100;
}

export function calculateServiceCharge(subtotal: number, percentage: number): number {
  return Math.round(subtotal * (percentage / 100) * 100) / 100;
}
