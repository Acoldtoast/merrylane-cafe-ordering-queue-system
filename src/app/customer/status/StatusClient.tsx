"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Icon } from "@/components/Icons";
import { LoadingDots } from "@/components/LoadingDots";
import { CustomerPageSkeleton } from "@/components/CustomerPageSkeleton";
import { useFeedback } from "@/components/Feedback";
import { CustomerCancelOrderButton } from "@/components/CustomerCancelOrderButton";
import { useCustomer } from "@/components/CustomerProvider";
import type { Order, Review, WaiterRequest } from "@/lib/types";
import {
  clockTime,
  orderTypeLabel,
  peso,
  smartDateTime,
} from "@/lib/format";
import { orderItemMeta } from "@/lib/orderItems";
import { fetchPortalApi } from "@/lib/portalPrefetch";

const steps = [
  { label: "Order placed", icon: "receipt" as const },
  { label: "Confirmed", icon: "check" as const },
  { label: "Preparing", icon: "coffee" as const },
  { label: "Served", icon: "bag" as const },
];

const stepByStatus: Record<string, number> = {
  pending: 0,
  payment_pending: 0,
  confirmed: 1,
  preparing: 2,
  ready: 3,
  completed: 4,
  cancelled: -1,
};

const subscribeToNothing = () => () => {};
const getHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

