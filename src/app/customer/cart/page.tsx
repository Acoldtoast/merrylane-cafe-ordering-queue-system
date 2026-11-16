import { SettingsModel } from "@/lib/models";
import type { OrderingWindow } from "@/lib/models";
import { ClosedShop } from "@/components/ClosedShop";
import { CartClient } from "./CartClient";

export const metadata = { title: "Review your order" };
export const dynamic = "force-dynamic";

export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>;
}) {
  const params = await searchParams;
  const table = Math.max(1, Number(params.table) || 7);

  let ordering: OrderingWindow | null = null;
  try {
    ordering = await SettingsModel.orderingWindow();
  } catch {
    // Keep the cart usable when the database is still initializing.
  }

  if (ordering && !ordering.open) {
    return <ClosedShop ordering={ordering} table={table} />;
  }

  return <CartClient initialTable={table} />;
}
