export type VatMode = "none" | "add" | "included";

export interface VatConfig {
  mode: VatMode;
  rate: number;
}

export function parseVatRate(value: unknown, fallback = 0): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value.trim()))) {
    return fallback;
  }
  const rate = Number(value);
  const hundredths = Math.round(rate * 100);
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 &&
    Math.abs(rate * 100 - hundredths) < 1e-8
    ? hundredths / 100
    : fallback;
}

/**
 * `vat_mode` is the source of truth. Existing databases stored the old
 * "add VAT" toggle as vat_inclusive, so that is still honoured until an admin
 * saves a mode.
 */
export function vatConfig(values: Record<string, string | undefined>): VatConfig {
  const rate = parseVatRate(values.vat_rate_pct);
  const stored = values.vat_mode;
  const mode: VatMode =
    stored === "add" || stored === "included" || stored === "none"
      ? stored
      : values.vat_inclusive === "true" && rate > 0
        ? "add"
        : "none";
  return { mode, rate: mode === "none" ? 0 : rate };
}

/** The rate to add to menu prices: 0 unless the owner chose "add VAT". */
export function menuVatRate(values: Record<string, string | undefined>): number {
  const config = vatConfig(values);
  return config.mode === "add" ? config.rate : 0;
}

export function priceWithVat(price: number, rate: number): number {
  if (rate <= 0) return price;
  const cents = Math.round(price * 100);
  const rateHundredths = Math.round(rate * 100);
  return Math.round(cents * (10_000 + rateHundredths) / 10_000 / 100);
}

/** Portion of a VAT-inclusive amount that is VAT, rounded to centavos. */
export function vatFromInclusive(total: number, rate: number): number {
  if (rate <= 0) return 0;
  const cents = Math.round(total * 100);
  const rateHundredths = Math.round(rate * 100);
  return Math.round(cents * rateHundredths / (10_000 + rateHundredths)) / 100;
}

export interface FinalTotals {
  total: number;
  vat_amount: number;
  rounding_adjustment: number;
  vat_rate_pct: number;
  vat_mode: VatMode;
}

/**
 * The amount due is rounded once, after VAT, service charge and discounts.
 * VAT is then taken from that rounded amount so collected money reconciles
 * with the recorded VAT and net sales.
 */
export function finalizeTotals(exactTotal: number, config: VatConfig): FinalTotals {
  const total = Math.round(exactTotal);
  return {
    total,
    vat_amount: vatFromInclusive(total, config.rate),
    rounding_adjustment: Math.round((total - exactTotal) * 100) / 100,
    vat_rate_pct: config.rate,
    vat_mode: config.mode,
  };
}

export function orderVatConfig(order: {
  vat_mode?: string | null;
  vat_rate_pct?: number | null;
}): VatConfig | null {
  if (order.vat_mode !== "add" && order.vat_mode !== "included" && order.vat_mode !== "none") {
    return null;
  }
  return { mode: order.vat_mode, rate: parseVatRate(order.vat_rate_pct) };
}
