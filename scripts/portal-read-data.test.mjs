import assert from "node:assert/strict";
import test from "node:test";
import { CategoryModel, MenuItemModel, SettingsModel } from "../src/lib/models.ts";
import { readMenuCatalog } from "../src/lib/portalReadData.ts";
import { invalidateCache } from "../src/lib/serverCache.ts";

test("concurrent menu reads share a load and catalog changes refresh it", async (t) => {
  const categories = t.mock.method(CategoryModel, "all", async () => []);
  const items = t.mock.method(MenuItemModel, "allActive", async () => []);
  const vat = t.mock.method(SettingsModel, "menuVatPercentage", async () => 12);
  t.after(() => invalidateCache("menu"));

  const [page, api] = await Promise.all([readMenuCatalog(), readMenuCatalog()]);
  assert.equal(page, api);
  assert.equal(categories.mock.callCount(), 1);
  assert.equal(items.mock.callCount(), 1);
  assert.equal(vat.mock.callCount(), 1);
  assert.equal(page.menu_vat_pct, 12);

  invalidateCache("menu");
  await readMenuCatalog();
  assert.equal(items.mock.callCount(), 2);
});
