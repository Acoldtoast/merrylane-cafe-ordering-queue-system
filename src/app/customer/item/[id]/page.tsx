import { notFound } from "next/navigation";
import { MenuItemModel, SettingsModel } from "@/lib/models";
import type { OrderingWindow } from "@/lib/models";
import { ClosedShop } from "@/components/ClosedShop";
import { ItemClient } from "./ItemClient";

export const metadata = { title: "Customize your order" };
export const dynamic = "force-dynamic";

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ table?: string; edit?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const table = Math.max(1, Number(query.table) || 7);

  let ordering: OrderingWindow | null = null;
  try {
    ordering = await SettingsModel.orderingWindow();
  } catch {
    // Keep customizing available if settings cannot be read.
  }
  if (ordering && !ordering.open) {
    return <ClosedShop ordering={ordering} table={table} />;
  }

  const item = await MenuItemModel.byId(Number(id));
  if (!item || !item.is_active) notFound();
  return (
    <ItemClient
      item={JSON.parse(JSON.stringify(item))}
      initialTable={table}
      editKey={query.edit || null}
    />
  );
}
