import { OrderModel, ReviewModel } from "@/lib/models";
import type { Order, Review } from "@/lib/types";
import { StatusClient } from "./StatusClient";

export const metadata = { title: "Order status" };
export const dynamic = "force-dynamic";

export default async function StatusPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; table?: string }>;
}) {
  const params = await searchParams;
  const orderId = Number(params.id) || 0;
  const table = Math.max(1, Number(params.table) || 7);

  let initialOrder: Order | null = null;
  let initialReview: Review | null = null;

  try {
    initialOrder = orderId
      ? (await OrderModel.byId(orderId)) || null
      : (await OrderModel.byTable(table, 1))[0] || null;
    if (initialOrder) {
      initialReview = (await ReviewModel.byOrder(initialOrder.id)) || null;
    }
  } catch {
    // The client can still load the order after the database is ready.
  }

  return (
    <StatusClient
      orderId={orderId}
      initialTable={table}
      initialOrder={initialOrder ? JSON.parse(JSON.stringify(initialOrder)) : null}
      initialReview={initialReview ? JSON.parse(JSON.stringify(initialReview)) : null}
    />
  );
}
