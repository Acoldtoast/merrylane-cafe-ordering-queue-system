export const CUSTOMER_ITEM_LIMIT = 20;
export const CUSTOMER_ITEM_LIMIT_MESSAGE = `Limit: ${CUSTOMER_ITEM_LIMIT} per menu item per order.`;

export function remainingCustomerQuantity(stock: number | null | undefined, inCart: number) {
  return Math.max(0, Math.min(CUSTOMER_ITEM_LIMIT, stock ?? CUSTOMER_ITEM_LIMIT) - inCart);
}

export function limitSavedCart<T extends { menuItemId: number; quantity: number }>(items: T[]): T[] {
  const counts = new Map<number, number>();
  return items.flatMap((item) => {
    if (!item || !Number.isSafeInteger(item.quantity) || item.quantity < 1) return [];
    const count = counts.get(item.menuItemId) ?? 0;
    const quantity = Math.min(item.quantity, remainingCustomerQuantity(null, count));
    if (!quantity) return [];
    counts.set(item.menuItemId, count + quantity);
    return [quantity === item.quantity ? item : { ...item, quantity }];
  });
}
