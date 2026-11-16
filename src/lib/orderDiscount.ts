export type DiscountType = "staff" | "senior" | "pwd" | "other";

export interface DiscountRecipient {
  type: DiscountType;
  id_number: string;
  name: string;
}

export interface OrderDiscount extends DiscountRecipient {
  meal_discount: number;
  drink_discount: number;
  discount_amount: number;
}

export interface DiscountableOrderItem {
  id: number;
  quantity: number;
  unit_price: number;
  category_name: string;
}

const DISCOUNT_RATE = 0.2;
const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

export function calculateOrderDiscounts(
  items: DiscountableOrderItem[],
  recipients: DiscountRecipient[]
): OrderDiscount[] {
  const candidates = {
    meal: [] as { id: number; unitPrice: number; remaining: number }[],
    drink: [] as { id: number; unitPrice: number; remaining: number }[],
  };

  for (const item of items) {
    const category = item.category_name.trim().toLowerCase();
    const kind = category === "coffee" || category === "non-coffee" ? "drink" : "meal";
    candidates[kind].push({
      id: item.id,
      unitPrice: Number(item.unit_price),
      remaining: Number(item.quantity),
    });
  }
  candidates.meal.sort((a, b) => b.unitPrice - a.unitPrice || a.id - b.id);
  candidates.drink.sort((a, b) => b.unitPrice - a.unitPrice || a.id - b.id);

  const takeOne = (kind: "meal" | "drink") => {
    const item = candidates[kind].find((candidate) => candidate.remaining > 0);
    if (!item) return 0;
    item.remaining -= 1;
    return roundMoney(item.unitPrice * DISCOUNT_RATE);
  };

  return recipients.map((recipient) => {
    const mealDiscount = takeOne("meal");
    const drinkDiscount = takeOne("drink");
    return {
      ...recipient,
      meal_discount: mealDiscount,
      drink_discount: drinkDiscount,
      discount_amount: roundMoney(mealDiscount + drinkDiscount),
    };
  });
}
