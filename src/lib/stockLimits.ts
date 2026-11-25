export const MAX_STOCK_COUNT = 99;
export const MAX_LOW_STOCK_THRESHOLD = 20;

export function isStockAmount(value: unknown, max: number): boolean {
  if (typeof value === "string" && /^[0-9]{1,2}$/.test(value)) {
    value = Number(value);
  }
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}
