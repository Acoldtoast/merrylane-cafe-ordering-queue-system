import assert from "node:assert/strict";
import test from "node:test";
import { limitSavedCart, remainingCustomerQuantity } from "../src/lib/customerQuantity.ts";

test("customer quantities respect both the per-item limit and available stock", () => {
  assert.equal(remainingCustomerQuantity(null, 0), 20);
  assert.equal(remainingCustomerQuantity(40, 19), 1);
  assert.equal(remainingCustomerQuantity(null, 20), 0);
  assert.equal(remainingCustomerQuantity(8, 5), 3);
  assert.equal(remainingCustomerQuantity(3, 5), 0);
});

test("old carts are capped across variants, without capping the full order", () => {
  const cart = [
    { menuItemId: 1, quantity: 16, key: "hot" },
    { menuItemId: 1, quantity: 8, key: "iced" },
    { menuItemId: 1, quantity: 1, key: "large" },
    { menuItemId: 2, quantity: 30, key: "pastry" },
  ];
  assert.deepEqual(limitSavedCart(cart).map(({ key, quantity }) => [key, quantity]), [
    ["hot", 16], ["iced", 4], ["pastry", 20],
  ]);
});
