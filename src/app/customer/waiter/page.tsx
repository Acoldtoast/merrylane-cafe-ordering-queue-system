import { ClosedShop } from "@/components/ClosedShop";
import { SettingsModel } from "@/lib/models";
import type { OrderingWindow } from "@/lib/models";
import { WaiterClient } from "./WaiterClient";

export const metadata = { title: "Call a waiter" };

export default async function WaiterPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; order?: string }>;
}) {
  const params = await searchParams;
  const table = Math.max(1, Number(params.table) || 7);
  let ordering: OrderingWindow | null = null;
  try {
    ordering = await SettingsModel.orderingWindow();
  } catch (error) {
    console.error("Could not check cafe hours before opening waiter service.", error);
  }

  if (ordering && !ordering.open) {
    return <ClosedShop ordering={ordering} table={table} />;
  }

  return (
    <WaiterClient
      initialTable={table}
      orderId={Number(params.order) || 0}
    />
  );
}
