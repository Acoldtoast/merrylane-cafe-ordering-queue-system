import type { OrderingWindow } from "@/lib/models";
import type { Category, MenuItem } from "@/lib/types";
import { readMenuCatalog, readOrderingWindow } from "@/lib/portalReadData";
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
    ordering = await readOrderingWindow();
  } catch {
    // Render an empty menu rather than failing before the database is ready.
  }

  // Outside the weekly schedule the menu does not take orders at all.
  if (ordering && !ordering.open) {
    return <ClosedShop ordering={ordering} table={table} />;
  }
  try {
    const catalog = await readMenuCatalog();
    categories = catalog.categories;
    items = catalog.items as unknown as MenuItem[];
  } catch {
    // Leave ordering disabled until the menu can be read.
    ordering = null;
  }
  closingTime = ordering?.closes_at ?? closingTime;

  return (
    <MenuClient
      initialTable={table}
      initialCategories={JSON.parse(JSON.stringify(categories))}
      initialItems={JSON.parse(JSON.stringify(items))}
      initialOpen={ordering?.open ?? false}
      initialClosingTime={closingTime}
      initialOrdering={ordering}
    />
  );
}
