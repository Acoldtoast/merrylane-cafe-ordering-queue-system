import type { Order, OrderStatus } from "./types";

export const STAFF_BOARD_ACTIVE_STATUSES = [
  "confirmed",
  "preparing",
  "ready",
] as const satisfies readonly OrderStatus[];

export function needsPaymentReview(
  order: Pick<Order, "payment_status" | "status" | "payment_method" | "payment_proof_url">
): boolean {
  if (order.payment_status !== "pending") return false;
  if (order.payment_method === "gcash") {
    return order.status === "payment_pending" && Boolean(order.payment_proof_url);
  }
  return ["counter", "cash"].includes(order.payment_method) &&
    ["pending", "payment_pending"].includes(order.status);
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function preparationMinutesElapsed(
  order: Pick<Order, "status" | "created_at" | "updated_at" | "preparing_at">,
  now = Date.now()
): number | null {
  if (order.status !== "preparing") return null;
  const startedAt =
    timestamp(order.preparing_at) ??
    timestamp(order.updated_at) ??
    timestamp(order.created_at);
  return startedAt === null ? null : Math.floor((now - startedAt) / 60000);
}

export function preparationEtaHasPassed(
  order: Pick<Order, "status" | "estimated_ready_at">,
  now = Date.now()
): boolean {
  const eta = timestamp(order.estimated_ready_at);
  return order.status === "preparing" && eta !== null && eta < now;
}

export function preparationReminderLevel(
  order: Pick<
    Order,
    "status" | "created_at" | "updated_at" | "preparing_at" | "estimated_ready_at"
  >,
  now = Date.now()
): 0 | 1 | 2 | 3 {
  if (order.status !== "preparing") return 0;
  const elapsed = preparationMinutesElapsed(order, now);
  if (elapsed === null) return 0;
  const eta = timestamp(order.estimated_ready_at);
  const minutesPastEta =
    eta === null ? null : Math.floor((now - eta) / 60000);

  if ((minutesPastEta !== null && minutesPastEta >= 180) || elapsed >= 240) {
    return 3;
  }
  if ((minutesPastEta !== null && minutesPastEta >= 60) || elapsed >= 120) {
    return 2;
  }
  if ((minutesPastEta !== null && minutesPastEta >= 0) || elapsed > 60) {
    return 1;
  }
  return 0;
}

export function readyMinutesElapsed(
  order: Pick<Order, "created_at" | "updated_at" | "ready_at">,
  now = Date.now()
): number | null {
  const readyAt =
    timestamp(order.ready_at) ??
    timestamp(order.updated_at) ??
    timestamp(order.created_at);
  return readyAt === null ? null : Math.floor((now - readyAt) / 60000);
}

export function readyReminderLevel(
  order: Pick<Order, "created_at" | "updated_at" | "ready_at">,
  now = Date.now()
): 0 | 1 | 2 | 3 {
  const elapsed = readyMinutesElapsed(order, now);
  if (elapsed === null || elapsed < 30) return 0;
  if (elapsed >= 120) return 3;
  if (elapsed >= 60) return 2;
  return 1;
}

export function staffCanCompleteServedOrder(
  order: Pick<Order, "status" | "payment_status" | "ready_at">,
  now = Date.now()
): boolean {
  if (order.status !== "ready" || order.payment_status !== "verified" || !order.ready_at) return false;
  const value = order.ready_at.trim();
  const localManila = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}+08:00`
    : value;
  const servedAt = Date.parse(localManila);
  return Number.isFinite(servedAt) && now - servedAt >= 60 * 60 * 1000;
}
