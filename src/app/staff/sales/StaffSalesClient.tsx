"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { staffNav } from "@/components/portalNav";
import { Icon } from "@/components/Icons";
import { OrderDiscountDetails } from "@/components/OrderDiscountDetails";
import { SkeletonLine, SkeletonPanel } from "@/components/PortalSkeletonPrimitives";
import type {
  Order,
  OrderItem,
  RejectedPayment,
  SalesTransaction,
} from "@/lib/types";
import { dateTimeLabel, orderTypeLabel, peso, statusLabel } from "@/lib/format";
import { orderItemMeta } from "@/lib/orderItems";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { useRealtimeRefresh } from "@/lib/usePolling";

function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function displayDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-PH", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function todayInManila() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

export function StaffSalesClient({
  initialDate,
}: {
  initialDate: string;
}) {
  const [date, setDate] = useState(initialDate);
  const [today] = useState(todayInManila);
  const [transactions, setTransactions] = useState<SalesTransaction[]>([]);
  const [cancelledOrders, setCancelledOrders] = useState<Order[]>([]);
  const [rejectedPayments, setRejectedPayments] = useState<RejectedPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<SalesTransaction | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const requestId = useRef(0);
  const initialTransaction = useRef<string | null>(null);
  const openedInitialTransaction = useRef(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requestedDate = query.get("date");
    const requestedTransaction = query.get("transaction_id");
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate <= today) {
      setDate(requestedDate);
    }
    initialTransaction.current = requestedTransaction;
  }, [today]);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const response = await fetchPortalApi(
        `/api/staff/sales?date=${encodeURIComponent(date)}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to load sales.");
      }
      if (currentRequest === requestId.current) {
        setTransactions(data.transactions || []);
        setCancelledOrders(data.cancelledOrders || []);
        setRejectedPayments(data.rejectedPayments || []);
        setError("");
      }
    } catch (cause: unknown) {
      if (currentRequest === requestId.current) {
        setError(
          cause instanceof Error ? cause.message : "Unable to load sales."
        );
        setTransactions([]);
        setCancelledOrders([]);
        setRejectedPayments([]);
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtimeRefresh(load, ["orders", "payments", "sales"]);

  const openDetails = useCallback(async (transaction: SalesTransaction) => {
    setSelected(transaction);
    setOrder(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const response = await fetchPortalApi(
        `/api/staff/sales?date=${encodeURIComponent(date)}&transaction_id=${encodeURIComponent(transaction.transaction_id)}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to load order details.");
      }
      setSelected(data.transaction);
      setOrder(data.order);
    } catch (cause: unknown) {
      setDetailError(
        cause instanceof Error ? cause.message : "Unable to load order details."
      );
    } finally {
      setDetailLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const requestedId = initialTransaction.current;
    if (
      !loading &&
      !error &&
      requestedId &&
      !openedInitialTransaction.current
    ) {
      openedInitialTransaction.current = true;
      const match = transactions.find(
        (transaction) => transaction.transaction_id === requestedId
      );
      if (match) void openDetails(match);
      else setError("That payment could not be found in the selected day’s history.");
    }
  }, [error, loading, openDetails, transactions]);

  const changeDate = (nextDate: string) => {
    setDate(nextDate);
    setTransactions([]);
    setSelected(null);
    setOrder(null);
    setError("");
    setLoading(true);
    openedInitialTransaction.current = true;
    window.history.replaceState(
      null,
      "",
      `/staff/sales?date=${encodeURIComponent(nextDate)}`
    );
  };

  const cash = transactions.filter((entry) => entry.payment_method !== "gcash");
  const gcash = transactions.filter((entry) => entry.payment_method === "gcash");
  const cashTotal = cash.reduce((total, entry) => total + Number(entry.amount), 0);
  const gcashTotal = gcash.reduce((total, entry) => total + Number(entry.amount), 0);

  const renderTransactions = (
    title: string,
    method: "cash" | "gcash",
    entries: SalesTransaction[]
  ) => (
    <section className={`daily-sales-method ${method}`}>
      <header className="daily-sales-method-head">
        <div>
          <span className="eyebrow">{title}</span>
          <strong>{entries.length} payment{entries.length === 1 ? "" : "s"}</strong>
        </div>
        <b>{peso(entries.reduce((sum, entry) => sum + Number(entry.amount), 0))}</b>
      </header>
      {entries.length === 0 ? (
        <div className="daily-sales-empty">No {title.toLowerCase()} payments for this day.</div>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table daily-sales-table data-table-stack">
            <thead>
              <tr>
                <th>Order</th>
                <th>Paid at</th>
                <th>Table</th>
                <th>Customer</th>
                <th>{method === "gcash" ? "Reference" : "Payment"}</th>
                <th>Amount</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.transaction_id}>
                  <td data-label="">
                    <strong>
                      #{String(entry.order_number ?? entry.order_id).padStart(3, "0")}
                    </strong>
                    {entry.transaction_type === "additional" && (
                      <small className="daily-sales-additional">Additional payment</small>
                    )}
                  </td>
                  <td data-label="Paid at">{dateTimeLabel(entry.paid_at)}</td>
                  <td data-label="Table">{String(entry.table_number).padStart(2, "0")}</td>
                  <td data-label="Customer">{entry.customer_name || "Guest"}</td>
                  <td data-label={method === "gcash" ? "Reference" : "Payment"}>
                    {method === "gcash" ? entry.payment_reference || "—" : "Cash / counter"}
                  </td>
                  <td data-label="Amount"><strong>{peso(entry.amount)}</strong></td>
                  <td data-label="Details">
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => void openDetails(entry)}
                    >
                      View details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  return (
    <>
      <div className="section-bar daily-sales-heading section-bar-actions-only">
        <div className="daily-sales-date-controls">
          <button
            type="button"
            className="btn btn-soft btn-sm"
            aria-label="View previous day"
            onClick={() => changeDate(shiftDate(date, -1))}
          >
            <Icon name="chevron-left" />
          </button>
          <label className="daily-sales-date">
            <span className="sr-only">Sales date</span>
            <input
              type="date"
              max={today}
              value={date}
              onChange={(event) => {
                if (event.target.value && event.target.value <= today) {
                  changeDate(event.target.value);
                }
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            aria-label="View next day"
            disabled={date >= today}
            onClick={() => changeDate(shiftDate(date, 1))}
          >
            <Icon name="chevron-right" />
          </button>
          {date !== today && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => changeDate(today)}
            >
              Today
            </button>
          )}
        </div>
      </div>
      <div className="daily-sales-date-label">{displayDate(date)}</div>
      {error && <div className="error-strip" role="alert">{error}</div>}
      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading daily sales">
          <div className="daily-sales-totals portal-skeleton-sales-totals" aria-hidden="true">
            {[1, 2, 3].map((total) => (
              <div className="daily-sales-total" key={total}>
                <SkeletonLine size="short" />
                <SkeletonLine size="value" />
                <SkeletonLine size="medium" />
              </div>
            ))}
          </div>
          <div className="daily-sales-lists portal-skeleton-sales-lists" aria-hidden="true">
            <SkeletonPanel rows={5} />
            <SkeletonPanel rows={5} />
          </div>
          <SkeletonPanel rows={4} />
        </div>
      ) : (
        <>
          <div className="daily-sales-totals">
            <div className="daily-sales-total cash">
              <span>Cash / counter</span>
              <strong>{peso(cashTotal)}</strong>
              <small>{cash.length} payment{cash.length === 1 ? "" : "s"}</small>
            </div>
            <div className="daily-sales-total gcash">
              <span>GCash</span>
              <strong>{peso(gcashTotal)}</strong>
              <small>{gcash.length} payment{gcash.length === 1 ? "" : "s"}</small>
            </div>
            <div className="daily-sales-total all">
              <span>Total sales</span>
              <strong>{peso(cashTotal + gcashTotal)}</strong>
              <small>{transactions.length} recorded payment{transactions.length === 1 ? "" : "s"}</small>
            </div>
          </div>
          <div className="daily-sales-lists">
            {renderTransactions("Cash / counter", "cash", cash)}
            {renderTransactions("GCash", "gcash", gcash)}
          </div>
          <section className="daily-sales-method">
            <header className="daily-sales-method-head">
              <div>
                <span className="eyebrow">Cancelled orders</span>
                <strong>Not included in sales totals</strong>
              </div>
              <b>{cancelledOrders.length}</b>
            </header>
            {cancelledOrders.length === 0 ? (
              <div className="daily-sales-empty">No cancelled orders for this day.</div>
            ) : (
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
                    {cancelledOrders.map((cancelledOrder) => (
                      <tr key={cancelledOrder.id}>
                        <td data-label=""><strong>#{String(cancelledOrder.order_number ?? cancelledOrder.id).padStart(3, "0")}</strong></td>
                        <td data-label="Cancelled at">{dateTimeLabel(cancelledOrder.cancelled_at || "")}</td>
                        <td data-label="Table">{String(cancelledOrder.table_number).padStart(2, "0")}</td>
                        <td data-label="Customer">{cancelledOrder.customer_name || "Guest"}</td>
                        <td data-label="Payment">
                          {cancelledOrder.payment_method === "gcash"
                            ? "GCash"
                            : "Cash / counter"}
                        </td>
                        <td data-label="Cancellation details">
                          {cancelledOrder.cancellation_reason === "unpaid_timeout"
                            ? "Automatically cancelled: no cash payment recorded within 90 minutes"
                            : "Cancelled before payment"}
                        </td>
                        <td data-label="Amount">{peso(cancelledOrder.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="daily-sales-method">
            <header className="daily-sales-method-head">
              <div>
                <span className="eyebrow">Rejected payments</span>
                <strong>Rejected proof history · not included in sales totals</strong>
              </div>
              <b>{rejectedPayments.length}</b>
            </header>
            {rejectedPayments.length === 0 ? (
              <div className="daily-sales-empty">
                No rejected payments for this day.
              </div>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table daily-sales-table data-table-stack">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Rejected at</th>
                      <th>Table</th>
                      <th>Customer</th>
                      <th>Reference</th>
                      <th>Rejected by</th>
                      <th>Amount</th>
                      <th>Proof</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejectedPayments.map((rejection) => {
                      const proofHref =
                        rejection.proof_type === "inline"
                          ? `/api/staff/sales/rejected-proof/${rejection.rejection_id}`
                          : rejection.external_proof_url;
                      return (
                        <tr key={rejection.rejection_id}>
                          <td data-label="">
                            <strong>
                              #{String(rejection.order_number).padStart(3, "0")}
                            </strong>
                          </td>
                          <td data-label="Rejected at">
                            {dateTimeLabel(rejection.rejected_at)}
                          </td>
                          <td data-label="Table">
                            {String(rejection.table_number).padStart(2, "0")}
                          </td>
                          <td data-label="Customer">
                            {rejection.customer_name || "Guest"}
                          </td>
                          <td data-label="Reference">
                            {rejection.payment_reference || "—"}
                          </td>
                          <td data-label="Rejected by">
                            {rejection.rejected_by || "Not recorded"}
                          </td>
                          <td data-label="Amount">
                            {peso(rejection.amount)}
                          </td>
                          <td data-label="Proof">
                            {proofHref ? (
                              <a
                                className="text-link"
                                href={proofHref}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View proof
                              </a>
                            ) : (
                              "No proof uploaded"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {selected && (
        <div className="modal-backdrop">
          <section
            className="modal payment-history-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-history-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-head">
              <div>
                <span className="eyebrow">Verified payment · {displayDate(date)}</span>
                <h2 id="payment-history-detail-title">
                  Order #{String(selected.order_number ?? selected.order_id).padStart(3, "0")}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close payment details"
                onClick={() => {
                  setSelected(null);
                  setOrder(null);
                }}
              >
                <Icon name="x" />
              </button>
            </header>
            {detailError && <div className="error-strip" role="alert">{detailError}</div>}
            {detailLoading ? (
              <div className="daily-sales-loading" role="status">
                <span className="spinner" /> Loading order details…
              </div>
            ) : order ? (
              <div className="modal-body payment-history-detail">
                <div className="payment-history-facts">
                  <div><span>Customer</span><strong>{order.customer_name || "Guest"}</strong></div>
                  <div><span>Table</span><strong>{String(order.table_number).padStart(2, "0")}</strong></div>
                  <div><span>Paid at</span><strong>{dateTimeLabel(selected.paid_at)}</strong></div>
                  <div><span>Order type</span><strong>{orderTypeLabel(order.order_type)}</strong></div>
                  <div><span>Order status</span><strong>{statusLabel(order.status)}</strong></div>
                  <div><span>Payment</span><strong>{selected.payment_method === "gcash" ? "GCash" : "Cash / counter"}</strong></div>
                  <div><span>{selected.transaction_type === "additional" ? "Additional payment" : "Verified amount"}</span><strong>{peso(selected.amount)}</strong></div>
                  <div><span>Handled by</span><strong>{selected.handled_by || "Not recorded"}</strong></div>
                  {selected.payment_method === "gcash" && (
                    <div className="payment-history-reference">
                      <span>GCash reference</span>
                      <strong>{selected.payment_reference || "Not provided"}</strong>
                    </div>
                  )}
                  {selected.transaction_type === "additional" && (
                    <div className="payment-history-reference">
                      <span>Original order total</span>
                      <strong>{peso(order.total)}</strong>
                    </div>
                  )}
                </div>
                <div className="section-bar">
                  <div>
                    <h3>Order items</h3>
                    <p>{order.items?.length || 0} line items</p>
                  </div>
                </div>
                <div className="payment-history-items">
                  {(order.items || []).map((item: OrderItem) => (
                    <div className="payment-history-item" key={item.id}>
                      <div>
                        <strong>{item.quantity} × {item.name}</strong>
                        {orderItemMeta(item) && <small>{orderItemMeta(item)}</small>}
                        {item.note && <small>Note: {item.note}</small>}
                      </div>
                      <b>
                        {peso(
                          item.price_at_time * item.quantity +
                            (item.addons || []).reduce(
                              (sum, addon) =>
                                sum + addon.price_modifier * addon.quantity,
                              0
                            )
                        )}
                      </b>
                    </div>
                  ))}
                </div>
                <OrderDiscountDetails
                  discounts={order.discounts}
                  discountAmount={order.discount_amount}
                />
                <div className="payment-history-total">
                  <span>Order total</span><strong>{peso(order.total)}</strong>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </>
  );
}
