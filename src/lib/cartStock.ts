import type { CartItem, MenuItem } from "@/lib/types";

export type StockLimits = Record<number, number | null>;

export type StockAdjustmentReason = "sold_out" | "removed";

export interface StockAdjustment {
  name: string;
  from: number;
  to: number;
  /** Why the line lost portions: sold out, or no longer on the menu. */
  reason: StockAdjustmentReason;
}

export interface StockWarningDetail {
  label: string;
  value: string;
}

/** Where the warning appears: while browsing the cart, or at Place order. */
export type StockWarningStage = "browse" | "checkout";

export interface StockWarningCopy {
  title: string;
  message: string;
}

/** The menu fields stock reconciliation needs, so callers can pass any shape. */
export type MenuStockEntry = Pick<
  MenuItem,
  "id" | "is_active" | "stock_tracking_enabled" | "stock_count" | "stock_status"
>;

/** The cart fields stock reconciliation needs. */
export type CartStockLine = Pick<
  CartItem,
  "key" | "menuItemId" | "name" | "quantity"
>;

interface ApplyStock {
  setQuantity: (key: string, quantity: number) => void;
  removeItem: (key: string) => void;
  setStockLimits: (limits: StockLimits) => void;
}

/**
 * How many of each menu item a cart may hold: 0 when the item is no longer on
 * the menu or has been deactivated, 0 when it is flagged out, its tracked count
 * otherwise, and null when stock is not tracked. Lines whose item is missing
 * from the menu are limited to 0 too, so neither a delisted nor a deactivated
 * item can be ordered.
 */
export function stockLimitsFromMenu(
  menuItems: MenuStockEntry[],
  lines: CartStockLine[]
): StockLimits {
  const limits: StockLimits = {};
  for (const entry of menuItems) {
    limits[entry.id] = !entry.is_active
      ? 0
      : entry.stock_status === "out"
        ? 0
        : entry.stock_tracking_enabled
          ? Math.max(0, entry.stock_count)
          : null;
  }
  const listedIds = new Set(menuItems.map((entry) => entry.id));
  for (const line of lines) {
    if (!listedIds.has(line.menuItemId)) limits[line.menuItemId] = 0;
  }
  return limits;
}

/**
 * Trim a restored or open cart to what the menu can still serve, sharing one
 * item's remaining portions across its several variant lines. Applies the new
 * limits and each trim to the cart, and returns one entry per changed line.
 */
export function reconcileCartStock(
  menuItems: MenuStockEntry[],
  lines: CartStockLine[],
  cart: ApplyStock
): StockAdjustment[] {
  const limits = stockLimitsFromMenu(menuItems, lines);
  cart.setStockLimits(limits);

  const listed = new Map(menuItems.map((entry) => [entry.id, entry]));
  const remaining = new Map<number, number>();
  const adjusted: StockAdjustment[] = [];
  for (const line of lines) {
    const limit = limits[line.menuItemId];
    if (limit === null || limit === undefined) continue;
    const available = remaining.get(line.menuItemId) ?? limit;
    const allowed = Math.min(line.quantity, Math.max(0, available));
    remaining.set(line.menuItemId, Math.max(0, available - allowed));
    if (allowed === line.quantity) continue;

    const entry = listed.get(line.menuItemId);
    adjusted.push({
      name: line.name,
      from: line.quantity,
      to: allowed,
      reason: !entry || !entry.is_active ? "removed" : "sold_out",
    });
    if (allowed === 0) cart.removeItem(line.key);
    else cart.setQuantity(line.key, allowed);
  }
  return adjusted;
}

/**
 * The warning dialog rows that explain which lines were trimmed and why. A line
 * that lost only some portions says how many are left; a line dropped entirely
 * says whether it sold out or left the menu.
 */
export function stockWarningDetails(
  adjusted: StockAdjustment[]
): StockWarningDetail[] {
  return adjusted.map((entry) => ({
    label: entry.name,
    value:
      entry.to > 0
        ? `${entry.from} → ${entry.to} left`
        : entry.reason === "removed"
          ? "No longer on the menu"
          : "Removed · sold out",
  }));
}

/**
 * The warning title and message for the reasons that actually trimmed the cart,
 * so an item dropped from the menu is never blamed on a sell-out.
 */
export function stockWarningCopy(
  adjusted: StockAdjustment[],
  stage: StockWarningStage
): StockWarningCopy {
  const soldOut = adjusted.some((entry) => entry.reason === "sold_out");
  const removed = adjusted.some((entry) => entry.reason === "removed");
  const checkingOut = stage === "checkout";

  if (soldOut && removed) {
    return {
      title: "Some items changed",
      message: checkingOut
        ? "A few portions sold and some items left the menu while you were checking out. We updated your cart — please review it and try again."
        : "Some portions sold and some items left the menu, so we updated your cart. Please review it and try again.",
    };
  }
  if (removed) {
    return {
      title: "Some items left the menu",
      message: checkingOut
        ? "Some items left the menu while you were checking out, so we took them out of your cart. Please review it and try again."
        : "Some items were taken off the menu, so we removed them from your cart. Please review it and try again.",
    };
  }
  return {
    title: "Some items sold out",
    message: checkingOut
      ? "A few portions sold while you were checking out. We updated your cart — please review it and try again."
      : "Some portions sold while you were deciding, so we trimmed your cart to what is still available.",
  };
}
