import { ActivityModel } from "./models";
import type { ActivityEntry } from "./models";
import type { User } from "./types";
import { peso } from "./format";

export type ActivityUser = Pick<User, "id" | "name" | "role">;

/** Record a staff or administrator action in the activity log. */
export function logActivity(
  user: ActivityUser | null,
  entry: ActivityEntry
): void {
  ActivityModel.log(
    user ? { id: user.id, name: user.name, role: user.role } : null,
    entry
  );
}

/** "order #073 · Table 07" */
export function orderRef(order: { id: number; table_number: number }): string {
  return `order #${String(order.id).padStart(3, "0")} · Table ${String(
    order.table_number
  ).padStart(2, "0")}`;
}

export function paymentMethodLabel(method?: string | null): string {
  if (method === "gcash") return "GCash";
  if (method === "counter") return "counter";
  return "cash";
}

export function money(amount?: number | string | null): string {
  return peso(amount);
}
