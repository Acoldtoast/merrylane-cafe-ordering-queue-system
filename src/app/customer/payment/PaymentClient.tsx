"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icons";
import { CustomerPageSkeleton } from "@/components/CustomerPageSkeleton";
import { useCustomer } from "@/components/CustomerProvider";
import type { CartItem, Order } from "@/lib/types";
import { peso, orderTypeLabel } from "@/lib/format";
import { orderItemMeta } from "@/lib/orderItems";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { usePolling } from "@/lib/usePolling";

const GCASH_CHECKOUT_DRAFT_KEY = "merrylane.gcash-checkout.v1";

interface GcashCheckoutDraft {
  customerName: string;
  remarks: string;
  orderType: "dine_in" | "take_out";
}

interface CheckoutQuote {
  subtotal: number;
  service_charge: number;
  total: number;
  vat_mode: "none" | "add" | "included";
  vat_rate_pct: number;
  vat_amount: number;
  rounding_adjustment: number;
  menu_vat_pct: number;
}

interface XenditPaymentState {
  status: string;
  checkoutUrl: string | null;
  mobileUrl: string | null;
  qrCodeDataUrl: string | null;
  qrIsPaymentQr: boolean;
  testMode: boolean;
  expiresAt: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseXenditPayment(value: unknown): XenditPaymentState | null {
  if (!isRecord(value)) {
    throw new Error("Xendit returned an invalid payment response.");
  }
  if (value.payment === null) return null;
  if (!isRecord(value.payment) || typeof value.payment.status !== "string") {
    throw new Error("Xendit returned an invalid payment response.");
  }

  const { checkoutUrl, mobileUrl, qrCodeDataUrl, expiresAt } = value.payment;
  if (
    (checkoutUrl !== null && typeof checkoutUrl !== "string") ||
    (mobileUrl !== null && typeof mobileUrl !== "string") ||
    (qrCodeDataUrl !== null && typeof qrCodeDataUrl !== "string") ||
    (expiresAt !== null && (typeof expiresAt !== "number" || !Number.isFinite(expiresAt))) ||
    typeof value.payment.qrIsPaymentQr !== "boolean" ||
    typeof value.payment.testMode !== "boolean"
  ) {
    throw new Error("Xendit returned incomplete payment options.");
  }
  if (typeof checkoutUrl === "string" && !checkoutUrl.startsWith("https://")) {
    throw new Error("Xendit returned an insecure checkout link.");
  }
  if (
    typeof mobileUrl === "string" &&
    !mobileUrl.startsWith("https://") &&
    !mobileUrl.startsWith("gcash:")
  ) {
    throw new Error("Xendit returned an unsupported GCash app link.");
  }
  if (
    typeof qrCodeDataUrl === "string" &&
    !qrCodeDataUrl.startsWith("data:image/png;base64,")
  ) {
    throw new Error("Xendit returned an invalid checkout QR code.");
  }

  return {
    status: value.payment.status,
    checkoutUrl,
    mobileUrl,
    qrCodeDataUrl,
    expiresAt,
    qrIsPaymentQr: value.payment.qrIsPaymentQr,
    testMode: value.payment.testMode,
  };
}

async function readXenditPayment(response: Response) {
  const payload: unknown = await response.json();
  if (!response.ok || !isRecord(payload) || payload.success !== true) {
    throw new Error(
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "Could not load Xendit payment options."
    );
  }
  return parseXenditPayment(payload);
}

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
  const {
    setTable,
    table,
    items: cartItems,
    orderType,
    clearCart,
    setLastOrderId,
    ready,
    vatRatePct,
  } = useCustomer();
  const [order, setOrder] = useState<Order | null>(null);
  const [checkoutDraft, setCheckoutDraft] = useState<GcashCheckoutDraft | null>(
    null
  );
  const [checkoutQuote, setCheckoutQuote] = useState<CheckoutQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paymentRefreshError, setPaymentRefreshError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [switchingToCash, setSwitchingToCash] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [payment, setPayment] = useState<XenditPaymentState | null>(null);
  const [createdOrderId, setCreatedOrderId] = useState(0);
  const completionHandled = useRef(false);
  const autoStartAttempted = useRef(false);
  const activeOrderId = orderId || createdOrderId;
  const isNewCheckout = !balancePayment && !activeOrderId;
  const hasPendingManualOrderProof =
    !balancePayment &&
    order?.payment_status === "pending" &&
    Boolean(order.payment_proof_url);
  const hasPendingBalancePayment = Boolean(
    order?.balance_payments?.some((payment) => payment.status === "pending")
  );
  const preflightError =
    isNewCheckout && ready && cartItems.length === 0
      ? "Your cart is empty. Return to checkout to choose your items."
      : balancePayment && !activeOrderId
        ? "We couldn't find that order."
        : "";

