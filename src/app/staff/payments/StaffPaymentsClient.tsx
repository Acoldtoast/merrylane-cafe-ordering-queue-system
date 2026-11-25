"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icons";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import { useFeedback } from "@/components/Feedback";
import type {
  MenuItem,
  Order,
  OrderBalancePayment,
  OrderItem,
} from "@/lib/types";
import {
  calculateOrderDiscounts,
  type DiscountRecipient,
  type DiscountType,
} from "@/lib/orderDiscount";
import { orderTypeLabel, peso, relativeTime, smartDateTime } from "@/lib/format";
import { orderItemMeta } from "@/lib/orderItems";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { usePolling } from "@/lib/usePolling";
import { needsPaymentReview } from "@/lib/orderLifecycle";

const PREP_OPTIONS = [5, 10, 15, 20, 30];

function readyClock(minutes: string) {
  const date = new Date(Date.now() + (Number(minutes) || 0) * 60000);
  return date.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function discountTypeLabel(type: DiscountType) {
  return {
    staff: "Staff",
    senior: "Senior citizen",
    pwd: "PWD",
    other: "Other ID",
  }[type];
}

export function StaffPaymentsClient() {
  const feedback = useFeedback();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [balancePayments, setBalancePayments] = useState<
    (OrderBalancePayment & { order: Order })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Order | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<OrderItem | null>(null);
  const [prepMinutes, setPrepMinutes] = useState("15");
  const [cashReceived, setCashReceived] = useState<string | null>(null);
  const [discountEditorOpen, setDiscountEditorOpen] = useState(false);
  const [discountRecipients, setDiscountRecipients] = useState<DiscountRecipient[]>([]);
  const [staffAccounts, setStaffAccounts] = useState<
    { id: number; name: string; username: string }[]
  >([]);
  const [itemEditor, setItemEditor] = useState<{
    item: OrderItem | null;
    menuItemId: string;
    quantity: string;
    variantIds: number[];
    extraIds: number[];
    menuSearch: string;
    sugarLevel: string;
    note: string;
    savedValues: string;
  } | null>(null);
  const load = useCallback(async () => {
    try {
      const [pendingRes, balanceRes, menuRes] = await Promise.all([
        fetchPortalApi("/api/orders?status=payment_pending,pending", { cache: "no-store" }),
        fetchPortalApi("/api/order-balance-payments", { cache: "no-store" }),
        fetchPortalApi("/api/menu", { cache: "no-store" }),
      ]);
      const pending = await pendingRes.json();
      const balanceData = await balanceRes.json();
      const menuData = await menuRes.json();
      if (!pendingRes.ok || !pending.success) {
        throw new Error(pending.error || "Unable to load payments.");
      }
      if (!balanceRes.ok || !balanceData.success) {
        throw new Error(balanceData.error || "Unable to load additional balance receipts.");
      }
      setBalancePayments(balanceData.payments || []);
      if (!menuRes.ok || !menuData.success) {
        throw new Error(menuData.error || "Unable to load menu items.");
      }
      setMenuItems(menuData.items || []);
      const freshPending: Order[] = pending.orders || [];
      setPendingOrders(freshPending);
      setPreview((current) => {
        const requestedOrderId = Number(
          new URLSearchParams(window.location.search).get("order")
        );
        return (
          freshPending.find((order) => order.id === requestedOrderId) ||
          freshPending.find((order) => order.id === current?.id) ||
          freshPending[0] ||
          null
        );
      });
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not review the payment.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPayments = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  usePolling(load, 12000, { resources: ["orders", "payments", "sales"] });

  // The staff list only feeds the discount picker and changes rarely, so it is
  // loaded once per visit (reusing the route prefetch) instead of every poll.
  useEffect(() => {
    let active = true;
    fetchPortalApi("/api/staff/discount-accounts")
      .then(async (response) => {
        const data = await response.json();
        if (active && response.ok && data.success) {
          setStaffAccounts(data.staff || []);
        }
      })
      .catch(() => {
        // The picker falls back to manual ID and name entry.
      });
    return () => {
      active = false;
    };
  }, []);

  const pending = useMemo(
    () => pendingOrders.filter(needsPaymentReview),
    [pendingOrders]
  );

  const gcashCount = pending.filter((order) => order.payment_method === "gcash").length;
  const counterCount = pending.filter((order) => order.payment_method === "counter").length;
  const cashReceivedValue = cashReceived ?? String(preview?.total ?? "");
  const cashReceivedAmount = Number(cashReceivedValue);
  const cashIsSufficient =
    Number.isFinite(cashReceivedAmount) && cashReceivedAmount >= Number(preview?.total || 0);
  const cashChange = cashIsSufficient
    ? Math.round((cashReceivedAmount - Number(preview?.total || 0)) * 100) / 100
    : 0;
  const discountPreview = useMemo(() => {
    if (!preview) return [];
    return calculateOrderDiscounts(
      (preview.items || []).map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unit_price: item.price_at_time,
        category_name:
          menuItems.find((menuItem) => menuItem.id === item.menu_item_id)
            ?.category_name || "",
      })),
      discountRecipients.filter(
        (recipient) => recipient.id_number.trim() && recipient.name.trim()
      )
    );
  }, [discountRecipients, menuItems, preview]);
  const discountPreviewTotal =
    Math.round(
      discountPreview.reduce(
        (sum, discount) => sum + discount.discount_amount,
        0
      ) * 100
    ) / 100;

  const openPreview = (order: Order) => {
    setPrepMinutes(String(order.prep_minutes || 15));
    setCashReceived(
      order.payment_method === "counter" ? String(order.total) : null
    );
    setDiscountRecipients(
      (order.discounts || []).map(({ type, id_number, name }) => ({
        type,
        id_number,
        name,
      }))
    );
    setDiscountEditorOpen(false);
    setPreview(order);
  };

  const canEditItems = (order: Order) =>
    ["pending", "payment_pending"].includes(order.status) &&
    order.payment_status !== "verified" &&
    !(
      order.payment_method === "gcash" &&
      order.payment_status === "pending" &&
      order.payment_proof_url
    ) &&
    !(order.balance_payments || []).some(
      (payment) => payment.status === "pending"
    );

  const defaultVariants = (menuItem: MenuItem) =>
    [...new Set(menuItem.variants.map((variant) => variant.variant_type))]
      .map(
        (type) =>
          menuItem.variants.find((variant) => variant.variant_type === type)?.id
      )
      .filter((id): id is number => id !== undefined);

  const isDrink = (menuItem?: MenuItem) =>
    menuItem?.category_name === "Coffee" ||
    menuItem?.category_name === "Non-Coffee";

  const openItemEditor = (item: OrderItem | null = null) => {
    if (!preview) return;
    const menuItem = item
      ? menuItems.find((candidate) => candidate.id === item.menu_item_id)
      : undefined;
    let savedExtras: { id?: number; name?: string }[] = [];
    if (item?.extras) {
      try {
        const parsed: unknown = JSON.parse(item.extras);
        if (Array.isArray(parsed)) {
          savedExtras = parsed.filter(
            (entry): entry is { id?: number; name?: string } =>
              Boolean(entry) && typeof entry === "object"
          );
        }
      } catch {
        savedExtras = [];
      }
    }
    const savedVariantNames = new Set(
      item?.variant_name?.split(" · ").filter(Boolean) || []
    );
    const selectedVariants = menuItem
      ? [
          ...new Set(
            menuItem.variants.map((variant) => variant.variant_type)
          ),
        ]
          .map(
            (type) =>
              menuItem.variants.find(
                (variant) =>
                  variant.variant_type === type &&
                  savedVariantNames.has(variant.name)
              )?.id ||
              menuItem.variants.find((variant) => variant.variant_type === type)
                ?.id
          )
          .filter((id): id is number => id !== undefined)
      : [];
    const editorValues = {
      item,
      menuItemId: menuItem ? String(menuItem.id) : "",
      quantity: String(item?.quantity || 1),
      variantIds: selectedVariants,
      extraIds: menuItem
        ? savedExtras
            .map(
              (extra) =>
                menuItem.extras.find(
                  (entry) =>
                    entry.id === extra.id ||
                    (!extra.id && entry.name === extra.name)
                )?.id
            )
            .filter((id): id is number => id !== undefined)
        : [],
      sugarLevel: item?.sugar_level || (isDrink(menuItem) ? "50%" : ""),
      note: item?.note || "",
    };
    const savedValues = JSON.stringify({
      menuItemId: editorValues.menuItemId,
      quantity: editorValues.quantity,
      variantIds: editorValues.variantIds,
      extraIds: editorValues.extraIds,
      sugarLevel: editorValues.sugarLevel,
      note: editorValues.note,
    });
    setItemEditor({ ...editorValues, menuSearch: "", savedValues });
  };

  const updatePreviewItem = async () => {
    if (!preview || !itemEditor) return;
    const target = preview;
    const menuItem = menuItems.find(
      (entry) => entry.id === Number(itemEditor.menuItemId)
    );
    if (!menuItem) return;
    setBusyId(target.id);
    setError("");
    try {
      const response = await fetchPortalApi(
        itemEditor.item
          ? `/api/orders/${target.id}/items/${itemEditor.item.id}`
          : `/api/orders/${target.id}/items`,
        {
          method: itemEditor.item ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(itemEditor.item ? {} : { menuItemId: menuItem.id }),
            quantity: Number(itemEditor.quantity),
            variantIds: itemEditor.variantIds,
            extraIds: itemEditor.extraIds,
            sugarLevel: itemEditor.sugarLevel || null,
            note: itemEditor.note,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok || !data.success || !data.order) {
        throw new Error(data.error || "Could not update the order items.");
      }
      setPreview(data.order);
      setPendingOrders((orders) =>
        orders.map((order) => (order.id === target.id ? data.order : order))
      );
      setItemEditor(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update the order items.");
    } finally {
      setBusyId(null);
    }
  };

  const removePreviewItem = async (item: OrderItem) => {
    if (!preview) return;
    const target = preview;
    setBusyId(target.id);
    setError("");
    try {
      const response = await fetchPortalApi(
        `/api/orders/${target.id}/items/${item.id}`,
        { method: "DELETE" }
      );
      const data = await response.json();
      if (!response.ok || !data.success || !data.order) {
        throw new Error(data.error || "Could not remove the order item.");
      }
      setPreview(data.order);
      setPendingOrders((orders) =>
        orders.map((order) => (order.id === target.id ? data.order : order))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not remove the order item.");
    } finally {
      setBusyId(null);
    }
  };

  const applyDiscounts = async () => {
    if (!preview) return;
    const target = preview;
    if (
      discountRecipients.some(
        (recipient) => !recipient.id_number.trim() || !recipient.name.trim()
      )
    ) {
      setError("Choose a staff member, or enter an ID number and name for each discount.");
      return;
    }
    const seenIds = new Set<string>();
    for (const recipient of discountRecipients) {
      const id = recipient.id_number.trim().toLowerCase();
      if (seenIds.has(id)) {
        setError("Each staff member or ID can only be used once on an order.");
        return;
      }
      seenIds.add(id);
    }

    setBusyId(target.id);
    setError("");
    try {
      const response = await fetchPortalApi("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id, discounts: discountRecipients }),
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.order) {
        throw new Error(data.error || "Could not apply the discounts.");
      }
      setPreview(data.order);
      setPendingOrders((orders) =>
        orders.map((order) => (order.id === target.id ? data.order : order))
      );
      if (
        target.payment_method === "counter" &&
        cashReceivedValue === String(target.total)
      ) {
        setCashReceived(String(data.order.total));
      }
      setDiscountRecipients(
        (data.order.discounts || []).map(
          ({ type, id_number, name }: DiscountRecipient) => ({
            type,
            id_number,
            name,
          })
        )
      );
      setDiscountEditorOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not apply the discounts.");
    } finally {
      setBusyId(null);
    }
  };

  const selectedMenuItem = menuItems.find(
    (item) => item.id === Number(itemEditor?.menuItemId)
  );
  const matchingMenuItems = menuItems.filter((item) =>
    `${item.name} ${item.category_name || ""}`
      .toLowerCase()
      .includes(itemEditor?.menuSearch.trim().toLowerCase() || "")
  );
  const editorUnitPrice =
    Number(selectedMenuItem?.price || 0) +
    (selectedMenuItem?.variants
      .filter((variant) => itemEditor?.variantIds.includes(variant.id))
      .reduce((sum, variant) => sum + Number(variant.price_modifier || 0), 0) ||
      0) +
    (selectedMenuItem?.extras
      .filter((extra) => itemEditor?.extraIds.includes(extra.id))
      .reduce((sum, extra) => sum + Number(extra.price_modifier || 0), 0) || 0);
  const itemEditorHasChanges =
    itemEditor?.item !== null &&
    itemEditor?.item !== undefined &&
    JSON.stringify({
      menuItemId: itemEditor.menuItemId,
      quantity: itemEditor.quantity,
      variantIds: itemEditor.variantIds,
      extraIds: itemEditor.extraIds,
      sugarLevel: itemEditor.sugarLevel,
      note: itemEditor.note,
    }) !== itemEditor.savedValues;

  const decide = async (
    order: Order,
    payment_status: "verified" | "rejected",
    tendered?: number
  ) => {
    if (
      payment_status === "rejected" &&
      !(await confirm(
        `Reject the GCash payment for order #${String(
          order.order_number ?? order.id
        ).padStart(
          3,
          "0"
        )}? The customer will be asked to upload a clearer receipt.`
      ))
    ) {
      return;
    }

    const minutes = Math.min(240, Math.max(0, Number(prepMinutes) || 15));
    const nextStatus =
      order.payment_method === "gcash" ? "confirmed" : "preparing";
    setBusyId(order.id);
    setError("");
    const orderCode = `#${String(order.order_number ?? order.id).padStart(3, "0")}`;
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi("/api/orders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: order.id,
            payment_status,
            ...(payment_status === "verified" &&
            order.payment_method === "counter"
              ? { cash_received: tendered }
              : {}),
            ...(payment_status === "verified"
              ? {
                  status: nextStatus,
                  ...(nextStatus === "preparing" ? { prep_minutes: minutes } : {}),
                }
              : {}),
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not update the payment.");
        }
        if (
          payment_status === "verified" &&
          (data.order?.payment_status !== "verified" ||
            data.order?.status !== nextStatus)
        ) {
          throw new Error(
            "The payment update did not reach the expected order status. Refresh and check the order board."
          );
        }
        return data;
      },
      {
        loading: {
          title:
            payment_status === "verified"
              ? "Verifying the payment…"
              : "Rejecting the receipt…",
          message:
            payment_status === "verified"
              ? order.payment_method === "gcash"
                ? "Assigning a queue number. A staff member will start preparation from the order board."
                : "Assigning a queue number and starting preparation."
              : "Asking the customer for a clearer receipt.",
        },
        success: (data) => ({
          eyebrow: payment_status === "verified" ? "Payment verified" : "Receipt rejected",
          title:
            payment_status === "verified"
              ? order.payment_method === "gcash"
                ? `${orderCode} is ready for preparation`
                : `${orderCode} is preparing`
              : `${orderCode} needs a new receipt`,
          message:
            payment_status === "verified"
              ? order.payment_method === "gcash"
                ? "The paid order is on the preparation board. Start preparation there when ready."
                : "The order is on the preparation board and the guest can see the estimate."
              : "The customer will be asked to upload a clearer GCash receipt.",
          duration: payment_status === "verified" ? 4200 : 3200,
          details: [
            { label: "Order", value: orderCode },
            { label: "Customer", value: order.customer_name || "Guest" },
            {
              label: "Table",
              value: String(order.table_number).padStart(2, "0"),
            },
            {
              label: "Payment",
              value: order.payment_method === "gcash" ? "GCash" : "Cash at counter",
            },
            { label: "Amount", value: peso(order.total) },
            ...(payment_status === "verified" &&
            order.payment_method === "counter" &&
            data.order
              ? [
                  {
                    label: "Cash received",
                    value: peso(data.order.cash_received),
                  },
                  {
                    label: "Change",
                    value: peso(data.order.change_given),
                  },
                ]
              : []),
            ...(payment_status === "verified"
              ? [
                  ...(order.payment_method === "counter"
                    ? [
                        {
                          label: "Ready around",
                          value: readyClock(String(minutes)),
                        },
                      ]
                    : []),
                  ...(data?.order?.queue_number
                    ? [
                        {
                          label: "Queue",
                          value: `A-${String(data.order.queue_number).padStart(3, "0")}`,
                        },
                      ]
                    : []),
                ]
              : []),
          ],
        }),
      }
    );
    if (result.ok) {
      setPreview(null);
      await load();
    }
    setBusyId(null);
  };

  const cancelOrder = async (order: Order) => {
    if (
      !(await confirm(
        `Cancel order #${String(
          order.order_number ?? order.id
        ).padStart(3, "0")}? This will remove it from the payment queue.`
      ))
    ) {
      return;
    }

    setBusyId(order.id);
    setError("");
    const orderCode = `#${String(order.order_number ?? order.id).padStart(3, "0")}`;
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi("/api/orders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: order.id, status: "cancelled" }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not cancel the order.");
        }
        return data;
      },
      {
        loading: {
          title: "Cancelling the order…",
          message: `Removing ${orderCode} from the payment queue.`,
        },
        success: () => ({
          eyebrow: "Cancelled",
          title: `${orderCode} cancelled`,
          message: "It is gone from the payment queue. The guest can still see it in their order history.",
          details: [
            { label: "Order", value: orderCode },
            { label: "Customer", value: order.customer_name || "Guest" },
            { label: "Amount", value: peso(order.total) },
          ],
        }),
      }
    );
    if (result.ok) {
      setPreview(null);
      await load();
    }
    setBusyId(null);
  };

  const decideBalance = async (
    payment: OrderBalancePayment & { order: Order },
    status: "verified" | "rejected"
  ) => {
    if (
      status === "rejected" &&
      !(await confirm(
        `Reject the additional GCash receipt for order #${String(
          payment.order_id
        ).padStart(3, "0")}? The outstanding balance will remain due.`
      ))
    ) {
      return;
    }
    setBusyId(payment.order_id);
    setError("");
    const orderCode = `#${String(payment.order_id).padStart(3, "0")}`;
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi("/api/order-balance-payments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: payment.id, status }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not review the additional payment.");
        }
        return data;
      },
      {
        loading: {
          title:
            status === "verified"
              ? "Verifying the balance payment…"
              : "Rejecting the balance receipt…",
          message: `${orderCode} · ${peso(payment.amount)}.`,
        },
        success: () => ({
          eyebrow: status === "verified" ? "Balance paid" : "Receipt rejected",
          title:
            status === "verified"
              ? `${orderCode} balance cleared`
              : `${orderCode} balance still due`,
          message:
            status === "verified"
              ? "The additional GCash payment is recorded against the order."
              : "The customer will be asked for a clearer receipt. The balance stays open.",
          duration: 3600,
          details: [
            { label: "Order", value: orderCode },
            { label: "Amount", value: peso(payment.amount) },
            { label: "Reference", value: payment.payment_reference || "Not provided" },
            {
              label: "Balance after",
              value:
                status === "verified"
                  ? peso(Math.max(0, (payment.order.balance_due || 0) - payment.amount))
                  : peso(payment.order.balance_due || 0),
            },
          ],
        }),
      }
    );
    if (result.ok) await load();
    setBusyId(null);
  };

  if (loading) return <PortalPageSkeleton area="staff" />;

  return (
    <>
      {refreshing && (
        <div className="payment-refresh-screen" role="status" aria-live="polite">
          <span className="spinner" />
          <strong>Refreshing payment checks…</strong>
          <span>Updating pending payments and recent verifications.</span>
        </div>
      )}
      {error && <div className="error-strip" style={{ marginBottom: 13 }}>{error}</div>}

      <div className="payment-review-heading">
        <div className="payment-review-heading-actions">
          <span className="badge badge-amber">
            {pending.length} to review
          </span>
          <span className="payment-review-counts">
            {gcashCount} GCash · {counterCount} counter
          </span>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={refreshPayments}
            disabled={refreshing}
          >
            <Icon
              name="refresh"
              className={`icon-sm${refreshing ? " payment-refresh-icon" : ""}`}
            />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      {balancePayments.length > 0 && (
        <section className="balance-review-section">
          <div className="payment-panel-heading">
            <div>
              <h3>Additional GCash balance receipts</h3>
              <p>These are separate payments for items staff added after the original order.</p>
            </div>
            <span className="payment-queue-total">{balancePayments.length}</span>
          </div>
          <div className="balance-review-list">
            {balancePayments.map((payment) => (
              <article className="balance-review-card" key={payment.id}>
                <div className="balance-review-image">
                  {payment.payment_proof_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={payment.payment_proof_url}
                      alt={`Additional GCash receipt for order ${payment.order_id}`}
                    />
                  ) : (
                    <div className="payment-evidence-empty">
                      <Icon name="image" />
                      <strong>Receipt not attached</strong>
                    </div>
                  )}
                </div>
                <div className="balance-review-details">
                  <div className="flex-between">
                    <div>
                      <span className="eyebrow">
                        {payment.order.customer_name || "Guest"} · Table{" "}
                        {String(payment.order.table_number).padStart(2, "0")}
                      </span>
                      <h4>
                        Order #
                        {String(payment.order.order_number ?? payment.order_id).padStart(3, "0")}
                      </h4>
                    </div>
                    <strong className="balance-review-amount">{peso(payment.amount)}</strong>
                  </div>
                  <div className="balance-review-meta">
                    Submitted {smartDateTime(payment.created_at)} · Ref{" "}
                    {payment.payment_reference || "not provided"}
                  </div>
                  <div className="balance-review-meta">
                    Original order total {peso(payment.order.total)} · current balance{" "}
                    {peso(payment.order.balance_due || 0)}
                  </div>
                  <div className="balance-review-order-items">
                    {(payment.order.items || []).map((item) => (
                      <div key={item.id}>
                        <span>
                          {item.quantity} × {item.name}
                          {orderItemMeta(item) ? ` · ${orderItemMeta(item)}` : ""}
                        </span>
                        <b>{peso(item.price_at_time * item.quantity)}</b>
                        {item.note && (
                          <small>
                            <Icon name="message" size={11} /> {item.note}
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                  {payment.order.remarks && (
                    <div className="payment-customer-note">
                      <Icon name="message" className="icon-sm" />
                      <span>
                        <strong>Customer note</strong>
                        {payment.order.remarks}
                      </span>
                    </div>
                  )}
                  <div className="balance-review-actions">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busyId === payment.order_id}
                      onClick={() => decideBalance(payment, "rejected")}
                    >
                      Reject receipt
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busyId === payment.order_id}
                      onClick={() => decideBalance(payment, "verified")}
                    >
                      <Icon name="check" className="icon-sm" /> Verify additional payment
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {pending.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-icon">
            <Icon name="check-circle" />
          </div>
          <h3>Every payment is checked.</h3>
          New GCash receipts and counter orders will appear here automatically.
        </div>
      ) : (
        <div className="payment-review-workspace">
          <section className="payment-queue-panel">
            <div className="payment-panel-heading">
              <div>
                <h3>Awaiting verification</h3>
                <p>Review the oldest orders first.</p>
              </div>
              <span className="payment-queue-total">{pending.length}</span>
            </div>
            <div className="payment-queue-list">
              {pending.map((order) => (
                <button
                  type="button"
                  className={`payment-queue-item ${
                    preview?.id === order.id ? "selected" : ""
                  }`}
                  key={order.id}
                  aria-pressed={preview?.id === order.id}
                  onClick={() => openPreview(order)}
                >
                  <span className="payment-queue-item-top">
                    <strong>
                      #{String(order.order_number ?? order.id).padStart(3, "0")}
                    </strong>
                    <b>{peso(order.total)}</b>
                  </span>
                  <span className="payment-queue-item-meta">
                    {order.customer_name || "Guest"} · Table{" "}
                    {String(order.table_number).padStart(2, "0")} ·{" "}
                    {smartDateTime(order.created_at)}
                  </span>
                  <span className="payment-queue-item-bottom">
                    <span
                      className={`badge ${
                        order.payment_method === "gcash"
                          ? "badge-blue"
                          : "badge-amber"
                      }`}
                    >
                      {order.payment_method === "gcash"
                        ? order.payment_proof_url
                          ? "GCash proof"
                          : "GCash"
                        : "Cash at counter"}
                    </span>
                    {order.payment_method === "gcash" &&
                      !order.payment_proof_url && (
                        <span className="payment-queue-missing">
                          Receipt needed
                        </span>
                      )}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="payment-evidence-panel">
            <div className="payment-panel-heading">
              <div>
                <h3>
                  {preview?.payment_method === "gcash"
                    ? "Payment evidence"
                    : "Counter payment"}
                </h3>
                <p>
                  {preview?.payment_method === "gcash"
                    ? "Check the customer's receipt."
                    : "Payment is collected by staff."}
                </p>
              </div>
              {preview?.payment_method === "gcash" && (
                <Icon name="image" className="icon-sm" />
              )}
            </div>
            <div className="payment-evidence-canvas">
              {preview?.payment_method === "gcash" ? (
                preview.payment_proof_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="payment-evidence-image"
                    src={preview.payment_proof_url}
                    alt={`GCash payment receipt for order ${preview.id}`}
                  />
                ) : (
                  <div className="payment-evidence-empty">
                    <Icon name="image" />
                    <strong>Receipt not uploaded</strong>
                    <span>Waiting for the customer to send payment evidence.</span>
                  </div>
                )
              ) : (
                <div className="payment-counter-evidence">
                  <span className="payment-counter-icon">
                    <Icon name="card" />
                  </span>
                  <strong>Pay at the counter</strong>
                  <span>Collect {preview ? peso(preview.total) : ""} from the customer.</span>
                </div>
              )}
            </div>
            <div className="payment-evidence-caption">
              {preview?.payment_method === "gcash"
                ? preview.payment_proof_url
                  ? `Receipt attached · Reference ${preview.payment_reference || "not provided"}`
                  : "No receipt has been attached to this order."
                : "Confirm payment in person before marking this order as paid."}
            </div>
          </section>

          {preview && (
            <section className="payment-decision-panel">
              <div className="payment-decision-heading">
                <div>
                  <span className="eyebrow">
                    {preview.customer_name || "Customer"}
                  </span>
                  <h3>#{String(preview.order_number ?? preview.id).padStart(3, "0")}</h3>
                </div>
                <div className="payment-order-heading-actions">
                  {canEditItems(preview) && (
                    <>
                      <button
                        type="button"
                        className="btn btn-soft btn-sm"
                        disabled={busyId === preview.id || menuItems.length === 0}
                        onClick={() => openItemEditor()}
                      >
                        <Icon name="plus" className="icon-sm" /> Add menu
                      </button>
                      <button
                        type="button"
                        className="btn btn-soft btn-sm"
                        disabled={busyId === preview.id}
                        onClick={() => {
                          setDiscountRecipients(
                            preview.discounts?.length
                              ? preview.discounts.map(
                                  ({ type, id_number, name }) => ({
                                    type,
                                    id_number,
                                    name,
                                  })
                                )
                              : [{ type: "senior", id_number: "", name: "" }]
                          );
                          setDiscountEditorOpen(true);
                        }}
                      >
                        <Icon name="plus" className="icon-sm" /> Add discount
                      </button>
                    </>
                  )}
                  <span className="badge badge-amber">Pending</span>
                </div>
              </div>

              <div className="payment-order-meta">
                <span>
                  Table {String(preview.table_number).padStart(2, "0")} / Queue
                </span>
                <strong>
                  {preview.queue_number
                    ? `A-${String(preview.queue_number).padStart(3, "0")}`
                    : orderTypeLabel(preview.order_type)}
                </strong>
              </div>

              {discountEditorOpen && (
                <div className="payment-discount-editor">
                  <div className="payment-discount-heading">
                    <strong>Discounts</strong>
                    <span>
                      20% off one highest-priced meal and one drink per staff
                      member or ID. Coffee and Non-Coffee items count as drinks.
                    </span>
                  </div>
                  {discountRecipients.map((recipient, index) => (
                    <div className="payment-discount-entry" key={index}>
                      <label className="field">
                        <span className="label">Discount type</span>
                        <select
                          className="input"
                          value={recipient.type}
                          onChange={(event) => {
                            const type = event.target.value as DiscountType;
                            setDiscountRecipients((current) =>
                              current.map((entry, entryIndex) => {
                                if (entryIndex !== index) return entry;
                                // Staff names and ID documents are different
                                // kinds of evidence; never carry one across.
                                const switching = type === "staff" || entry.type === "staff";
                                return {
                                  ...entry,
                                  type,
                                  id_number: switching ? "" : entry.id_number,
                                  name: type === "staff" ? "" : entry.name,
                                };
                              })
                            );
                          }}
                        >
                          <option value="staff">Staff</option>
                          <option value="senior">Senior citizen</option>
                          <option value="pwd">PWD</option>
                          <option value="other">Other ID</option>
                        </select>
                      </label>
                      {recipient.type === "staff" && staffAccounts.length > 0 ? (
                        <label className="field">
                          <span className="label">Staff member</span>
                          <select
                            className="input"
                            value={recipient.id_number}
                            onChange={(event) => {
                              const value = event.target.value;
                              const selected = staffAccounts.find(
                                (staff) => staff.username === value
                              );
                              setDiscountRecipients((current) =>
                                current.map((entry, entryIndex) => {
                                  if (entryIndex !== index) return entry;
                                  if (selected) {
                                    return {
                                      ...entry,
                                      id_number: selected.username,
                                      name: selected.name,
                                    };
                                  }
                                  if (value === "") {
                                    return { ...entry, id_number: "", name: "" };
                                  }
                                  // Keep a previously saved (retired) username
                                  // selectable instead of clearing it.
                                  if (value === entry.id_number) return entry;
                                  return entry;
                                })
                              );
                            }}
                          >
                            <option value="">Select staff…</option>
                            {recipient.id_number &&
                              !staffAccounts.some(
                                (staff) => staff.username === recipient.id_number
                              ) && (
                                <option value={recipient.id_number}>
                                  {recipient.name || recipient.id_number} (saved)
                                </option>
                              )}
                            {staffAccounts.map((staff) => (
                              <option key={staff.id} value={staff.username}>
                                {staff.name} ({staff.username})
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <>
                          <label className="field">
                            <span className="label">ID number</span>
                            <input
                              className="input"
                              value={recipient.id_number}
                              maxLength={40}
                              onChange={(event) =>
                                setDiscountRecipients((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? { ...entry, id_number: event.target.value }
                                      : entry
                                  )
                                )
                              }
                              placeholder="Enter ID number"
                            />
                          </label>
                          <label className="field">
                            <span className="label">Name on ID</span>
                            <input
                              className="input"
                              value={recipient.name}
                              maxLength={80}
                              onChange={(event) =>
                                setDiscountRecipients((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? { ...entry, name: event.target.value }
                                      : entry
                                  )
                                )
                              }
                              placeholder="Enter name"
                            />
                          </label>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Remove discount ID ${index + 1}`}
                        onClick={() =>
                          setDiscountRecipients((current) =>
                            current.filter((_, entryIndex) => entryIndex !== index)
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="payment-discount-footer">
                    <span>
                      Estimated discount: {peso(discountPreviewTotal)}
                      {preview.payment_method === "gcash" &&
                        " · Apply before payment; ask the customer to refresh"}
                    </span>
                    <div>
                      <button
                        type="button"
                        className="btn btn-soft btn-sm"
                        disabled={discountRecipients.length >= 10}
                        onClick={() =>
                          setDiscountRecipients((current) => [
                            ...current,
                            { type: "senior", id_number: "", name: "" },
                          ])
                        }
                      >
                        <Icon name="plus" className="icon-sm" /> Add another ID
                      </button>
                      <button
                        type="button"
                        className="btn btn-soft btn-sm"
                        disabled={busyId === preview.id}
                        onClick={() => {
                          setDiscountRecipients(
                            (preview.discounts || []).map(
                              ({ type, id_number, name }) => ({
                                type,
                                id_number,
                                name,
                              })
                            )
                          );
                          setDiscountEditorOpen(false);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={
                          busyId === preview.id ||
                          discountRecipients.some(
                            (recipient) =>
                              !recipient.id_number.trim() || !recipient.name.trim()
                          )
                        }
                        onClick={() => void applyDiscounts()}
                      >
                        Apply discount
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="payment-review-items">
                {(preview.items || []).map((item) => (
                  <div className="payment-review-item" key={item.id}>
                    <span className="payment-review-quantity">{item.quantity}×</span>
                    <div className="payment-review-item-copy">
                      <strong>{item.name}</strong>
                      {orderItemMeta(item) && (
                        <span>{orderItemMeta(item)}</span>
                      )}
                      {item.note && (
                        <span className="payment-review-item-note">
                          <Icon name="message" size={11} /> {item.note}
                        </span>
                      )}
                    </div>
                    <b>{peso(item.price_at_time * item.quantity)}</b>
                    {canEditItems(preview) && (
                      <div className="payment-item-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busyId === preview.id}
                          onClick={() => openItemEditor(item)}
                        >
                          <Icon name="edit" className="icon-sm" /> Edit
                        </button>
                        {(preview.items || []).length > 1 && (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            aria-label={`Remove ${item.name} from order`}
                            title={`Remove ${item.name}`}
                            disabled={busyId === preview.id}
                            onClick={() => setPendingRemoval(item)}
                          >
                            <Icon name="trash" className="icon-sm" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="payment-total-row">
                <strong>Amount due</strong>
                <b>{peso(preview.total)}</b>
              </div>
              {Number(preview.discount_amount || 0) > 0 && (
                <div className="payment-discount-summary">
                  <strong>
                    Discount applied: −{peso(preview.discount_amount || 0)}
                  </strong>
                  {(preview.discounts || []).map((discount) => (
                    <span key={discount.id_number}>
                      {discountTypeLabel(discount.type)} · {discount.name} · ID{" "}
                      {discount.id_number}: −{peso(discount.discount_amount)}
                    </span>
                  ))}
                </div>
              )}
              {preview.payment_method === "counter" && (
                <div className="payment-cash-settlement">
                  <label className="field">
                    <span className="label">Cash received</span>
                    <input
                      className="input"
                      type="number"
                      min={preview.total}
                      step="0.01"
                      value={cashReceivedValue}
                      onChange={(event) => setCashReceived(event.target.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      onBlur={() => {
                        if (!cashReceivedValue.trim()) {
                          setCashReceived(String(preview.total));
                        }
                      }}
                      aria-label="Cash received from customer"
                      placeholder="Enter amount received"
                    />
                  </label>
                  <div className="payment-cash-change">
                    <span>Change to give</span>
                    <strong>{cashIsSufficient ? peso(cashChange) : "—"}</strong>
                  </div>
                  {!cashIsSufficient && (
                    <small>Enter at least {peso(preview.total)} to continue.</small>
                  )}
                </div>
              )}
              {preview.payment_method === "gcash" && (
                <div className="payment-proof-amount">
                  <span>Reference number</span>
                  <strong>{preview.payment_reference || "Not provided"}</strong>
                </div>
              )}

              {preview.payment_method === "gcash" && preview.payment_proof_url && (
                <div className="payment-match-note">
                  <Icon name="check-circle" className="icon-sm" />
                  <span>
                    <strong>Compare amount and reference</strong>
                    <small>Confirm both against the merchant GCash account.</small>
                  </span>
                </div>
              )}

              {preview.remarks && (
                <div className="payment-customer-note">
                  <Icon name="message" className="icon-sm" />
                  <span>
                    <strong>Customer note</strong>
                    {preview.remarks}
                  </span>
                </div>
              )}

              <div className="payment-prep-section">
                <div className="payment-prep-heading">
                  <span>Preparation time</span>
                  <small>Ordered {relativeTime(preview.created_at)}</small>
                </div>
                <div className="payment-prep-options">
                  {PREP_OPTIONS.map((minutes) => (
                    <label className="option-pill" key={minutes}>
                      <input
                        type="radio"
                        name="payment-prep-minutes"
                        checked={Number(prepMinutes) === minutes}
                        onChange={() => setPrepMinutes(String(minutes))}
                      />
                      <span>{minutes} min</span>
                    </label>
                  ))}
                  <label className="option-pill">
                    <input
                      type="radio"
                      name="payment-prep-minutes"
                      checked={!PREP_OPTIONS.includes(Number(prepMinutes))}
                      onChange={() => setPrepMinutes("18")}
                    />
                    <span>Custom</span>
                  </label>
                </div>
                {!PREP_OPTIONS.includes(Number(prepMinutes)) && (
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={240}
                    value={prepMinutes}
                    onChange={(event) => setPrepMinutes(event.target.value)}
                    aria-label="Custom preparation time in minutes"
                    placeholder="Minutes"
                  />
                )}
                <p>
                  Ready around {readyClock(prepMinutes)} · the guest can see this
                  estimate on their order status.
                </p>
              </div>

              <div className="payment-decision-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    busyId === preview.id ||
                    (preview.payment_method === "counter" &&
                      !cashIsSufficient) ||
                    (preview.payment_method === "gcash" &&
                      !preview.payment_proof_url)
                  }
                  title={
                    preview.payment_method === "gcash" &&
                    !preview.payment_proof_url
                      ? "Waiting for the customer to upload a receipt"
                      : undefined
                  }
                  onClick={() =>
                    decide(
                      preview,
                      "verified",
                      preview.payment_method === "counter"
                        ? cashReceivedAmount
                        : undefined
                    )
                  }
                >
                  {busyId === preview.id ? (
                    <>
                      <span className="spinner spinner-light" style={{ width: 15, height: 15 }} />
                      Verifying & starting preparation…
                    </>
                  ) : (
                    <>
                      <Icon name="check" className="icon-sm" />
                      {preview.payment_method === "gcash"
                        ? "Accept payment & prepare"
                        : "Confirm payment & prepare"}
                    </>
                  )}
                </button>
                {preview.payment_method === "gcash" && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busyId === preview.id}
                    onClick={() => decide(preview, "rejected")}
                  >
                    Reject proof
                  </button>
                )}
                <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={busyId === preview.id}
                    onClick={() => cancelOrder(preview)}
                >
                    Cancel order
                </button>
              </div>
              {busyId === preview.id && (
                <div className="payment-processing-banner" role="status" aria-live="polite">
                  <span className="spinner" />
                  <span>
                    <strong>Updating order status</strong>
                    <small>
                      Verifying payment, assigning a queue number, and starting preparation.
                    </small>
                  </span>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {itemEditor && (
        <div className="modal-backdrop">
          <div
            className="modal payment-item-editor"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h2>{itemEditor.item ? "Edit order item" : "Add a menu item"}</h2>
                <span className="order-time">
                  Order #
                  {String(preview?.order_number ?? preview?.id ?? "").padStart(3, "0")} ·{" "}
                  {preview?.customer_name || "Guest"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setItemEditor(null)}
                aria-label="Close"
              >
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body">
              {menuItems.length === 0 ? (
                <div className="empty-panel" style={{ border: 0 }}>
                  No menu items are available.
                </div>
              ) : (
                <>
                  {itemEditor.item || itemEditor.menuItemId ? (
                    <div className="payment-editing-menu-item">
                      <span className="eyebrow">
                        {itemEditor.item ? "Editing this item" : "Selected menu item"}
                      </span>
                      <strong>{selectedMenuItem?.name || itemEditor.item?.name || "Menu item"}</strong>
                      <small>{selectedMenuItem?.description}</small>
                      <span>
                        Base price · {peso(
                          selectedMenuItem?.price ||
                            itemEditor.item?.price_at_time ||
                            0
                        )}
                      </span>
                      {!itemEditor.item && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() =>
                            setItemEditor((current) =>
                              current
                                ? {
                                    ...current,
                                    menuItemId: "",
                                    variantIds: [],
                                    extraIds: [],
                                    sugarLevel: "",
                                    note: "",
                                  }
                                : current
                            )
                          }
                        >
                          Choose a different menu item
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="field">
                        <label className="label" htmlFor="payment-staff-menu-search">
                          Search menu
                        </label>
                        <input
                          id="payment-staff-menu-search"
                          className="input"
                          type="search"
                          value={itemEditor.menuSearch}
                          onChange={(event) =>
                            setItemEditor((current) =>
                              current
                                ? { ...current, menuSearch: event.target.value }
                                : current
                            )
                          }
                          placeholder="Search all menu items"
                        />
                      </div>
                      <div className="payment-menu-picker" aria-label="Menu items">
                        {matchingMenuItems.length === 0 ? (
                          <p className="payment-menu-empty">No matching menu items.</p>
                        ) : (
                          matchingMenuItems.map((menuItem) => {
                            const selected =
                              menuItem.id === Number(itemEditor.menuItemId);
                            const available =
                              Boolean(menuItem.is_active) &&
                              menuItem.stock_status !== "out" &&
                              (!menuItem.stock_tracking_enabled ||
                                menuItem.stock_count >=
                                  Number(itemEditor.quantity));
                            return (
                              <button
                                type="button"
                                className={`payment-menu-option ${
                                  selected ? "selected" : ""
                                }`}
                                key={menuItem.id}
                                aria-pressed={selected}
                                disabled={!available && !selected}
                                onClick={() =>
                                  setItemEditor((current) =>
                                    current
                                      ? {
                                          ...current,
                                          menuItemId: String(menuItem.id),
                                          variantIds: defaultVariants(menuItem),
                                          extraIds: [],
                                          sugarLevel: isDrink(menuItem) ? "50%" : "",
                                          note: "",
                                        }
                                      : current
                                  )
                                }
                              >
                                <span>
                                  <strong>{menuItem.name}</strong>
                                  <small>
                                    {!menuItem.is_active ||
                                    menuItem.stock_status === "out" ||
                                    menuItem.stock_tracking_enabled &&
                                    menuItem.stock_count <= 0
                                      ? "Sold out"
                                      : menuItem.stock_tracking_enabled
                                        ? `${menuItem.stock_count} in stock`
                                        : "Available · quantity not tracked"}
                                  </small>
                                </span>
                                <b>{peso(menuItem.price)}</b>
                              </button>
                            );
                          })
                        )}
                      </div>
                      {selectedMenuItem && (
                        <p className="payment-menu-customize-hint">
                          Customize {selectedMenuItem.name} below before adding it.
                        </p>
                      )}
                    </>
                  )}
                  {selectedMenuItem &&
                    [...new Set(
                      selectedMenuItem.variants.map(
                        (variant) => variant.variant_type
                      )
                    )].map((group) => (
                      <fieldset className="staff-item-options" key={group}>
                        <legend>{group}</legend>
                        <div className="staff-item-variant-list">
                          {selectedMenuItem.variants
                            .filter((variant) => variant.variant_type === group)
                            .map((variant) => (
                              <label className="option-pill" key={variant.id}>
                                <input
                                  type="radio"
                                  name={`payment-staff-variant-${group}`}
                                  checked={itemEditor.variantIds.includes(
                                    variant.id
                                  )}
                                  onChange={() =>
                                    setItemEditor((current) =>
                                      current
                                        ? {
                                            ...current,
                                            variantIds: [
                                              ...current.variantIds.filter(
                                                (id) =>
                                                  !selectedMenuItem.variants.some(
                                                    (entry) =>
                                                      entry.id === id &&
                                                      entry.variant_type === group
                                                  )
                                              ),
                                              variant.id,
                                            ],
                                          }
                                        : current
                                    )
                                  }
                                />
                                <span>
                                  {variant.name}
                                  {Number(variant.price_modifier) !== 0
                                    ? ` · ${Number(variant.price_modifier) > 0 ? "+" : ""}${peso(variant.price_modifier)}`
                                    : ""}
                                </span>
                              </label>
                            ))}
                        </div>
                      </fieldset>
                    ))}
                  {selectedMenuItem?.extras.length ? (
                    <fieldset className="staff-item-options">
                      <legend>Extras</legend>
                      <div className="staff-item-extra-list">
                        {selectedMenuItem.extras.map((extra) => (
                          <label key={extra.id}>
                            <input
                              type="checkbox"
                              checked={itemEditor.extraIds.includes(extra.id)}
                              onChange={(event) =>
                                setItemEditor((current) =>
                                  current
                                    ? {
                                        ...current,
                                        extraIds: event.target.checked
                                          ? [...current.extraIds, extra.id]
                                          : current.extraIds.filter(
                                              (id) => id !== extra.id
                                            ),
                                      }
                                    : current
                                )
                              }
                            />
                            <span>{extra.name}</span>
                            <b>+{peso(extra.price_modifier)}</b>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : null}
                  {selectedMenuItem && <div className="field">
                    <label className="label" htmlFor="payment-staff-item-qty">
                      Quantity
                    </label>
                    <div className="payment-quantity-stepper">
                      <button
                        type="button"
                        aria-label="Decrease quantity"
                        disabled={Number(itemEditor.quantity) <= 1}
                        onClick={() =>
                          setItemEditor((current) =>
                            current
                              ? {
                                  ...current,
                                  quantity: String(
                                    Math.max(1, Number(current.quantity) - 1)
                                  ),
                                }
                              : current
                          )
                        }
                      >
                        <Icon name="minus" className="icon-sm" />
                      </button>
                      <input
                        id="payment-staff-item-qty"
                        className="input"
                        type="number"
                        min={1}
                        max={20}
                        value={itemEditor.quantity}
                        onChange={(event) =>
                          setItemEditor((current) =>
                            current
                              ? { ...current, quantity: event.target.value }
                              : current
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label="Increase quantity"
                        disabled={Number(itemEditor.quantity) >= 20}
                        onClick={() =>
                          setItemEditor((current) =>
                            current
                              ? {
                                  ...current,
                                  quantity: String(
                                    Math.min(20, Number(current.quantity) + 1)
                                  ),
                                }
                              : current
                          )
                        }
                      >
                        <Icon name="plus" className="icon-sm" />
                      </button>
                    </div>
                  </div>}
                  {isDrink(selectedMenuItem) && (
                  <fieldset className="staff-item-options">
                    <legend>Sugar level</legend>
                    <div className="staff-item-variant-list">
                      {["0%", "25%", "50%", "75%", "100%"].map((level) => (
                        <label className="option-pill" key={level}>
                          <input
                            type="radio"
                            name="payment-staff-sugar"
                            checked={itemEditor.sugarLevel === level}
                            onChange={() =>
                              setItemEditor((current) =>
                                current
                                  ? { ...current, sugarLevel: level }
                                  : current
                              )
                            }
                          />
                          <span>{level}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  )}
                  {isDrink(selectedMenuItem) && <div className="field">
                    <label className="label" htmlFor="payment-staff-item-note">
                      Customer note <span className="muted">(optional)</span>
                    </label>
                    <textarea
                      id="payment-staff-item-note"
                      className="input"
                      value={itemEditor.note}
                      maxLength={180}
                      rows={3}
                      onChange={(event) =>
                        setItemEditor((current) =>
                          current
                            ? { ...current, note: event.target.value }
                            : current
                        )
                      }
                      placeholder="Preparation changes or customer requests"
                    />
                  </div>}
                </>
              )}
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setItemEditor(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  !selectedMenuItem ||
                  !selectedMenuItem.is_active ||
                  (!itemEditor.item &&
                    (selectedMenuItem.stock_status === "out" ||
                      (selectedMenuItem.stock_tracking_enabled &&
                        selectedMenuItem.stock_count <
                          Number(itemEditor.quantity)))) ||
                  !Number.isInteger(Number(itemEditor.quantity)) ||
                  Number(itemEditor.quantity) < 1 ||
                  Number(itemEditor.quantity) > 20 ||
                  (itemEditor.item !== null && !itemEditorHasChanges) ||
                  busyId === preview?.id
                }
                onClick={() => void updatePreviewItem()}
              >
                <Icon
                  name={itemEditor.item ? "check" : "plus"}
                  className="icon-sm"
                />{" "}
                {itemEditor.item
                  ? `Save changes · ${peso(editorUnitPrice * Number(itemEditor.quantity))}`
                  : `Add to order · ${peso(editorUnitPrice * Number(itemEditor.quantity))}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRemoval && preview && (
        <div className="feedback-layer">
          <div
            className="feedback-card is-shaking payment-remove-confirm-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="payment-remove-title"
            aria-describedby="payment-remove-message"
            data-tone="warning"
          >
            <div className="feedback-medallion" aria-hidden="true">
              <Icon name="alert" size={22} />
            </div>
            <span className="feedback-eyebrow">Remove order item</span>
            <h2
              id="payment-remove-title"
              className="feedback-title"
            >
              Are you sure?
            </h2>
            <p
              id="payment-remove-message"
              className="feedback-message"
            >
              Remove {pendingRemoval.quantity} × {pendingRemoval.name} from order #
              {String(preview.order_number ?? preview.id).padStart(3, "0")}? This cannot be undone.
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
                disabled={busyId === preview.id}
                onClick={() => {
                  const item = pendingRemoval;
                  setPendingRemoval(null);
                  void removePreviewItem(item);
                }}
              >
                <Icon name="trash" className="icon-sm" /> Remove item
              </button>
            </div>
          </div>
        </div>
      )}

    {confirmDialog}
    </>
  );
}
