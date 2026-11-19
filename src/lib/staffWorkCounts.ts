import { getDb } from "@/lib/db";

/** Count unfinished work independently of whether its notifications were read. */
export async function countStaffWork() {
  const [orders, requests] = await Promise.all([
    getDb().prepare(
      `SELECT COUNT(*) AS count FROM orders
       WHERE status IN ('confirmed', 'preparing')
          OR (status = 'ready' AND payment_status = 'verified'
              AND ready_at IS NOT NULL
              AND ready_at::timestamp <= timezone('Asia/Manila', CURRENT_TIMESTAMP) - INTERVAL '1 hour')`
    ).get(),
    getDb().prepare("SELECT COUNT(*) AS count FROM waiter_requests WHERE status IN ('pending', 'acknowledged')").get(),
  ]) as [{ count: number }, { count: number }];
  return { orders: Number(orders.count), requests: Number(requests.count) };
}
