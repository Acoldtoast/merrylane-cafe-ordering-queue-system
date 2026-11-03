"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icons";
import { useFeedback } from "@/components/Feedback";
import { CustomerCancelOrderButton } from "@/components/CustomerCancelOrderButton";
import { useCustomer } from "@/components/CustomerProvider";
import type { Order } from "@/lib/types";
import { peso, orderTypeLabel } from "@/lib/format";
import { orderItemMeta } from "@/lib/orderItems";

export function PaymentClient({
  orderId,
  initialTable,
  balancePayment = false,
}: {
  orderId: number;
  initialTable: number;
  balancePayment?: boolean;
}) {
  const router = useRouter();
  const feedback = useFeedback();
  const { setTable, table } = useCustomer();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [proof, setProof] = useState("");
  const [proofName, setProofName] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [gcash, setGcash] = useState("0917 123 4567");
  const [gcashName, setGcashName] = useState("Merrylane Cafe");
  const [gcashQr, setGcashQr] = useState("");

  useEffect(() => {
    setTable(initialTable);
  }, [initialTable, setTable]);

  useEffect(() => {
    if (!orderId) {
      setError("We couldn't find that order.");
      setLoading(false);
      return;
    }
    Promise.all([
      fetch(`/api/orders/${orderId}`).then((res) => res.json()),
      fetch("/api/settings").then((res) => res.json()),
    ])
      .then(([orderData, settingsData]) => {
        if (!orderData.order) throw new Error(orderData.error || "Order not found.");
        setOrder(orderData.order);
        setReference(balancePayment ? "" : orderData.order.payment_reference || "");
        if (orderData.order.status === "cancelled") {
          router.replace(`/customer/status?id=${orderId}&table=${initialTable}`);
          return;
        }
        if (!balancePayment && orderData.order.payment_proof_url) {
          setProof(orderData.order.payment_proof_url);
          setProofName("Uploaded receipt");
        }
        if (balancePayment && Number(orderData.order.balance_due || 0) <= 0) {
          router.replace(`/customer/status?id=${orderId}&table=${initialTable}`);
        } else if (!balancePayment && orderData.order.payment_status === "verified") {
          router.replace(`/customer/status?id=${orderId}&table=${initialTable}`);
        }
        if (settingsData.settings) {
          setGcash(settingsData.settings.gcash_number || "0917 123 4567");
          setGcashName(settingsData.settings.gcash_name || "Merrylane Cafe");
          setGcashQr(settingsData.settings.gcash_qr_data_url || "");
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [orderId, initialTable, router, balancePayment]);

  const handleFile = (file: File | null) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      feedback.warning("That file won't work", {
        message: "Choose a JPG, PNG, WebP, or GIF image of your GCash receipt.",
      });
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      feedback.warning("That screenshot is too large", {
        message: "Choose an image under 3 MB so it sends quickly.",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProof(String(reader.result || ""));
      setProofName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(gcash.replace(/\s/g, ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      feedback.warning("Copy it manually", {
        message: `Select the GCash number (${gcash}) and copy it from the screen.`,
      });
    }
  };

  const submit = async () => {
    setSubmitAttempted(true);
    if (!proof) {
      feedback.warning("We need to see the payment", {
        message: "Add a clear screenshot of your GCash receipt before sending it for review.",
      });
      return;
    }
    if (!reference.trim()) {
      feedback.warning("One detail is missing", {
        message: "Type the GCash reference number shown on your receipt.",
        details: [{ label: "Order", value: `#${String(orderId).padStart(3, "0")}` }],
      });
      return;
    }
    setSubmitting(true);
    const amount = order
      ? balancePayment
        ? order.balance_due || 0
        : order.total
      : 0;
    const result = await feedback.run(
      async () => {
        const response = await fetch(
          balancePayment
            ? `/api/orders/${orderId}/balance-payments`
            : `/api/orders/${orderId}/pay`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              balancePayment
                ? {
                    payment_method: "gcash",
                    payment_proof_url: proof,
                    payment_reference: reference,
                  }
                : {
                    payment_proof_url: proof,
                    payment_reference: reference,
                  }
            ),
          }
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not submit the payment proof.");
        }
        return data;
      },
      {
        loading: {
          title: "Sending your receipt…",
          message: "A staff member will check it against the GCash account.",
        },
        success: () => ({
          eyebrow: balancePayment ? "Balance sent" : "Receipt sent",
          title: "Payment proof submitted",
          message:
            "We verify payments manually, usually within a few minutes. Keep this page handy.",
          duration: 3400,
          details: [
            { label: "Order", value: `#${String(orderId).padStart(3, "0")}` },
            { label: "Amount", value: peso(amount) },
            { label: "Reference", value: reference.trim() },
          ],
        }),
      }
    );
    if (result.ok) {
      router.push(
        balancePayment
          ? `/customer/status?id=${orderId}&table=${initialTable}`
          : `/customer/confirm?id=${orderId}&table=${initialTable}`
      );
    } else {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Preparing your GCash payment…
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="state-page">
        <div className="state-card">
          <div className="state-icon">
            <Icon name="alert" />
          </div>
          <h1>We lost that order.</h1>
          <p>{error}</p>
          <Link href={`/customer/menu?table=${table}`} className="btn btn-primary">
            Back to menu
          </Link>
        </div>
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="pay-card">
      <Link
        href={
          balancePayment
            ? `/customer/status?id=${orderId}&table=${initialTable}`
            : `/customer/cart?table=${initialTable}`
        }
        className="back-link"
      >
        <Icon name="chevron-left" /> Back
      </Link>
      <div className="checkout-head">
        <span className="eyebrow">
          {balancePayment ? "Additional balance" : "Pay with GCash"} · Order #
          {String(order.id).padStart(3, "0")}
        </span>
        <h1>{balancePayment ? "Pay the added balance." : "Pay with GCash."}</h1>
        <p>
          {balancePayment
            ? "This payment covers only the additional items added by staff. Upload its receipt for a separate review."
            : "Scan the QR or send to our number, then upload a clear screenshot. We verify payments manually, usually within a few minutes."}
        </p>
      </div>

      {error && <div className="error-strip" style={{ marginBottom: 12 }}>{error}</div>}
      {balancePayment &&
        order.balance_payments?.some((payment) => payment.status === "pending") && (
          <div className="payment-note" style={{ marginBottom: 12 }}>
            <Icon name="clock" />
            <span>
              Your additional GCash payment is waiting for staff review. You do not need
              to submit it again.
            </span>
          </div>
        )}

      <div className="pay-layout">
        <section className="card pay-form-card">
          <div className="gcash-amount">
            <div>
              <small>Exact amount</small>
              <strong>{peso(balancePayment ? order.balance_due || 0 : order.total)}</strong>
            </div>
            <span className="gcash-mark">G</span>
          </div>

          <div className="qr-shell">
            <div className="qr-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={gcashQr || "/api/qr/gcash"}
                alt="Merrylane Cafe GCash QR code"
              />
            </div>
            <div className="qr-cafe">{gcashName}</div>
            <div className="qr-number">{gcash}</div>
            <p>
              Open GCash → Scan QR → enter{" "}
              {peso(balancePayment ? order.balance_due || 0 : order.total)} → confirm.
              <br />
              Keep the receipt for your reference.
            </p>
            <button
              type="button"
              className="btn btn-soft btn-sm"
              style={{ marginTop: 9 }}
              onClick={copyNumber}
              disabled={
                balancePayment &&
                Boolean(order.balance_payments?.some((payment) => payment.status === "pending"))
              }
            >
              <Icon name={copied ? "check" : "card"} className="icon-sm" />
              {copied ? "Number copied" : "Copy GCash number"}
            </button>
          </div>

          <div className="mt-3">
            <div className="section-title">
              <div className="section-head-left">
                <span className="section-index">02</span>
                <div>
                  <h2 style={{ fontSize: 18 }}>Upload your receipt</h2>
                  <p>JPG, PNG or screenshot · under 3 MB</p>
                </div>
              </div>
            </div>
            {proof ? (
              <div className="upload-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={proof} alt="GCash receipt preview" />
                <div className="upload-preview-bar">
                  <span>
                    <Icon name="check-circle" className="icon-sm" /> {proofName || "Receipt attached"}
                  </span>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setProof("");
                      setProofName("");
                    }}
                  >
                    Change
                  </button>
                </div>
              </div>
            ) : (
              <label
                className="upload-zone"
                aria-invalid={submitAttempted && !proof}
              >
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  aria-invalid={submitAttempted && !proof}
                  onChange={(event) => {
                    handleFile(event.target.files?.[0] || null);
                    event.currentTarget.value = "";
                  }}
                />
                <span className="upload-icon">
                  <Icon name="upload" size={17} />
                </span>
                <strong>Attach a screenshot</strong>
                <p>Tap to choose a photo or screenshot from your device</p>
              </label>
            )}
            {submitAttempted && !proof && (
              <span className="field-error">
                Attach your GCash receipt before submitting.
              </span>
            )}
            <div className="field mt-2">
              <label className="label" htmlFor="reference">
                GCash reference number <span className="muted">(required)</span>
              </label>
              <input
                id="reference"
                className="input"
                value={reference}
                onChange={(event) => {
                  setReference(event.target.value);
                }}
                placeholder="e.g. 2048 0319 7350"
                inputMode="numeric"
                required
                aria-invalid={submitAttempted && !reference.trim()}
                aria-describedby={
                  submitAttempted && !reference.trim()
                    ? "reference-error"
                    : undefined
                }
              />
              {submitAttempted && !reference.trim() && (
                <span className="field-error" id="reference-error">
                  Enter the reference number shown on your receipt.
                </span>
              )}
            </div>
          </div>

          <div className="payment-note">
            <Icon name="info" />
            <span>
              Payments are checked by a staff member against this order. You&apos;ll
              see the queue number as soon as it&apos;s confirmed.
            </span>
          </div>

          <div className="pay-footer">
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                submitting ||
                (balancePayment &&
                  Boolean(order.balance_payments?.some((payment) => payment.status === "pending")))
              }
              onClick={submit}
            >
              {submitting ? (
                <>
                  <span className="spinner spinner-light" style={{ width: 15, height: 15 }} />
                  Submitting proof…
                </>
              ) : (
                <>
                  {balancePayment ? "Submit additional payment" : "Submit payment proof"}{" "}
                  <Icon name="arrow-right" className="icon-sm" />
                </>
              )}
            </button>
            {!balancePayment && (
              <CustomerCancelOrderButton
                order={order}
                onCancelled={() =>
                  router.replace(
                    `/customer/status?id=${order.id}&table=${initialTable}`
                  )
                }
              />
            )}
          </div>
        </section>

        <aside className="card pay-side">
          <h2>Your order</h2>
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
          <div className="summary-totals">
            {balancePayment ? (
              <>
                <div className="totals-row">
                  <span>Current order total</span>
                  <span>{peso(order.total)}</span>
                </div>
                <div className="totals-row">
                  <span>Paid so far</span>
                  <span>{peso(order.total - Number(order.balance_due || 0))}</span>
                </div>
                <div className="totals-row total">
                  <span>Additional balance due</span>
                  <span>{peso(order.balance_due || 0)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="totals-row">
                  <span>Subtotal</span>
                  <span>{peso(order.subtotal)}</span>
                </div>
                <div className="totals-row">
                  <span>Service charge</span>
                  <span>{peso(order.service_charge)}</span>
                </div>
                <div className="totals-row total">
                  <span>Total</span>
                  <span>{peso(order.total)}</span>
                </div>
              </>
            )}
          </div>
          <div className="status-confirm-number">
            <span>{orderTypeLabel(order.order_type)}</span>
            <b>Table {String(order.table_number).padStart(2, "0")}</b>
          </div>
          <div className="help-card">
            <h3>Need a hand?</h3>
            <p>Call a waiter if you need help with GCash or your order.</p>
            <Link
              href={`/customer/waiter?table=${initialTable}&order=${order.id}`}
              className="btn btn-outline btn-block btn-sm"
            >
              <Icon name="waiter" className="icon-sm" /> Call a waiter
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
