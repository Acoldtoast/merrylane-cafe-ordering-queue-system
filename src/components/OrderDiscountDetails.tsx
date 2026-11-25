"use client";

import type { OrderDiscount } from "@/lib/orderDiscount";
import { peso } from "@/lib/format";

const discountTypeLabels: Record<OrderDiscount["type"], string> = {
  staff: "Staff",
  senior: "Senior citizen",
  pwd: "PWD",
  other: "Other ID",
};

export function OrderDiscountDetails({
  discounts = [],
  discountAmount = 0,
}: {
  discounts?: OrderDiscount[];
  discountAmount?: number;
}) {
  const total = Number(discountAmount) || 0;
  if (total <= 0 && discounts.length === 0) return null;

  return (
    <div className="order-discount-details">
      {total > 0 && (
        <div className="totals-row payment-customer-discount">
          <strong>Discount</strong>
          <strong>−{peso(total)}</strong>
        </div>
      )}
      {discounts.map((discount, index) => {
        const allocations = [
          Number(discount.meal_discount) > 0
            ? `Meal −${peso(discount.meal_discount)}`
            : null,
          Number(discount.drink_discount) > 0
            ? `Drink −${peso(discount.drink_discount)}`
            : null,
        ].filter((allocation): allocation is string => allocation !== null);

        return (
          <div
            className="order-discount-recipient"
            key={`${discount.id_number}-${index}`}
          >
            <div className="order-discount-recipient-heading">
              <strong>
                {discountTypeLabels[discount.type]} · {discount.name}
              </strong>
              <span>
                {discount.type === "staff"
                  ? `Staff · ${discount.id_number}`
                  : `ID ${discount.id_number}`}
              </span>
            </div>
            <span>
              {allocations.length ? allocations.join(" · ") : "No qualifying items"}{" "}
              · Total −{peso(discount.discount_amount)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
