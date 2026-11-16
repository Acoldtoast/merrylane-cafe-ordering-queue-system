"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icons";
import { CustomerPageSkeleton } from "@/components/CustomerPageSkeleton";
import { useCustomer } from "@/components/CustomerProvider";
import type { Order } from "@/lib/types";
import { peso, orderTypeLabel } from "@/lib/format";
import { orderItemMeta } from "@/lib/orderItems";
import { fetchPortalApi } from "@/lib/portalPrefetch";

export function ConfirmClient({
  orderId,
  initialTable,
}: {
  orderId: number;
  initialTable: number;
}) {
  const { setTable } = useCustomer();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setTable(initialTable);
  }, [initialTable, setTable]);

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    fetchPortalApi(`/api/orders/${orderId}`)
      .then((res) => res.json())
      .then((data) => setOrder(data.order || null))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) {
    return <CustomerPageSkeleton />;
  }

  if (!order) {
    return (
      <div className="state-page">
        <div className="state-card">
          <div className="state-icon">
            <Icon name="alert" />
          </div>
          <h1>Order not found.</h1>
          <p>Please ask a staff member for help with your order.</p>
          <Link href={`/customer/menu?table=${initialTable}`} className="btn btn-primary">
            Back to menu
          </Link>
        </div>
      </div>
    );
  }

  const gcash = order.payment_method === "gcash";

  return (
    <div className="centered-narrow">
      <div className="confirm-card">
        <div className="hourglass-illustration">
          <Icon name={gcash ? "clock" : "check-circle"} />
        </div>
        <span className="eyebrow">
          {gcash ? "Payment verification" : "Order received"}
        </span>
        <h1>
          {gcash ? (
            <>We&apos;re checking your payment.</>
          ) : (
            <>We&apos;re getting it started.</>
          )}
        </h1>
        <p>
          {gcash
            ? "Our team has your receipt. Your order will move to the queue once the payment is confirmed."
            : "Please pay at the counter to confirm your queue number."}
        </p>

        <div className="confirm-summary">
          <div className="confirm-line">
            <span>Order</span>
            <strong>#{String(order.order_number ?? order.id).padStart(3, "0")}</strong>
          </div>
          <div className="confirm-line">
            <span>Table · Type</span>
            <strong>
              {String(order.table_number).padStart(2, "0")} · {orderTypeLabel(order.order_type)}
            </strong>
          </div>
          <div className="confirm-line">
            <span>Payment</span>
            <strong>{gcash ? "GCash" : "At counter"}</strong>
          </div>
          <div className="divider" style={{ margin: "9px 0" }} />
          {order.items?.map((item) => (
            <div className="summary-item" key={item.id}>
              <div className="summary-item-main">
                <div className="summary-item-name">
                  {item.quantity} × {item.name}
                </div>
                <div className="summary-item-meta">
                  {orderItemMeta(item) || "Regular"}
                </div>
              </div>
              <div className="summary-item-price">
                {peso(item.price_at_time * item.quantity)}
              </div>
            </div>
          ))}
          <div className="totals-row total" style={{ marginTop: 6 }}>
            <span>Total</span>
            <span>{peso(order.total)}</span>
          </div>
        </div>

        <div className="payment-note" style={{ textAlign: "left" }}>
          <Icon name="info" />
          <span>
            {gcash
              ? "Staff usually verify GCash receipts within 2–5 minutes. Keep this page handy."
              : "Cash or card payments are accepted at the counter. Your queue number appears once payment is confirmed."}
          </span>
        </div>

        <div className="confirm-footer">
          <Link
            href={`/customer/status?id=${order.id}&table=${initialTable}`}
            className="btn btn-primary btn-block"
          >
            View order status <Icon name="arrow-right" className="icon-sm" />
          </Link>
          <Link
            href={`/customer/waiter?table=${initialTable}&order=${order.id}`}
            className="btn btn-outline btn-block btn-sm"
          >
            <Icon name="waiter" className="icon-sm" /> Call a waiter
          </Link>
        </div>
      </div>
    </div>
  );
}
