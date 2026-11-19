"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icons";
import { useFeedback } from "@/components/Feedback";
import { useCustomer } from "@/components/CustomerProvider";
import { CustomerPageSkeleton } from "@/components/CustomerPageSkeleton";
import { peso } from "@/lib/format";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import type { CartItem, MenuItem } from "@/lib/types";

const GCASH_CHECKOUT_DRAFT_KEY = "merrylane.gcash-checkout.v1";

export function CartClient({ initialTable }: { initialTable: number }) {
  const router = useRouter();
  const feedback = useFeedback();
  const {
    table,
    setTable,
    items,
    count,
    subtotal,
    orderType,
    setOrderType,
    clearCart,
    setLastOrderId,
    removeItem,
    setQuantity,
    setStockLimits,
    ready,
  } = useCustomer();

  const [paymentMethod, setPaymentMethod] = useState<"gcash" | "counter">("counter");
  const [customerName, setCustomerName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitPhase, setSubmitPhase] = useState<
    "idle" | "checking-stock" | "sending" | "navigating"
  >("idle");
  const submitting = submitPhase !== "idle";
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [nameErrorAttempt, setNameErrorAttempt] = useState(0);
  const [pendingRemoval, setPendingRemoval] = useState<{
    key: string;
    name: string;
  } | null>(null);
  const customerNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTable(initialTable);
  }, [initialTable, setTable]);

  useEffect(() => {
    if (!ready) return;
    try {
      const saved = sessionStorage.getItem(GCASH_CHECKOUT_DRAFT_KEY);
      if (!saved) return;
      const draft = JSON.parse(saved);
      if (
        !draft ||
        typeof draft.customerName !== "string" ||
        typeof draft.remarks !== "string"
      ) {
        throw new Error("Saved GCash checkout details are invalid.");
      }
      setCustomerName(draft.customerName);
      setRemarks(draft.remarks);
    } catch (error) {
      console.warn("Could not restore the GCash checkout details.", error);
      try {
        sessionStorage.removeItem(GCASH_CHECKOUT_DRAFT_KEY);
      } catch (cleanupError) {
        console.warn("Could not clear invalid GCash checkout details.", cleanupError);
      }
    }
  }, [ready]);

  // Re-check every line against the latest stock counts so a cart that sat
  // open overnight cannot send more portions than the counter has left.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const stockChecked = useRef(false);

  const readCurrentMenu = useCallback(async () => {
    const response = await fetchPortalApi("/api/menu", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.success || !Array.isArray(data.items)) {
      throw new Error(data.error || "Could not check the latest stock.");
    }
    return data.items as MenuItem[];
  }, []);

  const reconcileStock = useCallback(
    (menuItems: MenuItem[], lines: CartItem[]) => {
      const limits: Record<number, number | null> = {};
      for (const entry of menuItems) {
        limits[entry.id] =
          entry.stock_status === "out"
            ? 0
            : entry.stock_tracking_enabled
              ? Math.max(0, entry.stock_count)
              : null;
      }
      const listedIds = new Set(menuItems.map((entry) => entry.id));
      for (const line of lines) {
        if (!listedIds.has(line.menuItemId)) limits[line.menuItemId] = 0;
      }
      setStockLimits(limits);

      const remaining = new Map<number, number>();
      const adjusted: { name: string; from: number; to: number }[] = [];
      for (const line of lines) {
        const limit = limits[line.menuItemId];
        if (limit === null || limit === undefined) continue;
        const available = remaining.get(line.menuItemId) ?? limit;
        const allowed = Math.min(line.quantity, available);
        remaining.set(line.menuItemId, available - allowed);
        if (allowed === line.quantity) continue;

        adjusted.push({ name: line.name, from: line.quantity, to: allowed });
        if (allowed === 0) removeItem(line.key);
        else setQuantity(line.key, allowed);
      }
      return adjusted;
    },
    [removeItem, setQuantity, setStockLimits]
  );

  useEffect(() => {
    if (!ready || stockChecked.current) return;
    stockChecked.current = true;
    let alive = true;
    (async () => {
      try {
        const menuItems = await readCurrentMenu();
        if (!alive) return;
        const adjusted = reconcileStock(menuItems, itemsRef.current);
        if (adjusted.length > 0) {
          feedback.warning("Your cart was adjusted", {
            eyebrow: "Stock changed",
            message:
              "Some portions sold while you were deciding, so we trimmed your cart to what is still available.",
            details: adjusted.map((entry) => ({
              label: entry.name,
              value:
                entry.to > 0
                  ? `${entry.from} → ${entry.to} left`
                  : "Removed · sold out",
            })),
          });
        }
      } catch (error) {
        if (alive) console.warn("Could not refresh stock for the customer cart.", error);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, feedback, readCurrentMenu, reconcileStock]);

  const placeOrder = async () => {
    if (!items.length || submitting) return;
    setSubmitAttempted(true);
    if (!customerName.trim()) {
      setNameErrorAttempt((attempt) => attempt + 1);
      customerNameRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      feedback.warning("What should we call you?", {
        eyebrow: "Before we send it",
        message:
          "Add your name so the team knows who to call when your order is ready.",
        details: [{ label: "Table", value: String(table).padStart(2, "0") }],
      });
      return;
    }
    setSubmitPhase("checking-stock");
    // Re-check stock right before sending so a race during checkout is caught
    // before the request instead of after the customer waits.
    try {
      const menuItems = await readCurrentMenu();
      const adjusted = reconcileStock(menuItems, itemsRef.current);
      if (adjusted.length > 0) {
        setSubmitPhase("idle");
        feedback.warning("Some items sold out", {
          eyebrow: "Stock changed",
          message:
            "A few portions sold while you were checking out. We updated your cart — please review it and try again.",
          details: adjusted.map((entry) => ({
            label: entry.name,
            value:
              entry.to > 0
                ? `${entry.from} → ${entry.to} left`
                : "Removed · sold out",
          })),
        });
        return;
      }
    } catch (error) {
      console.warn("Could not refresh stock before placing the order.", error);
    }
    if (paymentMethod === "gcash") {
      try {
        sessionStorage.setItem(
          GCASH_CHECKOUT_DRAFT_KEY,
          JSON.stringify({
            customerName: customerName.trim(),
            remarks,
            orderType,
          })
        );
      } catch (error) {
        console.error("Could not save the GCash checkout details.", error);
        feedback.error("Couldn't continue to GCash", {
          message:
            "Your checkout details could not be saved in this browser. Please try again.",
        });
        setSubmitPhase("idle");
        return;
      }
      setSubmitPhase("idle");
      router.push(`/customer/payment?table=${table}`);
      return;
    }

    setSubmitPhase("sending");
    const itemCount = count;
    const total = subtotal;
    const methodLabel = "Pay at counter";
    let stockConflict = false;
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            table_number: table,
            order_type: orderType,
            payment_method: paymentMethod,
            customer_name: customerName,
            remarks,
            items: items.map((item) => ({
              menuItemId: item.menuItemId,
              quantity: item.quantity,
              variantIds: item.variantIds || (item.variant ? [item.variant.id] : []),
              addonIds: item.extras.map((extra) => extra.id),
              sugarLevel: item.sugarLevel || undefined,
              note: item.note || undefined,
            })),
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          if (response.status === 409) {
            stockConflict = true;
            try {
              const menuItems = await readCurrentMenu();
              reconcileStock(menuItems, itemsRef.current);
            } catch (error) {
              console.warn("Could not refresh the cart after a stock conflict.", error);
            }
          }
          throw new Error(data.error || "We couldn't place your order.");
        }
        return data;
      },
      {
        loading: {
          title: "Sending your order…",
          message: "Telling the counter and holding your table.",
        },
        success: (data) => ({
          eyebrow: "Order placed",
          title: `Thank you, ${customerName.trim().split(" ")[0]}!`,
          message: "The counter has your order. Please pay when you're ready.",
          duration: 3600,
          details: [
            {
              label: "Order",
              value: `#${String(data.orderNumber ?? data.orderId).padStart(3, "0")}`,
            },
            { label: "Table", value: String(table).padStart(2, "0") },
            { label: "Items", value: String(itemCount) },
            { label: "Total", value: peso(total) },
            { label: "Payment", value: methodLabel },
          ],
        }),
        error: (error) => ({
          title: stockConflict
            ? "Stock changed before checkout"
            : "Your order wasn't placed",
          message: stockConflict
            ? `${error.message} We refreshed your cart where possible. Review it and try again.`
            : error.message,
        }),
      }
    );
    if (result.ok && result.result) {
      setSubmitPhase("navigating");
      setLastOrderId(result.result.orderId);
      try {
        sessionStorage.removeItem(GCASH_CHECKOUT_DRAFT_KEY);
      } catch (error) {
        console.warn("Could not clear the saved GCash checkout details.", error);
      }
      clearCart();
      router.push(
        `/customer/confirm?id=${result.result.orderId}&table=${table}`
      );
    } else {
      setSubmitPhase("idle");
    }
  };

  if (!items.length) {
    if (submitPhase === "navigating") {
      return <CustomerPageSkeleton page="confirm" />;
    }

    return (
      <div className="state-page">
        <div className="state-card">
          <div className="state-icon">
            <Icon name="bag" />
          </div>
          <span className="eyebrow" style={{ color: "var(--brown)" }}>
            Your order
          </span>
          <h1 style={{ marginTop: 9 }}>Your cart is waiting.</h1>
          <p>
            Add a coffee or a warm pastry and we&apos;ll get it started. Your table
            is {String(table).padStart(2, "0")}.
          </p>
          <Link href={`/customer/menu?table=${table}`} className="btn btn-primary">
            Browse the menu <Icon name="arrow-right" className="icon-sm" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link href={`/customer/menu?table=${table}`} className="back-link">
        <Icon name="chevron-left" /> Back to menu
      </Link>
      <div className="checkout-head">
        <span className="eyebrow">Checkout · Table {String(table).padStart(2, "0")}</span>
        <h1>A lovely little order.</h1>
      </div>

      <div className="checkout-layout">
        <div className="checkout-main">
          <section className="checkout-section">
            <div className="section-title">
              <div className="section-head-left">
                <span className="section-index">01</span>
                <div>
                  <h2>How are you enjoying it?</h2>
                  <p>We&apos;ll set the table or pack it to go.</p>
                </div>
              </div>
            </div>
            <div className="order-type-grid">
              <label className="order-type-card">
                <input
                  type="radio"
                  name="order-type"
                  checked={orderType === "dine_in"}
                  onChange={() => setOrderType("dine_in")}
                />
                <span>
                  <Icon name="table" />
                  <span>
                    <strong>Dine in</strong>
                    <em>Table {String(table).padStart(2, "0")}</em>
                  </span>
                </span>
              </label>
              <label className="order-type-card">
                <input
                  type="radio"
                  name="order-type"
                  checked={orderType === "take_out"}
                  onChange={() => setOrderType("take_out")}
                />
                <span>
                  <Icon name="bag" />
                  <span>
                    <strong>Take out</strong>
                    <em>Pick up at the counter</em>
                  </span>
                </span>
              </label>
            </div>
            <div className="field">
              <label className="label" htmlFor="customer-name">
                Your name <span className="muted">(required)</span>
              </label>
              <input
                ref={customerNameRef}
                id="customer-name"
                className="input"
                type="text"
                value={customerName}
                onChange={(event) => {
                  setCustomerName(event.target.value);
                }}
                placeholder="Name to call when your order is ready"
                maxLength={80}
                autoComplete="name"
                required
                aria-invalid={submitAttempted && !customerName.trim()}
                aria-describedby={
                  submitAttempted && !customerName.trim()
                    ? "customer-name-error"
                    : undefined
                }
              />
              {submitAttempted && !customerName.trim() && (
                <span
                  key={nameErrorAttempt}
                  className="field-error customer-name-error"
                  id="customer-name-error"
                >
                  Enter your name to place this order.
                </span>
              )}
            </div>
            <div className="field remarks-area">
              <label className="label" htmlFor="remarks">
                A little note for the barista
              </label>
              <textarea
                id="remarks"
                className="textarea"
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                placeholder="Less sweet, oat milk, no straw — anything we should know?"
                maxLength={300}
              />
            </div>
          </section>

          <section className="checkout-section">
            <div className="section-title">
              <div className="section-head-left">
                <span className="section-index">02</span>
                <div>
                  <h2>How would you like to pay?</h2>
                  <p>Pay at the counter, or continue to secure GCash checkout.</p>
                </div>
              </div>
            </div>
            <div className="payment-method-grid">
              <label className="payment-method">
                <input
                  type="radio"
                  name="payment-method"
                  checked={paymentMethod === "gcash"}
                  onChange={() => setPaymentMethod("gcash")}
                />
                <span>
                  <Image
                    src="/gcash-logo.png"
                    alt=""
                    width={32}
                    height={32}
                    className="pay-icon"
                  />
                  <span>
                    <strong>GCash</strong>
                    <em>Pay securely with automatic confirmation</em>
                  </span>
                </span>
              </label>
              <label className="payment-method">
                <input
                  type="radio"
                  name="payment-method"
                  checked={paymentMethod === "counter"}
                  onChange={() => setPaymentMethod("counter")}
                />
                <span>
                  <span className="pay-icon">
                    <Icon name="card" size={16} />
                  </span>
                  <span>
                    <strong>Pay at counter</strong>
                    <em>Cash or card with staff</em>
                  </span>
                </span>
              </label>
            </div>
          </section>

          <div className="mobile-only mt-2">
            <Link href={`/customer/menu?table=${table}`} className="btn btn-outline btn-block">
              Add something else <Icon name="plus" className="icon-sm" />
            </Link>
          </div>
        </div>

        <aside className="sticky-summary">
          <div className="summary-card">
            <div className="summary-head">
              <h2>Order summary</h2>
              <span className="badge badge-cream">
                {count} {count === 1 ? "item" : "items"}
              </span>
            </div>
            <div className="summary-items">
              {items.map((item) => {
                const meta = [
                  item.variant?.name,
                  item.sugarLevel ? `Sugar ${item.sugarLevel}` : null,
                  ...item.extras.map((extra) => extra.name),
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div className="summary-item" key={item.key}>
                    <div className="summary-item-main">
                      <div className="summary-item-heading">
                        <div className="summary-item-name">
                          {item.quantity} × {item.name}
                        </div>
                        <div className="summary-item-actions">
                          <div className="summary-item-price">
                            {peso(item.unitPrice * item.quantity)}
                          </div>
                          <button
                            type="button"
                            className="summary-item-remove"
                            aria-label={`Remove ${item.name} from order`}
                            title="Remove item"
                            onClick={() =>
                              setPendingRemoval({ key: item.key, name: item.name })
                            }
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      </div>
                      <div className="summary-item-meta">{meta || item.category}</div>
                      {item.stockLimit !== null &&
                        item.stockLimit !== undefined &&
                        item.stockLimit <= 5 && (
                          <div className="summary-item-stock">
                            <Icon name="clock" size={11} /> Only {item.stockLimit}{" "}
                            left today
                          </div>
                        )}
                      {item.note && (
                        <div className="summary-item-note">
                          <Icon name="message" size={13} />
                          <span>{item.note}</span>
                        </div>
                      )}
                      <Link
                        href={`/customer/item/${item.menuItemId}?table=${table}&edit=${encodeURIComponent(item.key)}`}
                        className="summary-item-edit"
                      >
                        <Icon name="edit" size={12} /> Edit options
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="summary-totals">
              <div className="totals-row">
                <span>Subtotal</span>
                <span>{peso(subtotal)}</span>
              </div>
              <div className="totals-row">
                <span>Service charge</span>
                <span>Included</span>
              </div>
              <div className="totals-row total">
                <span>Total</span>
                <span>{peso(subtotal)}</span>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={submitting}
              onClick={placeOrder}
            >
              {submitting ? (
                <>
                  <span className="spinner spinner-light" style={{ width: 15, height: 15 }} />
                  {submitPhase === "checking-stock"
                    ? "Checking availability…"
                    : "Sending order…"}
                </>
              ) : (
                <>
                  {paymentMethod === "gcash" ? "Pay with GCash" : "Place order"}{" "}
                  <Icon name="arrow-right" className="icon-sm" />
                </>
              )}
            </button>
          </div>
        </aside>
      </div>
      {pendingRemoval && (
        <div className="feedback-layer">
          <div
            className="feedback-card checkout-remove-confirm-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="checkout-remove-title"
            aria-describedby="checkout-remove-message"
            data-tone="warning"
          >
            <div className="feedback-medallion" aria-hidden="true">
              <Icon name="trash" size={22} />
            </div>
            <span className="feedback-eyebrow">Remove order item</span>
            <h2 id="checkout-remove-title" className="feedback-title">
              Remove this item?
            </h2>
            <p id="checkout-remove-message" className="feedback-message">
              Remove {pendingRemoval.name} from your order?
            </p>
            <div className="payment-remove-confirm-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setPendingRemoval(null)}
              >
                Keep item
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  removeItem(pendingRemoval.key);
                  setPendingRemoval(null);
                }}
              >
                <Icon name="trash" className="icon-sm" /> Remove item
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
