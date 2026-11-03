import { getUser } from "@/lib/auth";
import {
  MenuItemModel,
  OrderModel,
  ReviewModel,
  WaiterRequestModel,
} from "@/lib/models";
import type { Order, Review } from "@/lib/types";

type PortalNotification = {
  id: string;
  kind: "payment" | "preparing" | "stock" | "review" | "waiter";
  title: string;
  message: string;
  href: string;
  read: boolean;
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function orderCode(order: Order) {
  return `#${String(order.id).padStart(3, "0")}`;
}

function needsPaymentReview(order: Order) {
  return (
    order.payment_status === "pending" &&
    (order.status === "payment_pending" ||
      (order.payment_method === "counter" && order.status === "pending"))
  );
}

function reviewNotification(review: Review) {
  return {
    id: `admin-review-${review.id}`,
    kind: "review" as const,
    title: review.rating <= 2 ? "Low-rated customer review" : "Recent customer review",
    message: `${review.rating} star${review.rating === 1 ? "" : "s"} · Table ${String(review.table_number).padStart(2, "0")}`,
    href: "/admin/reviews",
  };
}

export async function GET(request: Request) {
  const user = await getUser(request);
  if (!user || !["staff", "admin"].includes(user.role)) {
    return Response.json(
      { error: "Please sign in to continue.", success: false },
      { status: 401 }
    );
  }

  const entries: Omit<PortalNotification, "read">[] = [];

  if (user.role === "admin") {
    for (const item of MenuItemModel.stockAlerts(10)) {
      entries.push({
        id: `admin-stock-${item.id}`,
        kind: "stock",
        title: item.stock_status === "out" ? "Menu item sold out" : "Menu item low",
        message:
          item.stock_status === "out"
            ? item.name
            : `${item.name} · ${item.stock_count} remaining`,
        href: "/admin/menu",
      });
    }

    for (const review of ReviewModel.all(5)) {
      entries.push(reviewNotification(review));
    }
  } else {
    OrderModel.autoCancelUnpaidCounterOrders();
    const now = Date.now();

    for (const order of OrderModel.pendingPayments().filter(needsPaymentReview)) {
      entries.push({
        id: `payment-${order.id}`,
        kind: "payment",
        title: "Payment needs review",
        message: `${orderCode(order)} · Table ${String(order.table_number).padStart(2, "0")}`,
        href: `/staff/payments?order=${order.id}`,
      });
    }

    for (const payment of OrderModel.pendingBalancePayments()) {
      entries.push({
        id: `balance-payment-${payment.id}`,
        kind: "payment",
        title: "Additional payment needs review",
        message: `${orderCode(payment.order)} · Table ${String(payment.order.table_number).padStart(2, "0")}`,
        href: `/staff/payments?order=${payment.order_id}`,
      });
    }

    for (const order of OrderModel.list(["preparing"], 500)) {
      const prepStartedAt = parseDate(order.updated_at || order.created_at);
      const eta = parseDate(order.estimated_ready_at);
      const minutesPreparing = prepStartedAt
        ? Math.floor((now - prepStartedAt.getTime()) / 60000)
        : 0;
      const etaExpired = Boolean(eta && eta.getTime() < now);
      if (minutesPreparing <= 60 && !etaExpired) continue;

      entries.push({
        id: etaExpired ? `preparing-eta-${order.id}` : `preparing-${order.id}`,
        kind: "preparing",
        title: etaExpired ? "Preparation ETA has passed" : "Order preparing over 1 hour",
        message: `${orderCode(order)} · Table ${String(order.table_number).padStart(2, "0")}${
          minutesPreparing > 60 ? ` · ${minutesPreparing} min preparing` : ""
        }`,
        href: "/staff",
      });
    }

    for (const order of OrderModel.recentUnpaidTimeoutCancellations()) {
      const cancellationDate = order.cancelled_at?.slice(0, 10);
      entries.push({
        id: `unpaid-cancelled-${order.id}`,
        kind: "payment",
        title: "Cash order automatically cancelled",
        message: `${orderCode(order)} · Table ${String(order.table_number).padStart(2, "0")} · No payment recorded within 90 minutes`,
        href: `/staff/payments?tab=verified${
          cancellationDate ? `&date=${cancellationDate}` : ""
        }#auto-cancelled`,
      });
    }

    WaiterRequestModel.resolveAcknowledgedOlderThan(25);
    for (const request of WaiterRequestModel.list("pending")) {
      const followUp = request.request_type === "Order follow-up";
      entries.push({
        id: `waiter-${request.id}`,
        kind: "waiter",
        title: followUp ? "Order follow-up requested" : "Waiter called",
        message: `Table ${String(request.table_number).padStart(2, "0")} · ${
          request.request_type
        }${request.message ? ` · ${request.message.slice(0, 60)}` : ""}`,
        href: "/staff/requests",
      });
    }
  }

  const readIds = new Set(OrderModel.notificationReads(user.id));
  const notifications: PortalNotification[] = entries
    .map((entry) => ({ ...entry, read: readIds.has(entry.id) }))
    .sort((first, second) => Number(first.read) - Number(second.read));

  return Response.json({ notifications, success: true });
}

export async function PATCH(request: Request) {
  const user = await getUser(request);
  if (!user || !["staff", "admin"].includes(user.role)) {
    return Response.json(
      { error: "Please sign in to continue.", success: false },
      { status: 401 }
    );
  }

  let body: { id?: unknown; ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "A valid notification ID is required.", success: false },
      { status: 400 }
    );
  }
  const validPattern =
    user.role === "admin"
      ? /^admin-(stock|review)-\d+$/
      : /^(payment|balance-payment|preparing-eta|preparing|unpaid-cancelled|waiter)-\d+$/;
  const rawIds = Array.isArray(body.ids) ? body.ids : [body.id];
  const ids = rawIds.filter(
    (value): value is string => typeof value === "string" && validPattern.test(value)
  );
  if (ids.length === 0 || ids.length > 200) {
    return Response.json(
      { error: "A valid notification ID is required.", success: false },
      { status: 400 }
    );
  }

  OrderModel.markNotificationsRead(user.id, ids);
  return Response.json({ success: true, count: ids.length });
}
