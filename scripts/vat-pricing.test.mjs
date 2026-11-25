import assert from "node:assert/strict";
import test from "node:test";
import { MenuItemModel, SettingsModel } from "../src/lib/models.ts";
import {
  finalizeTotals,
  menuVatRate,
  parseVatRate,
  priceWithVat,
  vatConfig,
  vatFromInclusive,
} from "../src/lib/vat.ts";
import { POST } from "../src/app/api/orders/route.ts";

test("VAT is opt-in and uses the owner's rate", () => {
  assert.equal(menuVatRate({ vat_inclusive: "true" }), 0);
  assert.equal(menuVatRate({ vat_inclusive: "false", vat_rate_pct: "12" }), 0);
  assert.equal(menuVatRate({ vat_inclusive: "true", vat_rate_pct: "12.5" }), 12.5);
  assert.equal(priceWithVat(135, 0), 135);
  assert.equal(priceWithVat(135, 12), 151);
  assert.equal(priceWithVat(135 + 30, 12), 185);
  assert.equal(priceWithVat(0.05, 10), 0);
  for (const invalid of [-1, 101, 12.345, true, "", "1e1"]) {
    assert.equal(parseVatRate(invalid, -1), -1);
  }
});

test("VAT modes separate adding tax from prices that already include it", () => {
  assert.deepEqual(vatConfig({ vat_inclusive: "true", vat_rate_pct: "12" }), {
    mode: "add",
    rate: 12,
  });
  assert.deepEqual(vatConfig({ vat_mode: "included", vat_rate_pct: "12" }), {
    mode: "included",
    rate: 12,
  });
  assert.deepEqual(vatConfig({ vat_mode: "none", vat_rate_pct: "12" }), {
    mode: "none",
    rate: 0,
  });
  assert.equal(menuVatRate({ vat_mode: "included", vat_rate_pct: "12" }), 0);
  assert.equal(vatFromInclusive(135, 12), 14.46);
});

test("the amount due rounds once to the nearest peso", () => {
  assert.equal(finalizeTotals(257.86, { mode: "add", rate: 12 }).total, 258);
  assert.equal(finalizeTotals(257.49, { mode: "add", rate: 12 }).total, 257);
  assert.deepEqual(finalizeTotals(257.86, { mode: "add", rate: 12 }), {
    total: 258,
    vat_amount: 27.64,
    rounding_adjustment: 0.14,
    vat_rate_pct: 12,
    vat_mode: "add",
  });
});

test("GCash quote uses the VAT-inclusive menu price and rejects a stale rate", async (t) => {
  t.mock.method(SettingsModel, "orderingWindow", async () => ({ open: true, menu_vat_pct: 12 }));
  t.mock.method(SettingsModel, "menuVatConfig", async () => ({ mode: "add", rate: 12 }));
  t.mock.method(SettingsModel, "get", async () => "5");
  t.mock.method(MenuItemModel, "byId", async () => ({
    price: 135, is_active: true, stock_status: "available", stock_tracking_enabled: false,
    variants: [{ id: 1, name: "Oat milk", variant_type: "Milk", price_modifier: 30 }],
    extras: [],
  }));
  const request = (menuVatPct) => new Request("http://localhost/api/orders", {
    method: "POST",
    body: JSON.stringify({
      preview: true, menu_vat_pct: menuVatPct, table_number: 7, order_type: "dine_in",
      payment_method: "gcash", customer_name: "Tester",
      items: [{ menuItemId: 7, quantity: 1, variantIds: [1] }],
    }),
  });
  const quote = await POST(request(12));
  assert.equal(quote.status, 200);
  assert.deepEqual(await quote.json(), {
    subtotal: 185,
    service_charge: 9.25,
    total: 194,
    vat_mode: "add",
    vat_rate_pct: 12,
    vat_amount: 20.79,
    rounding_adjustment: -0.25,
    menu_vat_pct: 12,
    success: true,
  });
  const stale = await POST(request(0));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "VAT_RATE_CHANGED");
});

test("prices that already include VAT are not charged VAT twice", async (t) => {
  t.mock.method(SettingsModel, "orderingWindow", async () => ({ open: true, menu_vat_pct: 0 }));
  t.mock.method(SettingsModel, "menuVatConfig", async () => ({ mode: "included", rate: 12 }));
  t.mock.method(SettingsModel, "get", async () => "5");
  t.mock.method(MenuItemModel, "byId", async () => ({
    price: 135, is_active: true, stock_status: "available", stock_tracking_enabled: false,
    variants: [{ id: 1, name: "Oat milk", variant_type: "Milk", price_modifier: 30 }],
    extras: [],
  }));
  const response = await POST(new Request("http://localhost/api/orders", {
    method: "POST",
    body: JSON.stringify({
      preview: true, menu_vat_pct: 0, table_number: 7, order_type: "dine_in",
      payment_method: "gcash", customer_name: "Tester",
      items: [{ menuItemId: 7, quantity: 1, variantIds: [1] }],
    }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    subtotal: 165,
    service_charge: 8.25,
    total: 173,
    vat_mode: "included",
    vat_rate_pct: 12,
    vat_amount: 18.54,
    rounding_adjustment: -0.25,
    menu_vat_pct: 0,
    success: true,
  });
});
