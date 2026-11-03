"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { staffNav } from "@/components/portalNav";
import { Icon } from "@/components/Icons";
import { useFeedback } from "@/components/Feedback";
import type {
  Addon,
  MenuItem,
  Order,
  OrderItem,
  OrderStatus,
  WaiterRequest,
} from "@/lib/types";
import {
  clockTime,
  elapsedSince,
  fullDate,
  orderTypeLabel,
  peso,
  relativeTime,
  smartDateTime,
} from "@/lib/format";
import { orderItemMeta } from "@/lib/orderItems";
import { usePolling } from "@/lib/usePolling";

const ACTIVE: OrderStatus[] = [
  "confirmed",
  "preparing",
  "ready",
];

const PREP_OPTIONS = [5, 10, 15, 20, 30];

type TabKey = "all" | "preparing" | "ready" | "done";

const tabs: { key: TabKey; label: string }[] = [
  { key: "all", label: "All active" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
  { key: "done", label: "Completed" },
];

function code(order: Order) {
  return `#${String(order.id).padStart(3, "0")}`;
}

function paymentLabel(order: Order) {
  const method = order.payment_method === "gcash" ? "GCash" : "Counter";
  const pendingBalance = (order.balance_payments || []).some(
    (payment) => payment.status === "pending"
  );
  const status =
    order.payment_status === "verified"
      ? pendingBalance
        ? "added payment under review"
        : Number(order.balance_due || 0) > 0
          ? "balance due"
          : "paid"
      : order.payment_status === "rejected"
        ? "rejected"
        : "unpaid";
  return `${method} · ${status}`;
}

function paymentBadgeClass(order: Order) {
  if (
    order.payment_status === "verified" &&
    Number(order.balance_due || 0) <= 0 &&
    !(order.balance_payments || []).some((payment) => payment.status === "pending")
  ) {
    return "badge-green";
  }
  if (order.payment_status === "verified") return "badge-amber";
  if (order.payment_status === "rejected") return "badge-red";
  return order.payment_method === "gcash" ? "badge-blue" : "badge-amber";
}

function canAddCharges(order: Order) {
  return (
    ["pending", "payment_pending", "confirmed", "preparing"].includes(order.status) &&
    !(order.balance_payments || []).some((payment) => payment.status === "pending") &&
    !(
      order.payment_method === "gcash" &&
      order.payment_status === "pending" &&
      order.payment_proof_url
    )
  );
}

function canAddMenuItem(order: Order) {
  return (
    ["pending", "payment_pending"].includes(order.status) &&
    order.payment_status !== "verified" &&
    !(order.balance_payments || []).some((payment) => payment.status === "pending") &&
    !(
      order.payment_method === "gcash" &&
      order.payment_status === "pending" &&
      order.payment_proof_url
    )
  );
}

function dateValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function preparingMinutes(order: Order): number | null {
  const startedAt = dateValue(order.updated_at || order.created_at);
  return startedAt === null
    ? null
    : Math.floor((Date.now() - startedAt) / 60000);
}

function isOverduePreparingOrder(order: Order): boolean {
  return (
    order.status === "preparing" &&
    (preparingMinutes(order) ?? 0) > 60
  );
}

function isEtaExpired(order: Order): boolean {
  const eta = dateValue(order.estimated_ready_at);
  return order.status === "preparing" && eta !== null && eta < Date.now();
}

function prepReminder(order: Order) {
  const overdue = isOverduePreparingOrder(order);
  const etaExpired = isEtaExpired(order);
  if (!overdue && !etaExpired) return null;
  const elapsed = preparingMinutes(order);
  return (
    <>
      {overdue && (
        <span>
          Preparing for over 1 hour{elapsed !== null ? ` · ${elapsed} min` : ""}.
        </span>
      )}
      {overdue && etaExpired && " "}
      {etaExpired && <span>ETA passed — check whether this has been served.</span>}
      {!etaExpired && overdue && <span>Check progress and mark served when ready.</span>}
    </>
  );
}

function readyClock(minutes: string) {
  const date = new Date(Date.now() + (Number(minutes) || 0) * 60000);
  return date.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function StaffBoardClient() {
  const feedback = useFeedback();
  const [orders, setOrders] = useState<Order[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [waiterRequests, setWaiterRequests] = useState<WaiterRequest[]>([]);
  const [stats, setStats] = useState({
    orders: 0,
    revenue: 0,
    preparing: 0,
    ready: 0,
    awaiting: 0,
  });
  const [tab, setTab] = useState<TabKey>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyFollowUpId, setBusyFollowUpId] = useState<number | null>(null);

  // Full order view, payment review, add-on picker and ETA state.
  const [detail, setDetail] = useState<Order | null>(null);
  const [accepting, setAccepting] = useState<Order | null>(null);
  const [prepMinutes, setPrepMinutes] = useState("15");
  const [counterCashEntry, setCounterCashEntry] = useState<{
    orderId: number;
    value: string;
  } | null>(null);
  const [etaDraft, setEtaDraft] = useState("15");
  const [addonTarget, setAddonTarget] = useState<{
    order: Order;
    item: OrderItem;
  } | null>(null);
  const [addonReturnToAccept, setAddonReturnToAccept] = useState(false);
  const [addonId, setAddonId] = useState("");
  const [addonQty, setAddonQty] = useState("1");
  const [itemTarget, setItemTarget] = useState<Order | null>(null);
  const [itemReturnToAccept, setItemReturnToAccept] = useState(false);
  const [itemEditTarget, setItemEditTarget] = useState<OrderItem | null>(null);
  const [menuItemId, setMenuItemId] = useState("");
  const [menuItemQty, setMenuItemQty] = useState("1");
  const [variantIds, setVariantIds] = useState<number[]>([]);
  const [extraIds, setExtraIds] = useState<number[]>([]);
  const [itemSugarLevel, setItemSugarLevel] = useState("");
  const [itemNote, setItemNote] = useState("");
  const counterCashReceived =
    accepting && counterCashEntry?.orderId === accepting.id
      ? counterCashEntry.value
      : String(accepting?.total || "");
  const counterCashAmount = Number(counterCashReceived);
  const counterCashIsSufficient =
    Number.isFinite(counterCashAmount) &&
    Boolean(accepting) &&
    counterCashAmount >= Number(accepting?.total || 0);
  const counterCashChange = counterCashIsSufficient
    ? Math.round((counterCashAmount - Number(accepting?.total || 0)) * 100) / 100
    : 0;

  const load = useCallback(async () => {
    try {
      const [ordersRes, addonsRes, menuRes, requestsRes] = await Promise.all([
        fetch("/api/orders?board=1", { cache: "no-store" }),
        fetch("/api/addons", { cache: "no-store" }),
        fetch("/api/menu", { cache: "no-store" }),
        fetch("/api/waiter", { cache: "no-store" }),
      ]);
      const data = await ordersRes.json();
      const addonData = await addonsRes.json();
      const menuData = await menuRes.json();
      const requestsData = await requestsRes.json();
      if (!ordersRes.ok || !data.success) {
        throw new Error(data.error || "Unable to load orders.");
      }
      if (!requestsRes.ok || !requestsData.success) {
        throw new Error(requestsData.error || "Unable to load customer follow-ups.");
      }
      const fresh: Order[] = data.orders || [];
      setOrders(fresh);
      setAddons(addonData.addons || []);
      setMenuItems(menuData.items || []);
      setWaiterRequests(requestsData.requests || []);
      if (data.stats) setStats(data.stats);
      setDetail((current) =>
        current ? fresh.find((order) => order.id === current.id) || current : current
      );
      setAccepting((current) =>
        current ? fresh.find((order) => order.id === current.id) || current : current
      );
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load orders.");
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(load, 10000);

  useEffect(() => {
    if (!detail) return;
    setEtaDraft(String(detail.prep_minutes ?? 15));
    // Only reset when switching to another order, not on every poll update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  const patchOrder = async (
    order: Order,
    payload: {
      status?: OrderStatus;
      payment_status?: string;
      prep_minutes?: number;
      cash_received?: number;
    },
    message: string
  ) => {
    setBusyId(order.id);
    const result = await feedback.run(
      async () => {
        const response = await fetch("/api/orders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: order.id, ...payload }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not update the order.");
        }
        return data;
      },
      {
        loading: {
          title: `Updating ${code(order)}…`,
          message: "Saving the change and refreshing the board.",
        },
        success: (data) => {
          const next: Order = data.order || order;
          return {
            eyebrow: "Order updated",
            title: message,
            message: `Table ${String(
              next.table_number
            ).padStart(2, "0")} · ${paymentLabel(next)}`,
            duration: payload.payment_status === "verified" ? 4200 : 2400,
            details: [
              { label: "Order", value: code(order) },
              { label: "Customer", value: order.customer_name || "Guest" },
              {
                label: "Table",
                value: String(next.table_number).padStart(2, "0"),
              },
              { label: "Status", value: labelFor(next.status) },
              { label: "Payment", value: paymentLabel(next) },
              ...(payload.prep_minutes !== undefined
                ? [
                    {
                      label: "Ready around",
                      value: readyClock(String(payload.prep_minutes)),
                    },
                  ]
                : []),
              ...(payload.cash_received !== undefined
                ? [
                    {
                      label: "Cash received",
                      value: peso(payload.cash_received),
                    },
                    {
                      label: "Change",
                      value: peso(
                        Math.round(
                          (payload.cash_received -
                            Number(next.total || 0)) *
                            100
                        ) / 100
                      ),
                    },
                  ]
                : []),
            ],
          };
        },
      }
    );
    if (result.ok && result.result) {
      const updated = result.result.order as Order | undefined;
      setDetail((current) =>
        current && updated && current.id === updated.id ? updated : current
      );
      setAccepting((current) =>
        current && updated && current.id === updated.id ? updated : current
      );
      await load();
      setBusyId(null);
      return updated;
    }
    setBusyId(null);
    return undefined;
  };

  const updateOrder = async (
    order: Order,
    payload: { status?: OrderStatus; payment_status?: string }
  ) => {
    const message =
      payload.payment_status === "rejected"
        ? `Payment for ${code(order)} rejected`
        : payload.status
          ? `${code(order)} marked ${labelFor(payload.status).toLowerCase()}`
          : `${code(order)} updated`;
    await patchOrder(order, payload, message);
  };

  const acceptOrder = async () => {
    if (!accepting) return;
    if (
      accepting.payment_method === "counter" &&
      !counterCashIsSufficient
    ) {
      return;
    }
    const minutes = Math.min(240, Math.max(0, Number(prepMinutes) || 15));
    const updated = await patchOrder(
      accepting,
      {
        payment_status: "verified",
        prep_minutes: minutes,
        ...(accepting.payment_method === "counter"
          ? { cash_received: counterCashAmount }
          : {}),
      },
      `Payment verified · ${code(accepting)} is preparing`
    );
    if (updated) setAccepting(null);
  };

  const rejectPayment = async () => {
    if (!accepting) return;
    const updated = await patchOrder(
      accepting,
      { payment_status: "rejected" },
      `Payment for ${code(accepting)} rejected`
    );
    if (updated) setAccepting(null);
  };

  const saveEta = async (order: Order, minutes: number) => {
    const safe = Math.min(240, Math.max(0, Math.round(minutes) || 0));
    await patchOrder(
      order,
      { prep_minutes: safe },
      `${code(order)} ETA updated`
    );
  };

  const openAddon = (order: Order, item: OrderItem, fromAccept = false) => {
    setDetail(null);
    if (fromAccept) setAccepting(null);
    setAddonReturnToAccept(fromAccept);
    setAddonTarget({ order, item });
    setAddonQty("1");
    setAddonId(addons[0] ? String(addons[0].id) : "");
  };

  const openStaffItem = (
    order: Order,
    fromAccept = false,
    editItem?: OrderItem
  ) => {
    setDetail(null);
    setAccepting(null);
    setItemTarget(order);
    setItemReturnToAccept(fromAccept);
    setItemEditTarget(editItem || null);
    const defaultItem =
      menuItems.find(
        (item) =>
          item.is_active &&
          item.stock_status !== "out" &&
          (!item.stock_tracking_enabled || item.stock_count > 0)
      ) || null;
    const selectedItem = editItem
      ? menuItems.find((item) => item.id === editItem.menu_item_id)
      : defaultItem;
    setMenuItemId(selectedItem ? String(selectedItem.id) : "");
    setMenuItemQty(String(editItem?.quantity || 1));
    setVariantIds(
      editItem && selectedItem
        ? (editItem.variant_name || "")
            .split(" · ")
            .map((name) =>
              selectedItem.variants.find((variant) => variant.name === name)?.id
            )
            .filter((id): id is number => id !== undefined)
        : []
    );
    let savedExtras: { id?: number; name?: string }[] = [];
    if (editItem?.extras) {
      try {
        const parsed: unknown = JSON.parse(editItem.extras);
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
    setExtraIds(
      selectedItem
        ? savedExtras
            .map(
              (extra) =>
                selectedItem.extras.find(
                  (entry) =>
                    entry.id === extra.id ||
                    (!extra.id && entry.name === extra.name)
                )?.id
            )
            .filter((id): id is number => id !== undefined)
        : []
    );
    setItemSugarLevel(editItem?.sugar_level || "");
    setItemNote(editItem?.note || "");
  };

  const selectedMenuItem = menuItems.find(
    (item) => item.id === Number(menuItemId)
  );
  const maxStaffQuantity = (() => {
    if (!selectedMenuItem) return 20;
    if (!selectedMenuItem.stock_tracking_enabled) return 20;
    const reserved =
      itemEditTarget && itemEditTarget.menu_item_id === selectedMenuItem.id
        ? itemEditTarget.quantity
        : 0;
    return Math.max(
      1,
      Math.min(20, selectedMenuItem.stock_count + reserved)
    );
  })();
  const setVariant = (variantId: number, checked: boolean) => {
    const item = selectedMenuItem;
    if (!item) return;
    const variant = item.variants.find((entry) => entry.id === variantId);
    if (!variant) return;
    setVariantIds((current) => {
      const withoutGroup = current.filter((id) => {
        const existing = item.variants.find((entry) => entry.id === id);
        return existing?.variant_type !== variant.variant_type;
      });
      return checked ? [...withoutGroup, variantId] : withoutGroup;
    });
  };

  const submitStaffItem = async () => {
    if (!itemTarget || !menuItemId) return;
    const target = itemTarget;
    const menuItem = menuItems.find((item) => item.id === Number(menuItemId));
    setBusyId(target.id);
    const result = await feedback.run(
      async () => {
        const response = await fetch(
          itemEditTarget
            ? `/api/orders/${target.id}/items/${itemEditTarget.id}`
            : `/api/orders/${target.id}/items`,
          {
          method: itemEditTarget ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            menuItemId: Number(menuItemId),
            quantity: Number(menuItemQty),
            variantIds,
            extraIds,
            sugarLevel: itemSugarLevel || null,
            note: itemNote,
          }),
          }
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(
            data.error ||
              (itemEditTarget
                ? "Could not update the order item."
                : "Could not add the menu item.")
          );
        }
        return data;
      },
      {
        loading: {
          title: itemEditTarget ? "Updating the item…" : "Adding the item…",
          message: itemEditTarget
            ? `Saving the changes to ${code(target)}.`
            : `Putting it on ${code(target)}.`,
        },
        success: (data) => ({
          eyebrow: itemEditTarget ? "Item updated" : "Item added",
          title: itemEditTarget
            ? `${menuItem?.name || "Menu item"} updated on ${code(target)}`
            : `${menuItem?.name || "Menu item"} added to ${code(target)}`,
          message: "The order total, reserved stock, and guest's view are updated.",
          details: [
            { label: "Order", value: code(target) },
            { label: "Item", value: menuItem?.name || "Menu item" },
            { label: "Quantity", value: String(Number(menuItemQty)) },
            ...(variantIds.length
              ? [
                  {
                    label: "Options",
                    value: variantIds
                      .map(
                        (id) =>
                          menuItem?.variants.find((variant) => variant.id === id)?.name
                      )
                      .filter(Boolean)
                      .join(", "),
                  },
                ]
              : []),
            ...(itemSugarLevel
              ? [{ label: "Sugar", value: itemSugarLevel }]
              : []),
            ...(itemNote.trim()
              ? [{ label: "Note", value: itemNote.trim() }]
              : []),
            ...(data.order?.total
              ? [{ label: "New total", value: peso(data.order.total) }]
              : []),
          ],
        }),
      }
    );
    if (result.ok && result.result) {
      setItemTarget(null);
      setItemEditTarget(null);
      await load();
      if (itemReturnToAccept && result.result.order) setAccepting(result.result.order);
      else if (result.result.order) setDetail(result.result.order);
    }
    setBusyId(null);
  };

  const removeStaffItem = async (
    order: Order,
    item: OrderItem,
    fromAccept = false
  ) => {
    setBusyId(order.id);
    const result = await feedback.run(
      async () => {
        const response = await fetch(
          `/api/orders/${order.id}/items/${item.id}`,
          { method: "DELETE" }
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not remove the order item.");
        }
        return data;
      },
      {
        loading: {
          title: "Removing the item…",
          message: `Updating ${code(order)} and restoring its reserved stock.`,
        },
        success: (data) => ({
          eyebrow: "Item removed",
          title: `${item.name} removed from ${code(order)}`,
          message: "The order total and reserved stock have been updated.",
          details: [
            { label: "Order", value: code(order) },
            { label: "Item", value: item.name },
            ...(data.order?.total !== undefined
              ? [{ label: "New total", value: peso(data.order.total) }]
              : []),
          ],
        }),
      }
    );
    if (result.ok && result.result?.order) {
      await load();
      if (fromAccept) setAccepting(result.result.order);
      else setDetail(result.result.order);
    }
    setBusyId(null);
  };

  const collectBalanceAtCounter = async (order: Order) => {
    setBusyId(order.id);
    const result = await feedback.run(
      async () => {
        const response = await fetch(`/api/orders/${order.id}/balance-payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payment_method: "counter" }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not record the counter payment.");
        }
        return data;
      },
      {
        loading: {
          title: "Recording the balance…",
          message: `Collecting the remaining amount for ${code(order)}.`,
        },
        success: (data) => ({
          eyebrow: "Balance collected",
          title: `${code(order)} balance settled`,
          message: "The counter payment is recorded against the order.",
          details: [
            { label: "Order", value: code(order) },
            {
              label: "Collected",
              value: peso(
                Math.max(
                  0,
                  Number(order.balance_due || 0) -
                    Number(data.order?.balance_due ?? order.balance_due ?? 0)
                )
              ),
            },
            {
              label: "Balance due",
              value: peso(data.order?.balance_due ?? 0),
            },
          ],
        }),
      }
    );
    if (result.ok) {
      setDetail(result.result?.order || null);
      await load();
    }
    setBusyId(null);
  };

  const closeItemPicker = () => {
    setItemTarget(null);
    setItemEditTarget(null);
    if (itemReturnToAccept && itemTarget) setAccepting(itemTarget);
  };

  const closeAddonPicker = () => {
    setAddonTarget(null);
    if (addonReturnToAccept && addonTarget) setAccepting(addonTarget.order);
  };

  const submitAddon = async () => {
    if (!addonTarget || !addonId) return;
    const target = addonTarget;
    const addon = addons.find((entry) => entry.id === Number(addonId));
    const quantity = Math.max(1, Number(addonQty) || 1);
    setBusyId(target.order.id);
    const result = await feedback.run(
      async () => {
        const response = await fetch(`/api/orders/${target.order.id}/addons`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderItemId: target.item.id,
            addonId: Number(addonId),
            quantity,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not add the add-on.");
        }
        return data;
      },
      {
        loading: {
          title: "Adding the add-on…",
          message: `Updating ${code(target.order)}.`,
        },
        success: (data) => ({
          eyebrow: "Add-on added",
          title: `${addon?.name || "Add-on"} added to ${code(target.order)}`,
          message: `Added to ${target.item.name}. The order total has been updated.`,
          details: [
            { label: "Order", value: code(target.order) },
            { label: "Item", value: target.item.name },
            { label: "Add-on", value: addon?.name || "Add-on" },
            { label: "Quantity", value: String(quantity) },
            ...(data.order?.total
              ? [{ label: "New total", value: peso(data.order.total) }]
              : []),
          ],
        }),
      }
    );
    if (result.ok && result.result) {
      setAddonTarget(null);
      await load();
      if (addonReturnToAccept && result.result.order) setAccepting(result.result.order);
      else if (result.result.order) setDetail(result.result.order);
    }
    setBusyId(null);
  };

  const filtered = useMemo(() => {
    if (tab === "done") {
      return orders.filter(
        (order) => order.status === "completed" || order.status === "cancelled"
      );
    }
    if (tab === "all") return orders.filter((order) => ACTIVE.includes(order.status));
    return orders.filter((order) => order.status === tab);
  }, [orders, tab]);

  const counts = useMemo(
    () => ({
      all: orders.filter((order) => ACTIVE.includes(order.status)).length,
      preparing: orders.filter((order) => order.status === "preparing").length,
      ready: orders.filter((order) => order.status === "ready").length,
      done: orders.filter(
        (order) => order.status === "completed" || order.status === "cancelled"
      ).length,
    }),
    [orders]
  );

  const followUpRequests = useMemo(
    () =>
      waiterRequests
        .filter(
          (request) =>
            request.request_type === "Order follow-up" &&
            request.status !== "resolved"
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [waiterRequests]
  );
  const boardLanes = useMemo(
    () => [
      {
        key: "preparing",
        title: "Preparing",
        tone: "preparing",
        orders: orders.filter((order) => order.status === "preparing"),
      },
      {
        key: "ready",
        title: "Served · waiting",
        tone: "ready",
        orders: orders.filter((order) => order.status === "ready"),
      },
    ],
    [orders]
  );

  const updateFollowUp = async (
    request: WaiterRequest,
    status: "acknowledged" | "resolved"
  ) => {
    setBusyFollowUpId(request.id);
    const table = String(request.table_number).padStart(2, "0");
    const result = await feedback.run(
      async () => {
        const response = await fetch("/api/waiter", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: request.id, status }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not update follow-up.");
        }
        return data;
      },
      {
        loading: {
          title: status === "resolved" ? "Closing the follow-up…" : "Updating the follow-up…",
          message: `Table ${table} · ${request.request_type}.`,
        },
        success: () => ({
          eyebrow: status === "resolved" ? "Resolved" : "In progress",
          title:
            status === "resolved"
              ? `Table ${table} follow-up resolved`
              : `Following up with table ${table}`,
          message:
            status === "resolved"
              ? "It is cleared from the follow-up list."
              : "The guest can see that someone is on it.",
          duration: 2200,
          details: [
            { label: "Table", value: table },
            { label: "Request", value: request.request_type },
            ...(request.message ? [{ label: "Message", value: request.message }] : []),
          ],
        }),
      }
    );
    if (result.ok) await load();
    setBusyFollowUpId(null);
  };

  const renderFollowUpSidebar = () => (
    <aside className="followup-sidebar">
      <div className="followup-sidebar-head">
        <div>
          <span className="followup-label">Follow-up orders</span>
          <p>Customers who asked for an update</p>
        </div>
        <strong>{followUpRequests.length}</strong>
      </div>
      {followUpRequests.length === 0 ? (
        <div className="followup-empty">
          <Icon name="check-circle" />
          <span>All caught up</span>
          <small>No customers are waiting for an update.</small>
        </div>
      ) : (
        <div className="followup-list">
          {followUpRequests.map((request) => {
            const order = orders.find((entry) => entry.id === request.order_id);
            return (
              <article className="followup-card" key={request.id}>
                <button
                  type="button"
                  className="followup-card-open"
                  onClick={() => order && setDetail(order)}
                  disabled={!order}
                  aria-label={`View order ${request.order_id}`}
                >
                  <span className="followup-card-top">
                    <strong>
                      {request.order_id
                        ? `#${String(request.order_id).padStart(3, "0")}`
                        : "Order"}
                    </strong>
                    <span className={`followup-request-status ${request.status}`}>
                      {request.status === "pending" ? "New" : "In progress"}
                    </span>
                  </span>
                  <span className="followup-card-sub">
                    Table {String(request.table_number).padStart(2, "0")} ·{" "}
                    {relativeTime(request.created_at)}
                  </span>
                  <span className="followup-customer">
                    {order?.customer_name || "Guest"}
                  </span>
                  {request.message && (
                    <span className="followup-request-message">{request.message}</span>
                  )}
                  {order && (
                    <span className="followup-card-sub">
                      {labelFor(order.status)} · {peso(order.total)}
                    </span>
                  )}
                </button>
                <div className="followup-request-actions">
                  {request.status === "pending" && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={busyFollowUpId === request.id}
                      onClick={() => updateFollowUp(request, "acknowledged")}
                    >
                      On my way
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busyFollowUpId === request.id}
                    onClick={() => updateFollowUp(request, "resolved")}
                  >
                    {request.status === "pending" ? "Resolve" : "Done"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </aside>
  );

  const renderActions = (order: Order) => (
    <>
      {(order.status === "pending" || order.status === "payment_pending") && (
        <>
          <Link
            href={`/staff/payments?order=${order.id}`}
            className="btn btn-primary"
          >
            <Icon name="card" className="icon-sm" />
            Review in Payment checks
          </Link>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={busyId === order.id}
            onClick={() => updateOrder(order, { status: "cancelled" })}
          >
            Cancel
          </button>
        </>
      )}
      {order.status === "confirmed" && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={busyId === order.id}
          onClick={() => updateOrder(order, { status: "preparing" })}
        >
          <Icon name="coffee" className="icon-sm" /> Start preparing
        </button>
      )}
      {order.status === "preparing" && (
        <button
          type="button"
          className="btn btn-gold"
          disabled={busyId === order.id}
          onClick={() => updateOrder(order, { status: "ready" })}
        >
          <Icon name="bag" className="icon-sm" /> Mark served
        </button>
      )}
      {order.status === "ready" && (
        <span className="served-waiting-label">
          <Icon name="clock" className="icon-sm" /> Waiting for customer
        </span>
      )}
      {(order.status === "completed" || order.status === "cancelled") && (
        <span className="order-time">
          {order.status === "completed"
            ? order.completion_reason === "system_timeout"
              ? "System automatically completed"
              : `Completed ${relativeTime(order.completed_at)}`
            : order.cancellation_reason === "unpaid_timeout"
              ? "Automatically cancelled · unpaid"
              : "Cancelled"}
        </span>
      )}
    </>
  );

  return (
    <PortalShell
      area="staff"
      title="Every order, in its place."
      subtitle="Live queue board · Keep the counter moving with care."
      contextLabel="Service · Order board"
      contextTitle="Live order queue"
      nav={staffNav}
    >
      {error && <div className="error-strip" style={{ marginBottom: 13 }}>{error}</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">
            <Icon name="receipt" /> Orders today
          </div>
          <div className="stat-value">{stats.orders}</div>
          <div className="stat-bottom">
            <span>{peso(stats.revenue)} in sales</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Icon name="coffee" /> Preparing
          </div>
          <div className="stat-value">{stats.preparing}</div>
          <div className="stat-bottom">
            <span>At the bar</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Icon name="bag" /> Served · awaiting customer
          </div>
          <div className="stat-value">{stats.ready}</div>
          <div className="stat-bottom">
            <span>Call the table</span>
          </div>
        </div>
      </div>

      <div className="section-bar">
        <div>
          <h2>{tab === "all" ? "Order queue" : "Live orders"}</h2>
        </div>
        <div className="flex-row" style={{ gap: 7 }}>
          <Link href="/staff/payments" className="btn btn-outline btn-sm">
            <Icon name="card" className="icon-sm" /> Payments
          </Link>
          <button type="button" className="btn btn-soft btn-sm" onClick={load}>
            <Icon name="refresh" className="icon-sm" /> Refresh
          </button>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 13 }}>
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`tab ${tab === item.key ? "active" : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
            <span className="tab-count">{counts[item.key]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="staff-orders">
          {[1, 2, 3].map((n) => (
            <div className="skeleton" style={{ height: 230 }} key={n} />
          ))}
        </div>
      ) : tab === "all" ? (
        <div className="followup-layout">
          {renderFollowUpSidebar()}
          <div className="followup-main">
          <div className="followup-board">
          {boardLanes.map((lane) => (
            <section className={`followup-lane ${lane.tone}`} key={lane.key}>
              <div className="followup-column-heading">
                <span className={`followup-lane-status ${lane.tone}`}>{lane.title}</span>
                <strong>{String(lane.orders.length).padStart(2, "0")} orders</strong>
              </div>
              {lane.orders.length === 0 ? (
                <div className="followup-lane-empty">No orders here yet.</div>
              ) : (
                <div className="followup-list">
                  {lane.orders.map((order) => (
                    <article className="followup-lane-card" key={order.id}>
                      <div className="followup-lane-identity">
                        <div className="followup-card-top">
                          <strong>{order.queue_number
                            ? `A-${String(order.queue_number).padStart(3, "0")}`
                            : code(order)}
                          </strong>
                          <span className="followup-table-badge">
                            Table {String(order.table_number).padStart(2, "0")}
                          </span>
                        </div>
                        <span className="followup-card-sub">
                          {code(order)} · {elapsedSince(order.created_at)}
                        </span>
                      </div>
                      <div className="followup-lane-items">
                        {(order.items || []).slice(0, 3).map((item) => (
                          <span key={item.id}>{item.quantity}× {item.name}</span>
                        ))}
                        {(order.items || []).length > 3 && (
                          <small>+{(order.items || []).length - 3} more</small>
                        )}
                      </div>
                      {prepReminder(order) && (
                        <div className="order-overdue-warning" role="status">
                          <Icon name="alert" className="icon-sm" />
                          <span>{prepReminder(order)}</span>
                        </div>
                      )}
                      <div className="followup-lane-meta">
                        {order.remarks && (
                          <div className="followup-note">
                            <Icon name="message" />
                            <span>{order.remarks}</span>
                          </div>
                        )}
                        <div className="followup-lane-foot">
                          <strong>{peso(order.total)}</strong>
                          <span>
                            {order.status === "preparing" && order.estimated_ready_at
                              ? `ETA ${clockTime(order.estimated_ready_at)}`
                              : order.status === "ready"
                                ? "Served · awaiting customer"
                                : "Awaiting preparation"}
                          </span>
                        </div>
                      </div>
                      <div className="followup-lane-actions">
                        {renderActions(order)}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setDetail(order)}
                        >
                          Details
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ))}
          </div>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="followup-layout">
          {renderFollowUpSidebar()}
          <div className="followup-main">
            <div className="empty-panel">
              <div className="empty-icon">
                <Icon name="coffee" />
              </div>
              <h3>All caught up.</h3>
              No orders in this view right now.
            </div>
          </div>
        </div>
      ) : (
        <div className="followup-layout">
        {renderFollowUpSidebar()}
        <div className="followup-main">
        <div className="staff-orders">
          {filtered.map((order) => {
            const overdue = isOverduePreparingOrder(order);
            const stale =
              (order.status === "pending" || order.status === "payment_pending") &&
              Date.now() - new Date(order.created_at.replace(" ", "T")).getTime() >
                5 * 60000;
            return (
              <article
                className={`order-card ${
                  order.status === "ready"
                    ? "ready"
                    : overdue || stale
                      ? "urgent"
                      : ""
                }`}
                key={order.id}
              >
                <div className="order-card-top">
                  <span className="order-code">{code(order)}</span>
                  <div className="flex-row" style={{ gap: 6 }}>
                    <span className={`badge ${paymentBadgeClass(order)}`}>
                      {paymentLabel(order)}
                    </span>
                    <button
                      type="button"
                      className="table-icon-btn"
                      title="View full order"
                      onClick={() => setDetail(order)}
                    >
                      <Icon name="eye" />
                    </button>
                  </div>
                </div>
                <div className="order-table-row">
                  <span className="order-table">
                    Table <strong>{String(order.table_number).padStart(2, "0")}</strong> ·{" "}
                    {smartDateTime(order.created_at)}
                  </span>
                  <span className="order-total">{peso(order.total)}</span>
                </div>
                {overdue && (
                  <div className="order-overdue-warning" role="status">
                    <Icon name="alert" className="icon-sm" />
                    <span>{prepReminder(order)}</span>
                  </div>
                )}
                {!overdue && isEtaExpired(order) && (
                  <div className="order-overdue-warning" role="status">
                    <Icon name="alert" className="icon-sm" />
                    <span>{prepReminder(order)}</span>
                  </div>
                )}
                {Number(order.balance_due || 0) > 0 && (
                  <div className="order-time" style={{ marginTop: 4, color: "var(--red)" }}>
                    Additional balance due: <strong>{peso(order.balance_due || 0)}</strong>
                  </div>
                )}
                {order.customer_name && (
                  <div className="order-time" style={{ marginTop: 4 }}>
                    Customer: <strong>{order.customer_name}</strong>
                  </div>
                )}

                <div className="order-items">
                  {(order.items || []).slice(0, 3).map((item) => (
                    <div key={item.id}>
                      <div className="order-item-line">
                        <span>
                          {item.quantity} × {item.name}
                        </span>
                        <span>{peso(item.price_at_time * item.quantity)}</span>
                      </div>
                      {orderItemMeta(item) && (
                        <div className="order-item-sub">{orderItemMeta(item)}</div>
                      )}
                    </div>
                  ))}
                  {(order.items || []).length > 3 && (
                    <div className="order-item-sub">
                      +{(order.items || []).length - 3} more · tap details
                    </div>
                  )}
                </div>

                <div className="flex-between" style={{ marginTop: 8 }}>
                  <span
                    className={`badge ${
                      order.status === "ready"
                        ? "badge-green"
                        : order.status === "preparing"
                          ? "badge-amber"
                          : order.status === "confirmed"
                            ? "badge-sage"
                            : order.status === "completed"
                              ? "badge-cream"
                              : order.status === "cancelled"
                                ? "badge-red"
                                : "badge-blue"
                    }`}
                  >
                    {order.status === "completed" &&
                    order.completion_reason === "system_timeout"
                      ? "System automatically completed"
                      : order.status === "cancelled" &&
                          order.cancellation_reason === "unpaid_timeout"
                        ? "Automatically cancelled"
                        : labelFor(order.status)}
                  </span>
                  <span className="order-time">
                    {order.estimated_ready_at &&
                    !["completed", "cancelled", "ready"].includes(order.status)
                      ? `ETA ${order.prep_minutes || "—"} min · ${clockTime(
                          order.estimated_ready_at
                        )}`
                      : order.queue_number
                        ? `Queue A-${String(order.queue_number).padStart(3, "0")}`
                        : elapsedSince(order.created_at)}
                  </span>
                </div>

                <div className="order-card-foot">
                  {renderActions(order)}
                </div>
                {order.remarks && (
                  <div className="order-time" style={{ marginTop: 7, fontStyle: "italic" }}>
                    “{order.remarks}”
                  </div>
                )}
              </article>
            );
          })}
        </div>
        </div>
        </div>
      )}

      {/* Full order details ------------------------------------------------ */}
      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div
            className="modal order-detail-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h2>Order {code(detail)}</h2>
                <span className="order-time">
                  {detail.status === "completed" &&
                  detail.completion_reason === "system_timeout"
                    ? "System automatically completed"
                    : detail.status === "cancelled" &&
                        detail.cancellation_reason === "unpaid_timeout"
                      ? "Automatically cancelled · no payment recorded"
                      : labelFor(detail.status)}{" "}
                  · {fullDate(detail.created_at)}{" "}
                  {clockTime(detail.created_at)}
                </span>
              </div>
              <button type="button" onClick={() => setDetail(null)} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body">
              {detail.completion_reason === "system_timeout" && (
                <div className="payment-note" role="status" style={{ marginBottom: 13 }}>
                  This order was system automatically completed after remaining ready
                  for 30 minutes without staff action.
                </div>
              )}
              {detail.cancellation_reason === "unpaid_timeout" && (
                <div className="payment-note" role="status" style={{ marginBottom: 13 }}>
                  No cash payment was recorded within 90 minutes. The order was
                  automatically cancelled and removed from the payment queue.
                </div>
              )}
              {prepReminder(detail) && (
                <div className="order-overdue-warning" role="status">
                  <Icon name="alert" className="icon-sm" />
                  <span>{prepReminder(detail)}</span>
                </div>
              )}
              <div className="order-detail-grid">
                <div>
                  <small>Customer</small>
                  <strong>{detail.customer_name || "Name not provided"}</strong>
                </div>
                <div>
                  <small>Table</small>
                  <strong>{String(detail.table_number).padStart(2, "0")}</strong>
                </div>
                <div>
                  <small>Type</small>
                  <strong>{orderTypeLabel(detail.order_type)}</strong>
                </div>
                <div>
                  <small>Payment</small>
                  <strong>{paymentLabel(detail)}</strong>
                </div>
                <div>
                  <small>Queue</small>
                  <strong>
                    {detail.queue_number
                      ? `A-${String(detail.queue_number).padStart(3, "0")}`
                      : "Not assigned"}
                  </strong>
                </div>
                <div>
                  <small>Ordered</small>
                  <strong>
                    {clockTime(detail.created_at)} · {elapsedSince(detail.created_at)} ago
                  </strong>
                </div>
                <div>
                  <small>Prep ETA</small>
                  <strong>
                    {detail.prep_minutes
                      ? `${detail.prep_minutes} min · ${clockTime(detail.estimated_ready_at)}`
                      : "Not set"}
                  </strong>
                </div>
              </div>

              {detail.remarks && (
                <div className="order-guest-note">
                  <Icon name="message" className="icon-sm" />
                  <span>
                    <strong>Customer note:</strong> {detail.remarks}
                  </span>
                </div>
              )}

              {canAddMenuItem(detail) && (
                <button
                  type="button"
                  className="btn btn-soft btn-sm"
                  style={{ marginBottom: 8 }}
                  onClick={() => openStaffItem(detail)}
                >
                  <Icon name="plus" className="icon-sm" /> Add menu item
                </button>
              )}

              <div className="order-detail-items">
                {(detail.items || []).map((item) => (
                  <div className="order-detail-item" key={item.id}>
                    <div className="order-detail-item-top">
                      <strong>
                        {item.quantity} × {item.name}
                      </strong>
                      <span>{peso(item.price_at_time * item.quantity)}</span>
                    </div>
                    {orderItemMeta(item, { includeStaffAddons: false }) && (
                      <div className="order-item-sub">
                        {orderItemMeta(item, { includeStaffAddons: false })}
                      </div>
                    )}
                    {item.note && (
                      <div className="order-detail-note">
                        <Icon name="message" size={11} /> {item.note}
                      </div>
                    )}
                    {canAddMenuItem(detail) && (
                      <div className="flex-row" style={{ gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busyId === detail.id}
                          onClick={() => openStaffItem(detail, false, item)}
                        >
                          <Icon name="edit" className="icon-sm" /> Edit item
                        </button>
                        {(detail.items || []).length > 1 && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busyId === detail.id}
                            onClick={() => void removeStaffItem(detail, item)}
                          >
                            <Icon name="x" className="icon-sm" /> Remove
                          </button>
                        )}
                      </div>
                    )}
                    {(item.addons || []).length > 0 && (
                      <ul className="order-addon-list">
                        {(item.addons || []).map((addon) => (
                          <li key={addon.id}>
                            <span>
                              + {addon.quantity > 1 ? `${addon.quantity} × ` : ""}
                              {addon.name}
                            </span>
                            <span>
                              {peso(addon.price_modifier * addon.quantity)}
                              {addon.added_by_name ? ` · ${addon.added_by_name}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {canAddCharges(detail) && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openAddon(detail, item)}
                      >
                        <Icon name="plus" className="icon-sm" /> Add add-on
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {detail.payment_method === "gcash" && (
                <div className="order-detail-receipt">
                  <div className="flex-between">
                    <strong>GCash receipt</strong>
                    <span className="order-time">
                      Ref {detail.payment_reference || "—"}
                    </span>
                  </div>
                  {detail.payment_proof_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={detail.payment_proof_url}
                      alt={`GCash receipt for order ${detail.id}`}
                    />
                  ) : (
                    <p className="order-time">No receipt uploaded yet.</p>
                  )}
                </div>
              )}

              {detail.payment_method === "counter" && (
                <div className="order-guest-note">
                  <Icon name="card" className="icon-sm" />
                  <span>
                    <strong>Counter payment:</strong> collect {peso(detail.total)} before
                    starting to prepare.
                    {detail.cash_received !== null &&
                      detail.cash_received !== undefined && (
                        <>
                          <br />
                          Received {peso(detail.cash_received)} · change{" "}
                          {peso(detail.change_given || 0)}.
                        </>
                      )}
                  </span>
                </div>
              )}

              <div className="summary-totals" style={{ marginTop: 0, paddingTop: 0 }}>
                <div className="totals-row">
                  <span>Subtotal</span>
                  <span>{peso(detail.subtotal)}</span>
                </div>
                <div className="totals-row">
                  <span>Service charge</span>
                  <span>{peso(detail.service_charge)}</span>
                </div>
                <div className="totals-row total">
                  <span>Total</span>
                  <span>{peso(detail.total)}</span>
                </div>
                {(detail.balance_payments || []).map((payment) => (
                  <div className="totals-row" key={payment.id}>
                    <span>
                      Added {payment.payment_method === "gcash" ? "GCash" : "counter"}{" "}
                      · {payment.status}
                    </span>
                    <span>{peso(payment.amount)}</span>
                  </div>
                ))}
                {Number(detail.balance_due || 0) > 0 && (
                  <div className="totals-row total">
                    <span>Balance due</span>
                    <span>{peso(detail.balance_due || 0)}</span>
                  </div>
                )}
              </div>

              {Number(detail.balance_due || 0) > 0 &&
                detail.payment_status === "verified" &&
                !(detail.balance_payments || []).some(
                  (payment) => payment.status === "pending"
                ) && (
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    disabled={busyId === detail.id}
                    onClick={() => collectBalanceAtCounter(detail)}
                  >
                    <Icon name="card" className="icon-sm" /> Mark{" "}
                    {peso(detail.balance_due || 0)} paid at counter
                  </button>
                )}

              {(detail.balance_payments || []).some(
                (payment) => payment.status === "pending"
              ) && (
                <div className="payment-note">
                  <Icon name="clock" />
                  <span>
                    Additional GCash payment is awaiting review. Order changes and
                    counter settlement are paused until it is reviewed.
                  </span>
                </div>
              )}

              {["confirmed", "preparing"].includes(detail.status) && (
                <div className="eta-editor">
                  <span className="label">Adjust prep time</span>
                  <div className="option-pills">
                    {PREP_OPTIONS.map((minutes) => (
                      <label className="option-pill" key={minutes}>
                        <input
                          type="radio"
                          name={`eta-${detail.id}`}
                          checked={detail.prep_minutes === minutes}
                          onChange={() => saveEta(detail, minutes)}
                        />
                        <span>{minutes} min</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex-row" style={{ gap: 7, marginTop: 3 }}>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={240}
                      value={etaDraft}
                      onChange={(event) => setEtaDraft(event.target.value)}
                      aria-label="Custom preparation time in minutes"
                      style={{ maxWidth: 130 }}
                    />
                    <button
                      type="button"
                      className="btn btn-soft btn-sm"
                      disabled={busyId === detail.id}
                      onClick={() => saveEta(detail, Number(etaDraft))}
                    >
                      Update ETA
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-outline" onClick={() => setDetail(null)}>
                Close
              </button>
              {renderActions(detail)}
            </div>
          </div>
        </div>
      )}

      {/* Accept / verify payment with prep ETA ----------------------------- */}
      {accepting && (
        <div
          className="modal-backdrop order-accept-backdrop"
          onClick={() => setAccepting(null)}
        >
          <div
            className="modal order-accept-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h2>
                  {accepting.payment_method === "gcash"
                    ? "Check payment"
                    : "Accept order"}{" "}
                  {code(accepting)}
                </h2>
                <span className="order-time">
                  {accepting.customer_name || "Name not provided"} · Table{" "}
                  {String(accepting.table_number).padStart(2, "0")} ·{" "}
                  {clockTime(accepting.created_at)} ·{" "}
                  {orderTypeLabel(accepting.order_type)} · {peso(accepting.total)}
                </span>
              </div>
              <button type="button" onClick={() => setAccepting(null)} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <div className="order-accept-body">
              <section className="order-accept-summary">
                <div className="order-accept-panel-heading">
                  <div>
                    <h3>Order details</h3>
                    <p>Customer, items, and instructions</p>
                  </div>
                  {canAddMenuItem(accepting) && (
                    <button
                      type="button"
                      className="btn btn-soft btn-sm"
                      onClick={() => openStaffItem(accepting, true)}
                    >
                      <Icon name="plus" className="icon-sm" /> Add item
                    </button>
                  )}
                  <span
                    className={`badge ${
                      accepting.payment_method === "gcash"
                        ? "badge-blue"
                        : "badge-amber"
                    }`}
                  >
                    {accepting.payment_method === "gcash" ? "GCash" : "Counter"}
                  </span>
                </div>
                <div className="order-accept-facts">
                  <div>
                    <small>Customer</small>
                    <strong>{accepting.customer_name || "Name not provided"}</strong>
                  </div>
                  <div>
                    <small>Table</small>
                    <strong>{String(accepting.table_number).padStart(2, "0")}</strong>
                  </div>
                  <div>
                    <small>Ordered</small>
                    <strong>
                      {clockTime(accepting.created_at)} ·{" "}
                      {elapsedSince(accepting.created_at)} ago
                    </strong>
                  </div>
                  <div>
                    <small>Order type</small>
                    <strong>{orderTypeLabel(accepting.order_type)}</strong>
                  </div>
                </div>
                <div className="order-accept-items">
                  {(accepting.items || []).map((item) => (
                    <div className="order-accept-item" key={item.id}>
                      <div className="order-accept-item-line">
                        <strong>
                          {item.quantity} × {item.name}
                        </strong>
                        <b>{peso(item.price_at_time * item.quantity)}</b>
                      </div>
                      {orderItemMeta(item) && (
                        <span className="order-item-sub">{orderItemMeta(item)}</span>
                      )}
                      {item.note && (
                        <span className="order-detail-note">
                          <Icon name="message" size={11} /> {item.note}
                        </span>
                      )}
                      {canAddMenuItem(accepting) && (
                        <div className="flex-row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => openStaffItem(accepting, true, item)}
                          >
                            <Icon name="edit" className="icon-sm" /> Edit item
                          </button>
                          {(accepting.items || []).length > 1 && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busyId === accepting.id}
                              onClick={() =>
                                void removeStaffItem(accepting, item, true)
                              }
                            >
                              <Icon name="x" className="icon-sm" /> Remove
                            </button>
                          )}
                        </div>
                      )}
                      {canAddCharges(accepting) && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => openAddon(accepting, item, true)}
                        >
                          <Icon name="plus" className="icon-sm" /> Add add-on
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {accepting.remarks && (
                  <div className="order-guest-note">
                    <Icon name="message" className="icon-sm" />
                    <span>
                      <strong>Customer note:</strong> {accepting.remarks}
                    </span>
                  </div>
                )}
                <div className="order-accept-total">
                  <span>Amount due</span>
                  <strong>{peso(accepting.total)}</strong>
                </div>
              </section>

              <section className="order-accept-evidence">
                <div className="order-accept-panel-heading">
                  <div>
                    <h3>
                      {accepting.payment_method === "gcash"
                        ? "Payment evidence"
                        : "Counter payment"}
                    </h3>
                    <p>
                      {accepting.payment_method === "gcash"
                        ? "Check amount and reference before accepting"
                        : "Collect payment from the customer"}
                    </p>
                  </div>
                  {accepting.payment_method === "gcash" && (
                    <Icon name="image" className="icon-sm" />
                  )}
                </div>
                <div className="order-accept-receipt">
                  {accepting.payment_method === "gcash" ? (
                    accepting.payment_proof_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={accepting.payment_proof_url}
                        alt={`GCash receipt for order ${accepting.id}`}
                      />
                    ) : (
                      <div className="order-accept-no-receipt">
                        <Icon name="image" />
                        <strong>Receipt not uploaded</strong>
                        <span>The customer has not attached payment evidence yet.</span>
                      </div>
                    )
                  ) : (
                    <div className="order-accept-counter">
                      <Icon name="card" />
                      <strong>Pay at the counter</strong>
                      <span>Collect {peso(accepting.total)} before accepting.</span>
                    </div>
                  )}
                </div>
                {accepting.payment_method === "gcash" && (
                  <div className="order-accept-reference">
                    <span>Reference number</span>
                    <strong>{accepting.payment_reference || "Not provided"}</strong>
                  </div>
                )}
                {accepting.payment_method === "counter" && (
                  <div className="payment-cash-settlement">
                    <label className="field">
                      <span className="label">Cash received</span>
                      <input
                        className="input"
                        type="number"
                        min={accepting.total}
                        step="0.01"
                        value={counterCashReceived}
                        onChange={(event) =>
                          setCounterCashEntry({
                            orderId: accepting.id,
                            value: event.target.value,
                          })
                        }
                        aria-label="Cash received from customer"
                        placeholder="Enter amount received"
                      />
                    </label>
                    <div className="payment-cash-change">
                      <span>Change to give</span>
                      <strong>
                        {counterCashIsSufficient ? peso(counterCashChange) : "—"}
                      </strong>
                    </div>
                    {!counterCashIsSufficient && (
                      <small>
                        Enter at least {peso(accepting.total)} to continue.
                      </small>
                    )}
                  </div>
                )}
              </section>

              <section className="order-accept-prep">
                <div className="order-accept-panel-heading">
                  <div>
                    <h3>Preparation time</h3>
                    <p>Set an estimated ready time</p>
                  </div>
                  <Icon name="clock" className="icon-sm" />
                </div>
                <div className="order-accept-prep-options">
                  {PREP_OPTIONS.map((minutes) => (
                    <label className="option-pill" key={minutes}>
                      <input
                        type="radio"
                        name="prep-minutes"
                        checked={Number(prepMinutes) === minutes}
                        onChange={() => setPrepMinutes(String(minutes))}
                      />
                      <span>{minutes} min</span>
                    </label>
                  ))}
                  <label className="option-pill">
                    <input
                      type="radio"
                      name="prep-minutes"
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
                    placeholder="Minutes"
                  />
                )}
                <div className="order-accept-ready-time">
                  <Icon name="clock" className="icon-sm" />
                  <span>
                    Ready around <strong>{readyClock(prepMinutes)}</strong>
                  </span>
                </div>
                <div className="order-detail-eta-summary">
                  Accepting confirms payment, assigns the next queue number, and starts
                  the customer&apos;s prep timer.
                </div>
              </section>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-outline" onClick={() => setAccepting(null)}>
                Cancel
              </button>
              {accepting.payment_method === "gcash" && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busyId === accepting.id}
                  onClick={rejectPayment}
                >
                  Reject
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busyId === accepting.id ||
                  (accepting.payment_method === "counter" &&
                    !counterCashIsSufficient) ||
                  (accepting.payment_method === "gcash" &&
                    !accepting.payment_proof_url)
                }
                onClick={acceptOrder}
              >
                <Icon name="check" className="icon-sm" />
                {accepting.payment_method === "gcash"
                  ? "Verify & accept"
                  : "Payment received"}
              </button>
            </div>
          </div>
        </div>
      )}

      {itemTarget && (
        <div className="modal-backdrop" onClick={closeItemPicker}>
          <div
            className="modal"
            style={{ width: "min(100%, 560px)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h2>{itemEditTarget ? "Edit order item" : "Add a menu item"}</h2>
                <span className="order-time">
                  {code(itemTarget)} · {itemTarget.customer_name || "Guest"}
                </span>
              </div>
              <button type="button" onClick={closeItemPicker} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body staff-item-picker">
              <div className="field">
                <label className="label" htmlFor="staff-menu-item">Menu item</label>
                <select
                  id="staff-menu-item"
                  className="select"
                  value={menuItemId}
                  onChange={(event) => {
                    setMenuItemId(event.target.value);
                    setVariantIds([]);
                    setExtraIds([]);
                  }}
                >
                  <option value="">Choose an item</option>
                  {menuItems.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={!item.is_active || item.stock_status === "out"}
                    >
                      {item.name} · {peso(item.price)}
                      {!item.is_active || item.stock_status === "out"
                        ? " · unavailable"
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
              {selectedMenuItem && (
                <>
                  {Array.from(
                    new Set(selectedMenuItem.variants.map((variant) => variant.variant_type))
                  ).map((group) => (
                    <fieldset className="staff-item-options" key={group}>
                      <legend>{group}</legend>
                      <div className="option-pills">
                        {selectedMenuItem.variants
                          .filter((variant) => variant.variant_type === group)
                          .map((variant) => (
                            <label className="option-pill" key={variant.id}>
                              <input
                                type="radio"
                                name={`staff-variant-${group}`}
                                checked={variantIds.includes(variant.id)}
                                onChange={() => setVariant(variant.id, true)}
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
                  {selectedMenuItem.extras.length > 0 && (
                    <fieldset className="staff-item-options">
                      <legend>Extras</legend>
                      <div className="staff-item-extra-list">
                        {selectedMenuItem.extras.map((extra) => (
                          <label key={extra.id}>
                            <input
                              type="checkbox"
                              checked={extraIds.includes(extra.id)}
                              onChange={(event) =>
                                setExtraIds((current) =>
                                  event.target.checked
                                    ? [...current, extra.id]
                                    : current.filter((id) => id !== extra.id)
                                )
                              }
                            />
                            <span>{extra.name}</span>
                            <b>+{peso(extra.price_modifier)}</b>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <div className="field">
                    <label className="label" htmlFor="staff-menu-qty">Quantity</label>
                    <input
                      id="staff-menu-qty"
                      className="input"
                      type="number"
                      min={1}
                      max={maxStaffQuantity}
                      value={menuItemQty}
                      onChange={(event) => setMenuItemQty(event.target.value)}
                    />
                    {selectedMenuItem?.stock_tracking_enabled && (
                      <small className="muted">
                        {selectedMenuItem.stock_count} left on hand
                        {itemEditTarget?.menu_item_id === selectedMenuItem.id
                          ? ` · ${itemEditTarget.quantity} already on this order`
                          : ""}
                      </small>
                    )}
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="staff-menu-sugar">
                      Sugar level
                    </label>
                    <select
                      id="staff-menu-sugar"
                      className="select"
                      value={itemSugarLevel}
                      onChange={(event) => setItemSugarLevel(event.target.value)}
                    >
                      <option value="">No preference</option>
                      {["0%", "25%", "50%", "75%", "100%"].map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="staff-menu-note">
                      Customer note <span className="muted">(optional)</span>
                    </label>
                    <textarea
                      id="staff-menu-note"
                      className="input"
                      value={itemNote}
                      maxLength={180}
                      rows={3}
                      onChange={(event) => setItemNote(event.target.value)}
                      placeholder="Preparation changes or customer requests"
                    />
                  </div>
                  <div className="payment-note">
                    <Icon name="info" />
                    <span>
                      {itemEditTarget
                        ? "Changes update the item, order total, and reserved stock."
                        : "Added items are charged to the order balance; previous GCash payments remain recorded separately."}
                    </span>
                  </div>
                </>
              )}
              {menuItems.length === 0 && (
                <div className="empty-panel" style={{ border: 0 }}>
                  No menu items are available right now.
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-outline"
                onClick={closeItemPicker}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  !selectedMenuItem ||
                  !selectedMenuItem.is_active ||
                  (!itemEditTarget &&
                    (selectedMenuItem.stock_status === "out" ||
                      (selectedMenuItem.stock_tracking_enabled &&
                        selectedMenuItem.stock_count <= 0))) ||
                  !Number.isInteger(Number(menuItemQty)) ||
                  Number(menuItemQty) < 1 ||
                  Number(menuItemQty) > maxStaffQuantity ||
                  busyId === itemTarget.id
                }
                onClick={submitStaffItem}
              >
                <Icon
                  name={itemEditTarget ? "check" : "plus"}
                  className="icon-sm"
                />{" "}
                {itemEditTarget ? "Save changes" : "Add to order"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Staff-added add-on ------------------------------------------------ */}
      {addonTarget && (
        <div className="modal-backdrop" onClick={closeAddonPicker}>
          <div
            className="modal"
            style={{ width: "min(100%, 430px)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h2>Add an add-on</h2>
                <span className="order-time">
                  {code(addonTarget.order)} · {addonTarget.item.name}
                </span>
              </div>
              <button type="button" onClick={closeAddonPicker} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body">
              {addons.length === 0 ? (
                <div className="empty-panel" style={{ border: 0 }}>
                  No add-ons in the catalog yet. An admin can add them under Admin →
                  Menu → Add-ons.
                </div>
              ) : (
                <>
                  <div className="field">
                    <label className="label" htmlFor="staff-addon">Add-on</label>
                    <select
                      id="staff-addon"
                      className="select"
                      value={addonId}
                      onChange={(event) => setAddonId(event.target.value)}
                    >
                      {addons.map((addon) => (
                        <option key={addon.id} value={addon.id}>
                          {addon.name} · +{peso(addon.price_modifier)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="staff-addon-qty">Quantity</label>
                    <input
                      id="staff-addon-qty"
                      className="input"
                      type="number"
                      min={1}
                      max={20}
                      value={addonQty}
                      onChange={(event) => setAddonQty(event.target.value)}
                    />
                  </div>
                  <div className="payment-note" style={{ marginTop: 0 }}>
                    <Icon name="info" />
                    <span>
                      This records who added it, updates the order total, and shows on the
                      guest&apos;s receipt. Add-ons can be added before the order is ready.
                    </span>
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-outline" onClick={closeAddonPicker}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!addonId || busyId === addonTarget.order.id}
                onClick={submitAddon}
              >
                <Icon name="plus" className="icon-sm" /> Add to order
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalShell>
  );
}

export function labelFor(status: OrderStatus) {
  switch (status) {
    case "pending":
      return "Payment pending";
    case "payment_pending":
      return "Payment pending";
    case "confirmed":
      return "Confirmed";
    case "preparing":
      return "Preparing";
    case "ready":
      return "Ready";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}
