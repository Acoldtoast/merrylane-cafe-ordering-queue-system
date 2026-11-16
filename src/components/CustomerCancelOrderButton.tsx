"use client";

import { useState } from "react";
import type { Order } from "@/lib/types";
import { Icon } from "./Icons";
import { LoadingDots } from "./LoadingDots";
import { useFeedback } from "./Feedback";
import { peso } from "@/lib/format";
import { fetchPortalApi } from "@/lib/portalPrefetch";

export function canCustomerCancelOrder(order: Order) {
  return (
    ["pending", "payment_pending"].includes(order.status) &&
    order.payment_status !== "verified"
  );
}

export function CustomerCancelOrderButton({
  order,
  onCancelled,
}: {
  order: Order;
  onCancelled: (order: Order) => void;
}) {
  const feedback = useFeedback();
  const [cancelling, setCancelling] = useState(false);

  if (!canCustomerCancelOrder(order)) return null;

  const cancelOrder = async () => {
    if (
      cancelling ||
      !window.confirm(
        `Cancel order #${String(order.order_number ?? order.id).padStart(3, "0")}? This cannot be undone.`
      )
    ) {
      return;
    }

    setCancelling(true);
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi(`/api/orders/${order.id}`, {
          method: "DELETE",
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.order) {
          throw new Error(data.error || "Could not cancel this order.");
        }
        return data;
      },
      {
        loading: {
          title: "Cancelling your order…",
          message: `Removing order #${String(order.order_number ?? order.id).padStart(3, "0")}.`,
        },
        success: () => ({
          eyebrow: "Cancelled",
          title: "Your order was cancelled",
          message:
            "Nothing was charged. You can start a new order whenever you're ready.",
          duration: 3200,
          details: [
            { label: "Order", value: `#${String(order.order_number ?? order.id).padStart(3, "0")}` },
            {
              label: "Table",
              value: String(order.table_number).padStart(2, "0"),
            },
            { label: "Total", value: peso(order.total) },
          ],
        }),
      }
    );
    if (result.ok && result.result) onCancelled(result.result.order);
    setCancelling(false);
  };

  return (
    <button
      type="button"
      className="btn btn-danger"
      onClick={cancelOrder}
      disabled={cancelling}
    >
      <Icon name="x" className="icon-sm" />
      {cancelling ? <LoadingDots label="Cancelling" /> : "Cancel order"}
    </button>
  );
}
