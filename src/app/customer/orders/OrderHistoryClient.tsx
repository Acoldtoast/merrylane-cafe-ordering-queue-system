"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icons";
import { useCustomer } from "@/components/CustomerProvider";
import { dateTimeLabel, orderTypeLabel, peso, statusLabel } from "@/lib/format";
import type { Order } from "@/lib/types";

export function OrderHistoryClient() {
  const { legacyOrderId, ready, table } = useCustomer();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/orders/history", {
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not load your order history.");
        }

        const guestOrders = (data.orders || []) as Order[];
        const legacyOrder =
          legacyOrderId &&
          !guestOrders.some((order) => order.id === legacyOrderId)
            ? await fetchLegacyOrder(legacyOrderId)
            : null;
        const combined = legacyOrder
          ? [...guestOrders, legacyOrder]
          : guestOrders;

        if (!cancelled) {
          setOrders(
            combined.sort(
              (first, second) =>
                new Date(second.created_at.replace(" ", "T")).getTime() -
                new Date(first.created_at.replace(" ", "T")).getTime()
            )
          );
        }
      } catch (loadError: unknown) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load your order history."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [legacyOrderId, ready]);

  if (loading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Finding your orders…
      </div>
    );
  }

  return (
    <div className="order-history-page">
      <div className="order-history-head">
        <span className="eyebrow" style={{ color: "var(--brown)" }}>
          Guest order history
        </span>
        <h1>Your orders</h1>
        <p>Every order from this browser is saved here for you to revisit.</p>
      </div>

      {error && <div className="error-strip">{error}</div>}

      {orders.length ? (
        <div className="order-history-list">
          {orders.map((order) => (
            <Link
              className="card order-history-card"
              href={`/customer/status?id=${order.id}&table=${order.table_number}`}
              key={order.id}
            >
              <div className="order-history-main">
                <span className="eyebrow">
                  Order #{String(order.id).padStart(3, "0")} ·{" "}
                  {orderTypeLabel(order.order_type)}
                </span>
                <strong>{dateTimeLabel(order.created_at)}</strong>
                <span className="order-history-meta">
                  Table {String(order.table_number).padStart(2, "0")} ·{" "}
                  {order.items?.length || 0}{" "}
                  {(order.items?.length || 0) === 1 ? "item" : "items"}
                </span>
              </div>
              <div className="order-history-side">
                <span className="badge badge-cream">
                  {order.cancellation_reason === "unpaid_timeout"
                    ? "Automatically cancelled"
                    : statusLabel(order.status)}
                </span>
                {order.cancellation_reason === "unpaid_timeout" && (
                  <span className="order-history-open">
                    No cash payment recorded within 90 minutes
                  </span>
                )}
                <strong>{peso(order.total)}</strong>
                <span className="order-history-open">
                  View order <Icon name="chevron-right" className="icon-sm" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="state-card order-history-empty">
          <div className="state-icon">
            <Icon name="receipt" />
          </div>
          <h2>No orders just yet.</h2>
          <p>When you place an order from this browser, it will appear here.</p>
          <Link
            href={`/customer/menu?table=${table}`}
            className="btn btn-primary"
          >
            Browse the menu <Icon name="arrow-right" className="icon-sm" />
          </Link>
        </div>
      )}
    </div>
  );
}

async function fetchLegacyOrder(id: number): Promise<Order | null> {
  const response = await fetch(`/api/orders/${id}`, { cache: "no-store" });
  if (response.status === 404) return null;
  const data = await response.json();
  if (!response.ok || !data.order) {
    throw new Error(data.error || "Could not load your saved order.");
  }
  return data.order as Order;
}
