"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icons";
import { CustomerPageSkeleton } from "@/components/CustomerPageSkeleton";
import { useCustomer } from "@/components/CustomerProvider";
import { dateTimeLabel, orderTypeLabel, peso, statusLabel } from "@/lib/format";
import { isCustomerHistoryOrder } from "@/lib/orderLifecycle";
import { fetchPortalApi, prefetchPortalRouteData } from "@/lib/portalPrefetch";
import { useRealtimeRefresh } from "@/lib/usePolling";
import type { Order } from "@/lib/types";

type OrdersView = "orders" | "history";

const ordersTabs: { key: OrdersView; label: string }[] = [
  { key: "orders", label: "Orders" },
  { key: "history", label: "History" },
];

export function OrderHistoryClient() {
  const { count, legacyOrderId, ready, table } = useCustomer();
  const cartHref = `/customer/cart?table=${table}`;
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<OrdersView>("orders");
  const [refreshRevision, setRefreshRevision] = useState(0);
  const requestRefresh = useCallback(
    () => setRefreshRevision((revision) => revision + 1),
    []
  );
  useRealtimeRefresh(requestRefresh, ["history", "orders", "payments"]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetchPortalApi(
          "/api/orders/history",
          refreshRevision > 0 ? { cache: "no-store" } : undefined
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not load your order history.");
        }

        if (!Array.isArray(data.orders)) {
          throw new Error("Order history returned an invalid response.");
        }
        const guestOrders = data.orders as Order[];
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
  }, [legacyOrderId, ready, refreshRevision]);

  const visibleOrders = orders.filter(
    (order) =>
      order.status !== "cancelled" &&
      (view === "history"
         ? isCustomerHistoryOrder(order)
         : !isCustomerHistoryOrder(order))
  );
  const tabCounts = {
    orders: orders.filter(
      (order) => order.status !== "cancelled" && !isCustomerHistoryOrder(order)
    ).length,
    history: orders.filter(
      (order) => order.status !== "cancelled" && isCustomerHistoryOrder(order)
    ).length,
  };

  if (loading) {
    return <CustomerPageSkeleton page="orders" />;
  }

  return (
    <div className="order-history-page">
      <div className="order-history-head">
        <h1>Your orders</h1>
        {count > 0 && (
          <Link
            href={cartHref}
            className="btn btn-primary"
            onMouseEnter={() => prefetchPortalRouteData("customer", cartHref)}
            onFocus={() => prefetchPortalRouteData("customer", cartHref)}
            onTouchStart={() => prefetchPortalRouteData("customer", cartHref)}
          >
            View cart · {count} {count === 1 ? "item" : "items"}
          </Link>
        )}
      </div>

      {error && <div className="error-strip">{error}</div>}

      <div className="tabs" role="tablist" aria-label="Your orders">
        {ordersTabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            className={`tab ${view === item.key ? "active" : ""}`}
            onClick={() => setView(item.key)}
          >
            {item.label}
            <span className="tab-count">{tabCounts[item.key]}</span>
          </button>
        ))}
      </div>

      {visibleOrders.length ? (
        <div className="order-history-list">
          {visibleOrders.map((order) => (
            <Link
              className="card order-history-card"
              href={`/customer/status?id=${order.id}&table=${order.table_number}`}
              onMouseEnter={() =>
                prefetchPortalRouteData(
                  "customer",
                  `/customer/status?id=${order.id}&table=${order.table_number}`
                )
              }
              onFocus={() =>
                prefetchPortalRouteData(
                  "customer",
                  `/customer/status?id=${order.id}&table=${order.table_number}`
                )
              }
              onTouchStart={() =>
                prefetchPortalRouteData(
                  "customer",
                  `/customer/status?id=${order.id}&table=${order.table_number}`
                )
              }
              key={order.id}
            >
              <div className="order-history-main">
                <span className="eyebrow">
                  Order #{String(order.order_number ?? order.id).padStart(3, "0")} ·{" "}
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
                  {order.payment_status === "rejected"
                     ? "Payment not confirmed"
                    : order.status === "ready"
                      ? "Serving · awaiting customer"
                      : statusLabel(order.status)}
                </span>
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
          <h2>{view === "orders" ? "No active orders." : "No order history yet."}</h2>
          <p>
            {view === "orders"
              ? "Orders waiting for payment review or preparation will appear here."
              : "Completed and rejected-payment orders will appear here."}
          </p>
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
  const response = await fetchPortalApi(`/api/orders/${id}`, { cache: "no-store" });
  if (response.status === 404) return null;
  const data = await response.json();
  if (!response.ok || !data.order) {
    throw new Error(data.error || "Could not load your saved order.");
  }
  return data.order as Order;
}