export function StatusClient({
  orderId,
  initialTable,
  initialOrder,
  initialReview,
}: {
  orderId: number;
  initialTable: number;
  initialOrder: Order | null;
  initialReview: Review | null;
}) {
  const { setTable, lastOrderId, setLastOrderId, ready } = useCustomer();
  const feedback = useFeedback();
  const [order, setOrder] = useState<Order | null>(initialOrder);
  const [review, setReview] = useState<Review | null>(initialReview);
  const [followUpRequest, setFollowUpRequest] = useState<WaiterRequest | null>(null);
  const [resolvedId, setResolvedId] = useState(
    orderId || initialOrder?.id || lastOrderId || 0
  );
  const [loading, setLoading] = useState(!initialOrder);
  const [error, setError] = useState("");
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const [receiveProgress, setReceiveProgress] = useState(0);
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    getHydratedSnapshot,
    getServerHydratedSnapshot
  );
  const [now, setNow] = useState(0);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    const initialTimer = window.setTimeout(updateNow, 0);
    const interval = window.setInterval(updateNow, 15000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setTable(initialTable);
  }, [initialTable, setTable]);

  const fetchOrder = useCallback(async (id: number) => {
    const response = await fetchPortalApi(`/api/orders/${id}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.order) {
      throw new Error(data.error || "Order not found.");
    }
    setOrder(data.order);
    setReview(data.review || null);
    const requestsResponse = await fetchPortalApi(
      `/api/waiter?table=${data.order.table_number}`,
      { cache: "no-store" }
    );
    const requestsData = await requestsResponse.json();
    if (!requestsResponse.ok || !requestsData.success) {
      throw new Error(requestsData.error || "Unable to check follow-up status.");
    }
    setFollowUpRequest(
      (requestsData.requests || []).find(
        (request: WaiterRequest) =>
          request.order_id === data.order.id &&
          request.request_type === "Order follow-up" &&
          request.status !== "resolved"
      ) || null
    );
  }, []);

  const requestOrderFollowUp = async () => {
    if (!order) return;
    setSendingFollowUp(true);
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi("/api/waiter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            table_number: order.table_number,
            order_id: order.id,
            request_type: "Order follow-up",
            message: `Customer is asking for an update on order #${String(order.order_number ?? order.id).padStart(3, "0")}.`,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not send follow-up request.");
        }
        return data;
      },
      {
        loading: {
          title: "Asking the team…",
          message: `Sending a follow-up for order #${String(order.order_number ?? order.id).padStart(3, "0")}.`,
        },
        success: () => ({
          eyebrow: "Follow-up sent",
          title: "The team has been notified",
          message:
            "Someone will check on your order and update the status here.",
          details: [
            { label: "Order", value: `#${String(order.order_number ?? order.id).padStart(3, "0")}` },
            {
              label: "Table",
              value: String(order.table_number).padStart(2, "0"),
            },
          ],
        }),
      }
    );
    if (result.ok) setFollowUpRequest(result.result.request || null);
    setSendingFollowUp(false);
  };

  const confirmOrderReceived = async () => {
    if (!order || confirmingReceipt) return;
    setConfirmingReceipt(true);
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi(`/api/orders/${order.id}/received`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table_number: order.table_number }),
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.order) {
          throw new Error(data.error || "Could not confirm receipt.");
        }
        return data;
      },
      {
        loading: {
          title: "Confirming your order…",
          message: "Marking it as received and closing this ticket.",
        },
        success: (data) => ({
          eyebrow: "Received",
          title: "Enjoy every sip",
          message:
            "Your order is complete. We'd love to hear how the visit felt.",
          duration: 3400,
          details: [
            { label: "Order", value: `#${String(order.order_number ?? order.id).padStart(3, "0")}` },
            {
              label: "Table",
              value: String(order.table_number).padStart(2, "0"),
            },
            ...(data.order?.total
              ? [{ label: "Total", value: peso(data.order.total) }]
              : []),
          ],
        }),
      }
    );
    if (result.ok && result.result) {
      setOrder(result.result.order);
      setReceiveProgress(100);
    } else {
      setReceiveProgress(0);
    }
    setConfirmingReceipt(false);
  };

  const handleReceiveProgress = (value: number) => {
    setReceiveProgress(value);
    if (value >= 95) void confirmOrderReceived();
  };

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!ready) return;
      try {
        let id = resolvedId || lastOrderId || 0;
        if (!id) {
          const res = await fetchPortalApi("/api/orders/history", {
            cache: "no-store",
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || "Unable to load your latest order.");
          }
          const latest = data.orders?.[0];
          if (!latest) {
            if (!cancelled) {
              setLoading(false);
              setError("No orders yet for this guest.");
            }
            return;
          }
          id = latest.id;
          setResolvedId(id);
          setLastOrderId(id);
        }
        if (!id) return;
        await fetchOrder(id);
        if (!cancelled) setError("");
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load the order.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = window.setInterval(() => {
      // Skip network refreshes while the phone screen is off or another app is
      // in front; resume as soon as the tab becomes visible again.
      if (document.visibilityState === "visible") void load();
    }, 9000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [resolvedId, lastOrderId, initialTable, fetchOrder, setLastOrderId, ready]);

  const currentIndex = order ? stepByStatus[order.status] ?? 0 : 0;
  const queue = order?.queue_number
    ? `A-${String(order.queue_number).padStart(3, "0")}`
    : "";
  const orderCode = `#${String(order?.order_number ?? order?.id ?? 0).padStart(3, "0")}`;
  const readyAt = order?.estimated_ready_at
    ? new Date(order.estimated_ready_at.replace(" ", "T"))
    : null;
  const followUpAvailable =
    order?.status === "preparing" &&
    readyAt !== null &&
    !Number.isNaN(readyAt.getTime()) &&
    readyAt.getTime() <= now;

  const stepState = useMemo(() => {
    return steps.map((step, index) => {
      if (currentIndex === 4) return "done";
      if (index < currentIndex) return "done";
      if (index === currentIndex) return "current";
      return "todo";
    });
  }, [currentIndex]);

  if (loading) {
    return <CustomerPageSkeleton />;
  }

  if (!order) {
    return (
      <div className="state-page">
        <div className="state-card">
          <div className="state-icon">
            <Icon name="receipt" />
          </div>
          <span className="eyebrow" style={{ color: "var(--brown)" }}>
            Order status
          </span>
          <h1 style={{ marginTop: 9 }}>
            {error === "No orders yet for this guest."
              ? "No orders just yet."
              : "We couldn't find that order."}
          </h1>
          <p>
            Place an order from the menu and your queue number and live status
            will appear right here.
          </p>
          <Link
            href="/customer/orders"
            className="btn btn-outline"
            style={{ marginBottom: 9 }}
          >
            <Icon name="chevron-left" className="icon-sm" /> Back to your orders
          </Link>
          <Link href={`/customer/menu?table=${initialTable}`} className="btn btn-primary">
            Browse the menu <Icon name="arrow-right" className="icon-sm" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link href="/customer/orders" className="back-link">
        <Icon name="chevron-left" /> Back to your orders
      </Link>
      <div className="status-head">
        <div>
          <h1>
            {order.cancellation_reason === "unpaid_timeout"
              ? "Order automatically cancelled."
              : order.status === "cancelled"
                ? "Order cancelled."
                : order.status === "ready"
              ? "Your order has been served."
              : order.status === "completed"
                ? "Order received. Thank you."
                : order.status === "preparing"
                  ? "A little patience, a lot of care."
                  : order.status === "confirmed"
                    ? "You're in the queue."
                    : "We have your order."}
          </h1>
        </div>
      </div>

      {order.cancellation_reason === "unpaid_timeout" && (
        <div className="order-closed-banner" role="status" style={{ marginBottom: 16 }}>
          <Icon name="alert" />
          <div>
            <strong>Cash payment was not recorded.</strong>
            <span>
              This order was automatically cancelled after 90 minutes and removed
              from the queue. If you already paid, please speak with a staff member.
            </span>
          </div>
        </div>
      )}

      {order.payment_status === "rejected" && (
        <div className="order-closed-banner" style={{ borderColor: "#e9c6bd", background: "#fdf0ec", color: "#a74e3d" }}>
          <Icon name="alert" />
          <div>
            <strong>We couldn&apos;t verify the payment screenshot.</strong>
            <span>
              Please upload a clearer GCash receipt.{" "}
              <Link
                href={`/customer/payment?id=${order.id}&table=${initialTable}`}
                style={{ textDecoration: "underline" }}
              >
                Upload again
              </Link>
            </span>
          </div>
        </div>
      )}

      {Number(order.balance_due || 0) > 0 && (
        <div className="order-closed-banner" style={{ marginBottom: 16 }}>
          <Icon name="card" />
          <div>
            <strong>Additional balance: {peso(order.balance_due || 0)}</strong>
            <span>
              Staff added items to your order. You can pay this balance at the counter
              or send a separate GCash payment.
              {order.balance_payments?.some((payment) => payment.status === "pending") ? (
                <> Your GCash receipt is waiting for staff review.</>
              ) : (
                <>
                  {" "}
                  <Link
                    href={`/customer/payment?id=${order.id}&table=${initialTable}&balance=1`}
                    style={{ textDecoration: "underline" }}
                  >
                    Pay additional balance with GCash
                  </Link>
                </>
              )}
            </span>
          </div>
        </div>
      )}

      <div className="status-layout">
        <div className="status-main">
          <div className="queue-ticket">
            <div className="queue-ticket-left">
              <div className="eyebrow">
                {order.queue_number ? "Your queue number" : "Your order number"}
              </div>
              <div className="queue-number">
                {order.queue_number ? (
                  <>
                    {queue.slice(0, 2)}
                    <span>{queue.slice(2)}</span>
                  </>
                ) : (
                  <>
                    #
                    <span>{orderCode.slice(1)}</span>
                  </>
                )}
              </div>
              {(order.customer_name || order.queue_number) ? (
                <div className="queue-customer">
                  {order.customer_name ? (
                    <>
                      For <strong>{order.customer_name}</strong>
                    </>
                  ) : null}
                  {order.queue_number ? (
                    <span className="queue-order-ref">
                      Order {orderCode}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <p>
                {order.queue_number
                  ? order.status === "ready"
                    ? "Your order has been served and is waiting for you."
                    : order.status === "completed"
                      ? "You confirmed that you received this order."
                      : "Your order number is ready for when it is served."
                  : "Your number is assigned when the order is confirmed."}
              </p>
            </div>
            <div className="queue-status">
              <small>
                {order.status === "ready"
                  ? "Served · waiting"
                  : order.status === "completed"
                    ? "Received"
                    : order.order_type === "take_out"
                      ? "Take out"
                      : "Dine in"}
              </small>
            </div>
          </div>

          <div className="status-progress card">
            <div className="status-steps">
              {steps.map((step, index) => {
                const state = stepState[index];
                return (
                  <div className={`status-step ${state}`} key={step.label}>
                    <div className="step-dot">
                      {state === "current" ? (
                        <span className="pulse" />
                      ) : (
                        <Icon name={step.icon} />
                      )}
                    </div>
                    <span>
                      {order.status === "completed" && step.label === "Served"
                        ? "Received"
                        : step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {order.status === "ready" && (
            <div className="receive-confirm-card">
              <div>
                <strong>Have you received your order?</strong>
                <span>Swipe to confirm. This will complete and clear the active order.</span>
              </div>
              <label
                className="receive-slider"
                style={{
                  background: `linear-gradient(90deg, var(--tan) ${receiveProgress}%, var(--cream) ${receiveProgress}%)`,
                }}
              >
                <span className="receive-slider-label">Swipe right to confirm you received your order</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={receiveProgress}
                  disabled={confirmingReceipt}
                  aria-label="Swipe right to confirm you received your order"
                  onChange={(event) => handleReceiveProgress(Number(event.target.value))}
                  onPointerUp={() => {
                    if (receiveProgress < 95) setReceiveProgress(0);
                  }}
                />
                <span
                  className="receive-slider-thumb"
                  style={{ left: `calc(${receiveProgress}% - 14px)` }}
                >
                  <Icon name="arrow-right" />
                </span>
                <span className="receive-slider-copy">
                  <Icon name={confirmingReceipt ? "clock" : "arrow-right"} />
                  {confirmingReceipt ? <LoadingDots label="Confirming" /> : "Swipe to confirm received"}
                </span>
              </label>
            </div>
          )}

          <div className="status-actions">
            <Link
              href={`/customer/waiter?table=${initialTable}&order=${order.id}`}
              className="btn btn-outline"
            >
              <Icon name="waiter" className="icon-sm" /> Call waiter
            </Link>
            <CustomerCancelOrderButton
              order={order}
              onCancelled={setOrder}
            />
            {followUpAvailable && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={requestOrderFollowUp}
                disabled={sendingFollowUp || Boolean(followUpRequest)}
              >
                <Icon name="message" className="icon-sm" />
                {sendingFollowUp
                  ? <LoadingDots label="Sending" />
                  : followUpRequest
                    ? followUpRequest.status === "acknowledged"
                      ? "Staff notified"
                      : "Follow-up sent"
                    : "Follow up"}
              </button>
            )}
            {order.status === "completed" && !review && (
              <Link
                href={`/customer/feedback?order=${order.id}&table=${initialTable}`}
                className="btn btn-primary"
              >
                <Icon name="star" className="icon-sm" /> Leave a review
              </Link>
            )}
          </div>

          <div className="card status-detail">
            <div className="status-detail-head">
              <h2>Order details</h2>
              <span className="badge badge-cream">
                {order.items?.length || 0}{" "}
                {order.items?.length === 1 ? "item" : "items"}
              </span>
            </div>
            <div className="summary-items">
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
            </div>
            {order.remarks && (
              <div className="status-note">
                <Icon name="message" />
                <span>
                  <strong>Your note:</strong> {order.remarks}
                </span>
              </div>
            )}
          </div>
        </div>

        <aside className="status-side">
          <div className="card status-order-card">
            <div className="status-order-head">
              <h2>Summary</h2>
              <span className="badge badge-cream">
                {order.payment_method === "gcash" ? "GCash" : "Counter"}
              </span>
            </div>
            <div className="order-meta-grid">
              <div>
                <small>Table</small>
                <strong>{String(order.table_number).padStart(2, "0")}</strong>
              </div>
              <div>
                <small>Placed at</small>
                <strong>
                  {hydrated ? smartDateTime(order.created_at) : "—"}
                </strong>
              </div>
              <div>
                <small>Type</small>
                <strong>{orderTypeLabel(order.order_type)}</strong>
              </div>
              <div>
                <small>Payment</small>
                <strong>
                  {order.status === "cancelled"
                    ? "Cancelled"
                    : order.payment_status === "verified"
                      ? "Verified"
                      : order.payment_status === "rejected"
                        ? "Rejected"
                        : "Pending"}
                </strong>
              </div>
            </div>
            {order.estimated_ready_at &&
              order.status !== "ready" &&
              order.status !== "completed" &&
              order.status !== "cancelled" && (
                <div className="status-confirm-number">
                  <span>Estimated preparation</span>
                  <b>
                    {order.prep_minutes ? `${order.prep_minutes} min` : "In progress"} ·
                    ready around{" "}
                    {hydrated ? clockTime(order.estimated_ready_at) : "—"}
                  </b>
                </div>
              )}
            {order.status === "ready" && (
              <div className="status-confirm-number">
                <span>Ready since</span>
                <b>{hydrated ? clockTime(order.ready_at) : "—"}</b>
              </div>
            )}
            <div className="summary-totals" style={{ marginTop: 0, paddingTop: 0 }}>
              <div className="totals-row">
                <span>Subtotal</span>
                <span>{peso(order.subtotal)}</span>
              </div>
              <div className="totals-row">
                <span>Service charge</span>
                <span>{peso(order.service_charge)}</span>
              </div>
              {Number(order.discount_amount || 0) > 0 && (
                <div className="totals-row payment-customer-discount">
                  <span>Discount</span>
                  <span>−{peso(order.discount_amount || 0)}</span>
                </div>
              )}
              <div className="totals-row total">
                <span>Total</span>
                <span>{peso(order.total)}</span>
              </div>
              {(order.balance_payments || []).map((payment) => (
                <div className="totals-row" key={payment.id}>
                  <span>
                    Added {payment.payment_method === "gcash" ? "GCash" : "counter"}{" "}
                    payment ·{" "}
                    {payment.status === "verified"
                      ? "paid"
                      : payment.status === "pending"
                        ? "under review"
                        : "rejected"}
                  </span>
                  <span>{peso(payment.amount)}</span>
                </div>
              ))}
              {Number(order.balance_due || 0) > 0 && (
                <div className="totals-row total">
                  <span>Balance due</span>
                  <span>{peso(order.balance_due || 0)}</span>
                </div>
              )}
            </div>
            <div className="status-confirm-number">
              <span>Order number</span>
              <b>#{String(order.order_number ?? order.id).padStart(3, "0")}</b>
            </div>
            {review && (
              <div className="status-confirm-number">
                <span>Your rating</span>
                <b>{review.rating} / 5 ★</b>
              </div>
            )}
            <Link
              href={`/customer/menu?table=${initialTable}`}
              className="btn btn-gold btn-block mt-2"
            >
              Order something else <Icon name="plus" className="icon-sm" />
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
