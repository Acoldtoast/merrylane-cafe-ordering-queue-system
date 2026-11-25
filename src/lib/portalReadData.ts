import { CategoryModel, MenuItemModel, SettingsModel } from "./models";
import { cached } from "./serverCache";

export function readMenuCatalog(includeInactive = false) {
  return cached(`menu:${includeInactive ? "all" : "active"}`, 10_000, async () => {
    const [categories, items, menuVatPct] = await Promise.all([
      CategoryModel.all(),
      includeInactive ? MenuItemModel.all() : MenuItemModel.allActive(),
      includeInactive ? 0 : SettingsModel.menuVatPercentage(),
    ]);
    return { categories, items, menu_vat_pct: menuVatPct, success: true };
  });
}

export function readOrderingWindow() {
  return cached("settings:ordering", 5_000, () => SettingsModel.orderingWindow());
}
