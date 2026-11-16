import { CategoryModel, MenuItemModel, SettingsModel } from "@/lib/models";
import type { OrderingWindow } from "@/lib/models";
import type { Category, MenuItem } from "@/lib/types";
import { ClosedShop } from "@/components/ClosedShop";
import { MenuClient } from "./MenuClient";

export const metadata = { title: "Menu" };
export const dynamic = "force-dynamic";

export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>;
}) {
  const params = await searchParams;
  const table = Math.max(1, Number(params.table) || 7);

  let categories: Category[] = [];
  let items: MenuItem[] = [];
  let ordering: OrderingWindow | null = null;
  let closingTime = "22:00";

  try {
    categories = await CategoryModel.all();
    items = (await MenuItemModel.allActive()) as unknown as MenuItem[];
    ordering = await SettingsModel.orderingWindow();
    closingTime =
      ordering.schedule.find((day) => day.day === ordering?.today)?.end ||
      (await SettingsModel.get("closing_time")) ||
      closingTime;
  } catch {
    // Render an empty menu rather than failing before the database is ready.
  }

  // Outside the weekly schedule the menu does not take orders at all.
  if (ordering && !ordering.open) {
    return <ClosedShop ordering={ordering} table={table} />;
  }

  return (
    <MenuClient
      initialTable={table}
      initialCategories={JSON.parse(JSON.stringify(categories))}
      initialItems={JSON.parse(JSON.stringify(items))}
      initialOpen={ordering?.open ?? true}
      initialClosingTime={closingTime}
      initialOrdering={ordering}
    />
  );
}