  useEffect(() => {
    setTable(initialTable);
  }, [initialTable, setTable]);

  useEffect(() => {
    if (isNewCheckout) {
      if (!ready) return;
      if (cartItems.length === 0) {
        return;
      }

      const requestItems = cartItems.map((item: CartItem) => ({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        variantIds: item.variantIds || (item.variant ? [item.variant.id] : []),
        addonIds: item.extras.map((extra) => extra.id),
        sugarLevel: item.sugarLevel || undefined,
        note: item.note || undefined,
      }));
      Promise.resolve()
        .then(() => {
          const saved = sessionStorage.getItem(GCASH_CHECKOUT_DRAFT_KEY);
          const parsed = saved ? JSON.parse(saved) : null;
          if (
            !parsed ||
            typeof parsed.customerName !== "string" ||
            !parsed.customerName.trim() ||
            typeof parsed.remarks !== "string" ||
            (parsed.orderType !== "dine_in" && parsed.orderType !== "take_out")
          ) {
            throw new Error(
              "Your checkout details are missing. Return to checkout."
            );
          }
          const draft: GcashCheckoutDraft = parsed;
          setCheckoutDraft(draft);
          return draft;
        })
        .then((draft) =>
          fetchPortalApi("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preview: true,
            table_number: initialTable,
            order_type: draft.orderType || orderType,
            payment_method: "gcash",
             customer_name: draft.customerName,
             menu_vat_pct: vatRatePct,
            remarks: draft.remarks,
            items: requestItems,
          }),
          })
        )
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.error || "Could not check the GCash amount.");
          }
          return data;
        })
        .then((quoteData) => {
          setCheckoutQuote({
            subtotal: Number(quoteData.subtotal),
            service_charge: Number(quoteData.service_charge),
            total: Number(quoteData.total),
            vat_mode: quoteData.vat_mode,
            vat_rate_pct: Number(quoteData.vat_rate_pct),
            vat_amount: Number(quoteData.vat_amount),
            rounding_adjustment: Number(quoteData.rounding_adjustment),
            menu_vat_pct: Number(quoteData.menu_vat_pct),
          });
        })
        .catch((cause: unknown) => {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not prepare GCash payment."
          );
        })
        .finally(() => setLoading(false));
      return;
    }

    if (!activeOrderId) {
      return;
    }
    Promise.all([
      fetchPortalApi(`/api/orders/${activeOrderId}`, { cache: "no-store" }),
      fetchPortalApi(
        `/api/orders/${activeOrderId}/xendit-payment?payment_kind=${
          balancePayment ? "balance" : "order"
        }&include_qr=1`,
        { cache: "no-store" }
      ),
    ])
      .then(async ([orderResponse, paymentResponse]) => {
        const orderData = await orderResponse.json();
        if (!orderResponse.ok || !orderData.order) {
          throw new Error(orderData.error || "Order not found.");
        }
        setOrder(orderData.order);
        if (orderData.order.status === "cancelled" || orderData.order.payment_status === "rejected") {
          router.replace(`/customer/status?id=${activeOrderId}&table=${initialTable}`);
          return;
        }
        if (!balancePayment && orderData.order.payment_method !== "gcash") {
          router.replace(`/customer/confirm?id=${activeOrderId}&table=${initialTable}`);
          return;
        }
        const paymentData = await readXenditPayment(paymentResponse);
        if (paymentData) setPayment(paymentData);
        if (balancePayment && Number(orderData.order.balance_due || 0) <= 0) {
          router.replace(`/customer/status?id=${activeOrderId}&table=${initialTable}`);
        } else if (!balancePayment && orderData.order.payment_status === "verified") {
          router.replace(`/customer/status?id=${activeOrderId}&table=${initialTable}`);
        }
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "Could not load the order."
        )
      )
      .finally(() => setLoading(false));
  }, [
    activeOrderId,
    initialTable,
    router,
    balancePayment,
    isNewCheckout,
    ready,
    cartItems,
    orderType,
    vatRatePct,
  ]);

  const startPayment = useCallback(async () => {
    if (submitting) return;
    if (isNewCheckout && (!checkoutDraft || !checkoutQuote)) {
      setError("Checkout is not ready. Return to checkout and try again.");
      return;
    }
    if (payment?.status === "pending" || payment?.status === "creating") {
      setError("This Xendit checkout is already active. Use the QR or GCash link below.");
      return;
    }
    if (hasPendingManualOrderProof || hasPendingBalancePayment) {
      setError("This payment is already waiting for review. You do not need to submit it again.");
      return;
    }
    setSubmitting(true);
    setError("");
    setPaymentRefreshError("");
    try {
      let checkoutOrderId = activeOrderId;
      if (!checkoutOrderId) {
        const response = await fetchPortalApi("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              table_number: initialTable,
              order_type: checkoutDraft?.orderType,
              payment_method: "gcash",
              customer_name: checkoutDraft?.customerName,
              menu_vat_pct: checkoutQuote?.menu_vat_pct,
              remarks: checkoutDraft?.remarks,
              items: cartItems.map((item) => ({
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
            if (data.code === "VAT_RATE_CHANGED") setCheckoutQuote(null);
            throw new Error(data.error || "Could not create the order.");
        }
        checkoutOrderId = Number(data.orderId);
        if (!Number.isSafeInteger(checkoutOrderId) || checkoutOrderId <= 0) {
            throw new Error("The order was created but its ID was missing.");
        }
        setCreatedOrderId(checkoutOrderId);
        setLastOrderId(checkoutOrderId);
        setLoading(true);
        router.replace(
            `/customer/payment?id=${checkoutOrderId}&table=${initialTable}`
        );
      }

      const response = await fetchPortalApi(
        `/api/orders/${checkoutOrderId}/xendit-payment`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payment_kind: balancePayment ? "balance" : "order",
            }),
        }
      );
      const newPayment = await readXenditPayment(response);
       if (!newPayment || (!newPayment.checkoutUrl && newPayment.expiresAt === null)) {
        throw new Error("Xendit did not return checkout options.");
      }
      setPayment(newPayment);

      if (!balancePayment) {
        clearCart();
        try {
            sessionStorage.removeItem(GCASH_CHECKOUT_DRAFT_KEY);
        } catch (cause) {
            console.warn("Could not clear the saved GCash checkout details.", cause);
        }
      }
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : "Could not start GCash checkout."
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    activeOrderId,
    balancePayment,
    cartItems,
    checkoutDraft,
    checkoutQuote,
    clearCart,
    hasPendingBalancePayment,
    hasPendingManualOrderProof,
    initialTable,
    isNewCheckout,
    payment?.status,
    router,
    setLastOrderId,
    submitting,
  ]);

  const autoStartReady =
    isNewCheckout
      ? Boolean(checkoutDraft && checkoutQuote)
      : Boolean(
          order &&
            !payment &&
            !hasPendingManualOrderProof &&
            (balancePayment
              ? Number(order.balance_due || 0) > 0 &&
                order.payment_status === "verified" &&
                !hasPendingBalancePayment
              : order.payment_method === "gcash" &&
                 order.payment_status === "pending")
        );

  useEffect(() => {
    if (
      !autoStartReady ||
      loading ||
      error ||
      preflightError ||
      submitting ||
      payment ||
      autoStartAttempted.current
    ) {
      return;
    }

    autoStartAttempted.current = true;
    void startPayment();
  }, [
    autoStartReady,
    error,
    loading,
    payment,
    preflightError,
    startPayment,
    submitting,
  ]);

  const refreshPaymentStatus = useCallback(async () => {
    if (!activeOrderId || payment?.status !== "pending") return;
    try {
      const kind = balancePayment ? "balance" : "order";
      const expired = payment.expiresAt !== null && Date.now() >= payment.expiresAt;
      const paymentResponse = await (expired ? fetch : fetchPortalApi)(
        expired
          ? `/api/orders/${activeOrderId}/xendit-payment`
          : `/api/orders/${activeOrderId}/xendit-payment?payment_kind=${kind}&refresh=1`,
        expired ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "expire", payment_kind: kind }),
        } : { cache: "no-store" }
      );
      const latestPayment = await readXenditPayment(paymentResponse);
      if (!latestPayment) {
        throw new Error("The Xendit checkout for this order could not be found.");
      }
      setPayment((current) => ({
        ...latestPayment,
        qrCodeDataUrl:
          latestPayment.qrCodeDataUrl ||
          (latestPayment.status === "pending" && current?.expiresAt === latestPayment.expiresAt
            ? current?.qrCodeDataUrl || null : null),
      }));

      const orderResponse = await fetchPortalApi(
        `/api/orders/${activeOrderId}`,
        { cache: "no-store" }
      );
      const orderData = await orderResponse.json();
      if (!orderResponse.ok || !orderData.order) {
        throw new Error(orderData.error || "Could not refresh the order.");
      }
      setOrder(orderData.order);
      setPaymentRefreshError("");
      if (orderData.order.status === "cancelled" || orderData.order.payment_status === "rejected") {
        router.replace(`/customer/status?id=${activeOrderId}&table=${initialTable}`);
        return;
      }
      if (!balancePayment && orderData.order.payment_method !== "gcash") {
        router.replace(`/customer/confirm?id=${activeOrderId}&table=${initialTable}`);
        return;
      }

      const paymentComplete = balancePayment
        ? Number(orderData.order.balance_due || 0) <= 0
        : orderData.order.payment_status === "verified";
      if (!paymentComplete || completionHandled.current) return;

      completionHandled.current = true;
      if (!balancePayment) {
        clearCart();
        try {
          sessionStorage.removeItem(GCASH_CHECKOUT_DRAFT_KEY);
        } catch (cause) {
          console.warn("Could not clear the saved GCash checkout details.", cause);
        }
        setLastOrderId(activeOrderId);
      }
      router.replace(`/customer/status?id=${activeOrderId}&table=${initialTable}`);
    } catch (cause: unknown) {
      setPaymentRefreshError(
        cause instanceof Error
          ? cause.message
          : "Could not refresh payment status."
      );
      throw cause;
    }
  }, [
    activeOrderId,
    balancePayment,
    clearCart,
    initialTable,
    payment?.expiresAt,
    payment?.status,
    router,
    setLastOrderId,
  ]);

  usePolling(refreshPaymentStatus, 5_000, {
    enabled: Boolean(activeOrderId && payment?.status === "pending"),
    immediate: false,
    resources: ["orders", "payments"],
  });

  useEffect(() => {
    if (payment?.status !== "pending" || payment.expiresAt === null) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [payment?.status, payment?.expiresAt]);

  const remainingSeconds = payment?.expiresAt != null
    ? Math.max(0, Math.min(300, Math.ceil((payment.expiresAt - clock) / 1_000)))
    : null;
  const canSwitchToCash = !balancePayment && Boolean(
    order?.payment_method === "gcash" && order.payment_status === "pending" &&
    (order.status === "pending" || order.status === "payment_pending") &&
    payment?.status === "expired"
  );
  const switchToCash = async () => {
    if (!canSwitchToCash || submitting || switchingToCash) return;
    setSwitchingToCash(true);
    setError("");
    try {
      const response = await fetchPortalApi(`/api/orders/${activeOrderId}/xendit-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "counter" }),
      });
      const data: unknown = await response.json();
      if (!response.ok || !isRecord(data) || data.success !== true) {
        throw new Error(isRecord(data) && typeof data.error === "string" ? data.error : "Could not switch to cash.");
      }
      router.replace(`/customer/confirm?id=${activeOrderId}&table=${initialTable}`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not switch to cash.");
      setSwitchingToCash(false);
    }
  };

  const amountDue = order
    ? balancePayment
      ? order.balance_due || 0
      : order.total
    : checkoutQuote?.total || 0;
  const canReturnToCheckout = isNewCheckout;
  const canRetryCreation =
    Boolean(error) &&
    !balancePayment &&
    (Boolean(isNewCheckout && checkoutDraft && checkoutQuote) ||
      createdOrderId > 0);
  const canRetryPayment =
    (Boolean(error) ||
      payment?.status === "failed" ||
      payment?.status === "expired") &&
    !["pending", "creating", "succeeded", "succeeded_unapplied", "mismatched"].includes(
      payment?.status || ""
    ) &&
    !hasPendingManualOrderProof &&
    !hasPendingBalancePayment &&
    !(balancePayment && order?.payment_status !== "verified");
  const displayOrderType =
    order?.order_type || checkoutDraft?.orderType || orderType;

  if ((error || preflightError) && !order) {
    return (
      <div className="state-page">
        <div className="state-card">
          <div className="state-icon">
            <Icon name="alert" />
          </div>
          <h1>{isNewCheckout ? "GCash checkout isn't ready." : "We lost that order."}</h1>
          <p>{error || preflightError}</p>
          {canRetryCreation && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={submitting}
              onClick={() => void startPayment()}
            >
              {submitting ? "Preparing GCash checkout…" : "Try GCash again"}
            </button>
          )}
          <Link
            href={
              isNewCheckout
                ? `/customer/cart?table=${initialTable}`
                : `/customer/menu?table=${table}`
            }
            className="btn btn-primary"
          >
            {isNewCheckout ? "Back to checkout" : "Back to menu"}
          </Link>
        </div>
      </div>
    );
  }

  if (
    loading || order?.payment_status === "rejected" || order?.status === "cancelled" ||
    (!balancePayment && order && order.payment_method !== "gcash")
  ) {
    return <CustomerPageSkeleton />;
  }

  if (!order && !isNewCheckout) {
    return (
      <div className="state-page">
        <div className="state-card">
          <div className="state-icon">
            <Icon name="alert" />
          </div>
          <h1>Payment details are unavailable.</h1>
          <p>{error || "Please ask a staff member for help with your order."}</p>
          <Link href={`/customer/menu?table=${table}`} className="btn btn-primary">
            Back to menu
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pay-card">
      <Link
        href={
          balancePayment
            ? `/customer/status?id=${activeOrderId}&table=${initialTable}`
            : canReturnToCheckout
              ? `/customer/cart?table=${initialTable}`
              : `/customer/status?id=${activeOrderId}&table=${initialTable}`
        }
        className="back-link"
        aria-disabled={submitting}
        onClick={(event) => {
          if (submitting) event.preventDefault();
        }}
      >
        <Icon name="chevron-left" />{" "}
        {canReturnToCheckout ? "Back to checkout" : "Back to order"}
      </Link>
      <div className="checkout-head">
        <span className="eyebrow">
          {balancePayment
            ? "Additional balance"
            : order
              ? `Pay with GCash · Order #${String(
                  order.order_number ?? order.id
                ).padStart(3, "0")}`
              : `Pay with GCash · Table ${String(initialTable).padStart(2, "0")}`}
        </span>
        <h1>{balancePayment ? "Pay the added balance." : "Pay with GCash."}</h1>
      </div>

      {error && (
        <div className="error-strip" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      {paymentRefreshError && (
        <div className="error-strip" role="alert" style={{ marginBottom: 12 }}>
          We couldn’t refresh the Xendit payment status: {paymentRefreshError}.
          Retrying automatically.
        </div>
      )}
      {(hasPendingManualOrderProof || hasPendingBalancePayment) && (
        <div className="payment-note" style={{ marginBottom: 12 }}>
          <Icon name="clock" />
          <span>
            An earlier payment is under review. Please don&apos;t pay it again.
          </span>
        </div>
      )}

      <div className="pay-layout">
        <section className="card pay-form-card">
          <div className="gcash-amount">
            <div>
              <small>{balancePayment ? "Balance due" : "Amount to pay"}</small>
              <strong>{peso(amountDue)}</strong>
            </div>
            <Image
              src="/gcash-logo.png"
              alt="GCash"
              width={33}
              height={33}
              className="gcash-mark"
            />
          </div>

          {payment?.status === "pending" && remainingSeconds === 0 && (
            <p className="payment-note" role="status">
              Time is up. We&apos;re checking with Xendit. Please don&apos;t pay again yet.
            </p>
          )}
          {payment?.status === "pending" && remainingSeconds !== 0 && (
            <>
              <p className="muted">Xendit confirms your GCash payment automatically. No screenshot is needed.</p>
              {remainingSeconds !== null && (
                <p className="muted">
                  Time left: {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}
                </p>
              )}
              <div className="qr-shell" style={{ marginTop: 18 }}>
                {payment.qrCodeDataUrl ? (
                  <div className="qr-frame">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={payment.qrCodeDataUrl}
                      alt={
                        payment.qrIsPaymentQr
                          ? "Xendit GCash payment QR code"
                          : "QR code to open Xendit's secure GCash checkout"
                      }
                    />
                  </div>
                ) : (
                  <p role="alert">Xendit did not provide a QR code for this checkout.</p>
                )}
                {payment.mobileUrl && (
                  <a
                    href={payment.mobileUrl}
                    className="btn btn-primary btn-sm"
                  >
                    <Icon name="arrow-right" className="icon-sm" />
                    Open GCash app
                  </a>
                )}
                {payment.checkoutUrl && (
                  <a
                    href={payment.checkoutUrl}
                    className="btn btn-soft btn-sm"
                    style={{ marginTop: 8 }}
                  >
                    Open secure checkout
                  </a>
                )}
              </div>
            </>
          )}
          {payment?.status === "expired" && !balancePayment ? (
            <div className="error-strip" role="status" style={{ marginTop: 18 }}>
              <strong>GCash checkout expired.</strong> Retry GCash or pay cash at the counter.
              If GCash already deducted the amount, ask staff to check before paying again.
            </div>
          ) : payment && ["failed", "expired"].includes(payment.status) && (
            <div className="error-strip" role="alert" style={{ marginTop: 18 }}>
              This Xendit checkout {payment.status}. Start a new checkout to try again.
            </div>
          )}
          {payment?.status === "succeeded" && (
            <div className="payment-note" role="status" style={{ marginTop: 18 }}>
              <Icon name="check-circle" />
              <span>
                Xendit confirmed your payment. Opening your order status…
              </span>
            </div>
          )}
          {payment &&
            ["mismatched", "succeeded_unapplied"].includes(payment.status) && (
              <div className="error-strip" role="alert" style={{ marginTop: 18 }}>
                Xendit reported a payment that could not be matched to this order.
                Please ask a staff member to check it before paying again.
              </div>
            )}
          {(submitting || canRetryPayment) && (
            <div className="pay-footer">
              {submitting ? (
                <div className="payment-preparing" role="status" aria-live="polite">
                  <span
                    className="spinner"
                    style={{ width: 15, height: 15 }}
                  />
                  Preparing GCash checkout…
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={submitting || switchingToCash}
                  onClick={() => void startPayment()}
                >
                  {payment?.status === "expired" && !balancePayment
                    ? "Retry GCash"
                    : payment?.status === "failed" || payment?.status === "expired"
                    ? "Try GCash again"
                    : "Retry GCash checkout"}{" "}
                  <Icon name="arrow-right" className="icon-sm" />
                </button>
              )}
              {canSwitchToCash && !submitting && (
                <button type="button" className="btn btn-outline" onClick={() => void switchToCash()} disabled={switchingToCash}>
                  {switchingToCash ? "Switching to cash…" : "Pay cash at the counter"}
                </button>
              )}
            </div>
          )}
        </section>

        <aside className="card pay-side">
          <h2>Your order</h2>
          <div className="summary-items">
            {order?.items?.map((item) => (
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
            {!order &&
              cartItems.map((item) => (
                <div className="summary-item" key={item.key}>
                  <div className="summary-item-main">
                    <div className="summary-item-name">
                      {item.quantity} × {item.name}
                    </div>
                    <div className="summary-item-meta">
                      {[
                        item.variant?.name,
                        item.sugarLevel ? `Sugar ${item.sugarLevel}` : null,
                        ...item.extras.map((extra) => extra.name),
                      ]
                        .filter(Boolean)
                        .join(" · ") || item.category}
                    </div>
                  </div>
                  <div className="summary-item-price">
                    {peso(item.unitPrice * item.quantity)}
                  </div>
                </div>
              ))}
          </div>
          <div className="summary-totals">
            {balancePayment && order ? (
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
            ) : order ? (
              <>
                <div className="totals-row">
                  <span>
                    Subtotal
                    {Number(order.vat_amount || 0) > 0
                      ? ` (includes ${Number(order.vat_rate_pct || 0)}% VAT)`
                      : ""}
                  </span>
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
                {Number(order.rounding_adjustment || 0) !== 0 && (
                  <div className="totals-row">
                    <span>Rounding</span>
                    <span>
                      {Number(order.rounding_adjustment) > 0 ? "+" : "−"}
                      {peso(Math.abs(Number(order.rounding_adjustment)))}
                    </span>
                  </div>
                )}
                <div className="totals-row total">
                  <span>Total</span>
                  <span>{peso(order.total)}</span>
                </div>
                {Number(order.vat_amount || 0) > 0 && (
                  <div className="totals-row">
                    <span>VAT included</span>
                    <span>{peso(order.vat_amount || 0)}</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="totals-row">
                  <span>
                    Subtotal
                    {Number(checkoutQuote?.vat_amount || 0) > 0
                      ? ` (includes ${Number(checkoutQuote?.vat_rate_pct || 0)}% VAT)`
                      : ""}
                  </span>
                  <span>{peso(checkoutQuote?.subtotal || 0)}</span>
                </div>
                <div className="totals-row">
                  <span>Service charge</span>
                  <span>{peso(checkoutQuote?.service_charge || 0)}</span>
                </div>
                {Number(checkoutQuote?.rounding_adjustment || 0) !== 0 && (
                  <div className="totals-row">
                    <span>Rounding</span>
                    <span>
                      {Number(checkoutQuote?.rounding_adjustment) > 0 ? "+" : "−"}
                      {peso(Math.abs(Number(checkoutQuote?.rounding_adjustment)))}
                    </span>
                  </div>
                )}
                <div className="totals-row total">
                  <span>Total</span>
                  <span>{peso(amountDue)}</span>
                </div>
                {Number(checkoutQuote?.vat_amount || 0) > 0 && (
                  <div className="totals-row">
                    <span>VAT included</span>
                    <span>{peso(checkoutQuote?.vat_amount || 0)}</span>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="status-confirm-number">
            <span>{orderTypeLabel(displayOrderType)}</span>
            <b>Table {String(order?.table_number || initialTable).padStart(2, "0")}</b>
          </div>
          <div className="help-card">
            <h3>Need a hand?</h3>
            <p>Call a waiter if you need help with GCash or your order.</p>
            <Link
              href={
                order
                  ? `/customer/waiter?table=${initialTable}&order=${order.id}`
                  : `/customer/waiter?table=${initialTable}`
              }
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
