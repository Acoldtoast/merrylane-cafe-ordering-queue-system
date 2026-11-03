import type { OrderItem } from "./types";

/** Parse the JSON snapshot of extras saved with an order line. */
export function parseExtras(raw?: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: { name?: string }) => item?.name)
      .filter((name): name is string => Boolean(name));
  } catch {
    return [];
  }
}

/**
 * Human-readable line details shared by the customer receipt and staff board:
 * variant, sugar level, extras, then any staff-added add-ons.
 *
 * Staff order details render the staff add-ons in their own audit list, so
 * they can opt out here to avoid showing the same topping twice.
 */
export function orderItemMeta(
  item: Pick<
    OrderItem,
    "variant_name" | "sugar_level" | "extras" | "note" | "addons"
  >,
  options: { includeStaffAddons?: boolean } = {}
): string {
  const { includeStaffAddons = true } = options;
  const parts: string[] = [];
  if (item.variant_name) parts.push(item.variant_name);
  if (item.sugar_level) parts.push(`Sugar ${item.sugar_level}`);
  parts.push(...parseExtras(item.extras));
  if (includeStaffAddons) {
    for (const addon of item.addons || []) {
      parts.push(
        `${addon.quantity > 1 ? `${addon.quantity} × ` : ""}${addon.name} (staff)`
      );
    }
  }
  return parts.join(" · ");
}
