"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icons";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import type { Order } from "@/lib/types";
import { dateTimeLabel, peso } from "@/lib/format";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { usePolling } from "@/lib/usePolling";

export function StaffReceiptsClient() {
  const searchParams = useSearchParams();
  const date = searchParams.get("date") || "";
  const [orders, setOrders] = useState<Order[]>([]);
  const [autoCancelledOrders, setAutoCancelledOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [serviceDate, setServiceDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetchPortalApi(
        `/api/orders?recent_verified=1&${
          date ? `date=${encodeURIComponent(date)}` : "business_day=1"
        }&page=${page}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to load verified payments.");
      }
      setOrders(data.orders || []);
      setAutoCancelledOrders(data.autoCancelledOrders || []);
      setTotal(Number(data.total) || 0);
      setServiceDate(data.date || "");
      setError("");
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load verified payments."
      );
    } finally {
      setLoading(false);
    }
  }, [date, page]);

  const mountedOnce = useRef(false);
  useEffect(() => {
    if (!mountedOnce.current) {
      mountedOnce.current = true;
      return;
    }
    void load();
  }, [load]);

  usePolling(load, 12000, { resources: ["orders", "payments", "sales"] });

  useEffect(() => {
    if (loading || window.location.hash !== "#auto-cancelled") return;
    document.getElementById("auto-cancelled")?.scrollIntoView({ block: "start" });
  }, [autoCancelledOrders.length, loading]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <PortalPageSkeleton area="staff" />;

  return (
    <>
      {error && <div className="error-strip" style={{ marginBottom: 13 }}>{error}</div>}
      <div className="section-bar">
        <p>
          {serviceDate
            ? `Payments confirmed on ${serviceDate}.`
            : "Payments confirmed today."}
        </p>
        <div className="section-bar-tools">
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <Icon
              name="refresh"
              className={`icon-sm${refreshing ? " payment-refresh-icon" : ""}`}
            />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
          <Link href="/staff/sales" className="btn btn-soft btn-sm">
            History in Sales <Icon name="arrow-right" className="icon-sm" />
          </Link>
        </div>
      </div>
      <div className="panel">
        <div className="panel-body tight">
          {orders.length === 0 ? (
            <div className="empty-panel" style={{ border: 0 }}>
              No payments verified today yet.
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table data-table-stack">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Table</th>
                    <th>Payment</th>
                    <th>Paid at</th>
                    <th>Amount</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const paidAt = order.confirmed_at || order.updated_at;
                    const paidDate = paidAt.slice(0, 10);
                    return (
                      <tr key={order.id}>
                        <td data-label="">
                          <strong>
                            #{String(order.order_number ?? order.id).padStart(3, "0")}
                          </strong>
                        </td>
                        <td data-label="Customer">{order.customer_name || "Guest"}</td>
                        <td data-label="Table">
                          {String(order.table_number).padStart(2, "0")}
                        </td>
                        <td data-label="Payment">
                          {order.payment_method === "gcash" ? "GCash" : "Cash / counter"}
                        </td>
                        <td data-label="Paid at">{dateTimeLabel(paidAt)}</td>
                        <td data-label="Amount">{peso(order.payment_amount ?? order.total)}</td>
                        <td data-label="Details">
                          <div style={{ display: "grid", gap: 3 }}>
                            {order.payment_method === "counter" &&
                              order.cash_received !== null &&
                              order.cash_received !== undefined && (
                                <span>
                                  Received {peso(order.cash_received)} · change{" "}
                                  {peso(order.change_given || 0)}
                                </span>
                              )}
                            <Link
                              className="text-link"
                              href={`/staff/sales?date=${paidDate}&transaction_id=order-${order.id}`}
                            >
                              View order
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {total > 10 && (
            <div className="flex-between" style={{ marginTop: 14 }}>
              <span className="payment-review-counts">
                Showing {(page - 1) * 10 + (orders.length ? 1 : 0)}–
                {Math.min(page * 10, total)} of {total}
              </span>
              <div className="payment-review-heading-actions">
                <button
                  type="button"
                  className="btn btn-soft btn-sm"
                  disabled={page === 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <Icon name="chevron-left" className="icon-sm" /> Previous
                </button>
                <button
                  type="button"
                  className="btn btn-soft btn-sm"
                  disabled={page * 10 >= total}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next <Icon name="chevron-right" className="icon-sm" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {autoCancelledOrders.length > 0 && (
        <section
          className="daily-sales-method"
          id="auto-cancelled"
          style={{ marginTop: 14 }}
        >
          <header className="daily-sales-method-head">
            <div>
              <span className="eyebrow">Automatically cancelled unpaid orders</span>
              <strong>Not verified and not included in sales</strong>
            </div>
            <b>{autoCancelledOrders.length}</b>
          </header>
          <div className="data-table-wrap">
            <table className="data-table daily-sales-table data-table-stack">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Cancelled at</th>
                  <th>Table</th>
                  <th>Customer</th>
                  <th>Payment method</th>
                  <th>Cancellation details</th>
                  <th>Order amount</th>
                </tr>
              </thead>
              <tbody>
                {autoCancelledOrders.map((order) => (
                  <tr key={order.id}>
                    <td data-label="Order">
                      <strong>
                        #{String(order.order_number ?? order.id).padStart(3, "0")}
                      </strong>
                    </td>
                    <td data-label="Cancelled at">
                      {dateTimeLabel(order.cancelled_at || "")}
                    </td>
                    <td data-label="Table">{String(order.table_number).padStart(2, "0")}</td>
                    <td data-label="Customer">{order.customer_name || "Guest"}</td>
                    <td data-label="Payment method">Cash / counter</td>
                    <td data-label="Cancellation details">
                      No cash payment recorded within 90 minutes; automatically removed from the queue.
                    </td>
                    <td data-label="Order amount">{peso(order.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
