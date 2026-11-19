import { getUser } from "@/lib/auth";
import {
  MenuItemModel,
  OrderModel,
  ReviewModel,
  WaiterRequestModel,
} from "@/lib/models";
import {
  needsPaymentReview,
  preparationEtaHasPassed,
  preparationMinutesElapsed,
  preparationReminderLevel,
  readyMinutesElapsed,
  readyReminderLevel,
} from "@/lib/orderLifecycle";
import type { Order, Review } from "@/lib/types";
import { countStaffWork } from "@/lib/staffWorkCounts";

let lastAutoCancelAt = 0;

type PortalNotification = {
  id: string;
  kind: "payment" | "preparing" | "stock" | "review" | "waiter";
  title: string;
  message: string;
  href: string;
  read: boolean;
};

function orderCode(order: Order) {
  return `#${String(order.order_number ?? order.id).padStart(3, "0")}`;
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
  let workCounts: { payments: number; orders: number; requests: number } | undefined;

  if (user.role === "admin") {
    for (const item of await MenuItemModel.stockAlerts(10)) {
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

    for (const review of await ReviewModel.all(5)) {
      entries.push(reviewNotification(review));
    }
  } else {
    // This endpoint is polled every few seconds by every signed-in staff
    // screen. The unpaid-order sweep is a multi-query write path, so run it at
    // most once every 30 seconds per server process instead of on every poll.
    const nowMs = Date.now();
    if (nowMs - lastAutoCancelAt >= 30_000) {
      lastAutoCancelAt = nowMs;
      await OrderModel.autoCancelUnpaidOrders();
    }
    const now = Date.now();

    const pendingPayments = (await OrderModel.pendingPayments()).filter(needsPaymentReview);
    for (const order of pendingPayments) {
      entries.push({
        id: `payment-${order.id}`,
        kind: "payment",
        title: "Payment needs review",
        message: `${orderCode(order)} · Table ${String(order.table_number).padStart(2, "0")}`,
        href: `/staff/payments?order=${order.id}`,
      });
    }

    const balancePayments = await OrderModel.pendingBalancePayments();
    for (const payment of balancePayments) {
      entries.push({
        id: `balance-payment-${payment.id}`,
        kind: "payment",
        title: "Additional payment needs review",
        message: `${orderCode(payment.order)} · Table ${String(payment.order.table_number).padStart(2, "0")}`,
        href: `/staff/payments?order=${payment.order_id}`,
      });
    }

    for (const order of await OrderModel.list(["preparing"], 500)) {
      const minutesPreparing = preparationMinutesElapsed(order, now) ?? 0;
      const etaExpired = preparationEtaHasPassed(order, now);
      const reminderLevel = preparationReminderLevel(order, now);
      if (reminderLevel === 0) continue;

      entries.push({
        id: `preparing-${order.id}-${reminderLevel}`,
        kind: "preparing",
        title:
          reminderLevel >= 3
            ? "Urgent: preparation is overdue"
            : reminderLevel === 2
              ? "Preparation needs attention"
              : etaExpired
                ? "Preparation ETA has passed"
                : "Order preparing over 1 hour",
        message: `${orderCode(order)} · Table ${String(order.table_number).padStart(2, "0")}${
          minutesPreparing > 60 ? ` · ${minutesPreparing} min preparing` : ""
        }${etaExpired ? " · Mark served if already handed over" : ""}`,
        href: "/staff",
      });
    }

    for (const order of await OrderModel.list(["ready"], 500)) {
      const reminderLevel = readyReminderLevel(order, now);
      if (reminderLevel === 0) continue;
      const minutesReady = readyMinutesElapsed(order, now) ?? 0;
      entries.push({
        id: `ready-${order.id}-${reminderLevel}`,
        kind: "preparing",
        title:
          reminderLevel >= 3
            ? "Urgent: served order still open"
            : reminderLevel === 2
              ? "Served order needs follow-up"
              : "Confirm customer received order",
        message: `${orderCode(order)} · Table ${String(order.table_number).padStart(2, "0")} · Served ${minutesReady} min ago`,
        href: "/staff",
      });
    }

    for (const order of await OrderModel.recentUnpaidTimeoutCancellations()) {
      const cancellationDate = order.cancelled_at?.slice(0, 10);
      entries.push({
        id: `unpaid-cancelled-${order.id}`,
        kind: "payment",
        title: "Cash order automatically cancelled",
        message: `${orderCode(order)} · Table ${String(order.table_number).padStart(2, "0")} · No payment recorded within 90 minutes`,
        href: `/staff/receipt${
          cancellationDate ? `?date=${cancellationDate}` : ""
        }#auto-cancelled`,
      });
    }

    await WaiterRequestModel.resolveAcknowledgedOlderThan(25);
    const pendingRequests = await WaiterRequestModel.list("pending");
    for (const request of pendingRequests) {
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
    const counts = await countStaffWork();
    workCounts = {
      payments: pendingPayments.length + balancePayments.length,
      ...counts,
    };
  }

  const readIds = new Set(await OrderModel.notificationReads(user.id));
  const notifications: PortalNotification[] = entries
    .map((entry) => ({ ...entry, read: readIds.has(entry.id) }))
    .sort((first, second) => Number(first.read) - Number(second.read));

  const unreadReviews = user.role === "admin" ? await ReviewModel.unreadCount(user.id) : 0;
  return Response.json({ notifications, workCounts, unreadReviews, success: true });
}

export async function PATCH(request: Request) {
  const user = await getUser(request);
  if (!user || !["staff", "admin"].includes(user.role)) {
    return Response.json(
      { error: "Please sign in to continue.", success: false },
      { status: 401 }
    );
  }

  let body: { id?: unknown; ids?: unknown; markReviewsSeen?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "A valid notification ID is required.", success: false },
      { status: 400 }
    );
  }
  if (body.markReviewsSeen === true && user.role === "admin") {
    await ReviewModel.markAllSeen(user.id);
    return Response.json({ success: true });
  }
  const validPattern =
    user.role === "admin"
      ? /^admin-(stock|review)-\d+$/
      : /^(?:payment-\d+|balance-payment-\d+|preparing-eta-\d+|preparing-\d+(?:-\d+)?|ready-\d+-[1-3]|unpaid-cancelled-\d+|waiter-\d+)$/;
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

  await OrderModel.markNotificationsRead(user.id, ids);
  return Response.json({ success: true, count: ids.length });
}
