"use client";

import { useEffect, useRef, useState } from "react";
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
  const [confirming, setConfirming] = useState(false);
  const keepOrderButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!confirming) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add("no-scroll");
    keepOrderButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirming(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("no-scroll");
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus();
      }
      previousFocusRef.current = null;
    };
  }, [confirming]);

  if (!canCustomerCancelOrder(order)) return null;

  const cancelOrder = async () => {
    if (cancelling) return;

    setConfirming(false);
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
    <>
    <button
      type="button"
      className="btn btn-danger"
      onClick={() => setConfirming(true)}
      disabled={cancelling}
    >
      <Icon name="x" className="icon-sm" />
      {cancelling ? <LoadingDots label="Cancelling" /> : "Cancel order"}
    </button>
    {confirming && (
      <div
        className="feedback-layer tone-warning"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setConfirming(false);
        }}
      >
        <div
          className="feedback-card"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="cancel-order-confirm-title"
          aria-describedby="cancel-order-confirm-message"
          data-tone="warning"
          tabIndex={-1}
        >
          <div className="feedback-medallion" aria-hidden="true">
            <Icon name="alert" size={22} />
          </div>
          <span className="feedback-eyebrow">Please confirm</span>
          <h2 id="cancel-order-confirm-title" className="feedback-title">
            Cancel order #
            {String(order.order_number ?? order.id).padStart(3, "0")}?
          </h2>
          <p id="cancel-order-confirm-message" className="feedback-message">
            This action can&apos;t be undone.
          </p>
          <div className="payment-remove-confirm-actions">
            <button
              ref={keepOrderButtonRef}
              type="button"
              className="btn btn-outline"
              onClick={() => setConfirming(false)}
            >
              Keep order
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void cancelOrder()}
              disabled={cancelling}
            >
              <Icon name="x" className="icon-sm" /> Cancel order
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
