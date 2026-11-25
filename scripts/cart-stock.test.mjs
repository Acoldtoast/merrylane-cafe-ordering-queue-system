import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileCartStock,
  stockLimitsFromMenu,
  stockWarningCopy,
  stockWarningDetails,
} from "../src/lib/cartStock.ts";

/** A menu row as the menu API returns it, with the fields reconciliation reads. */
function menuItem(
  id,
  count,
  { tracked = true, out = false, status, active = true } = {}
) {
  return {
    id,
    is_active: active ? 1 : 0,
    stock_count: count,
    stock_tracking_enabled: tracked,
    stock_status: status ?? (out || count <= 0 ? "out" : "available"),
  };
}

function line(key, menuItemId, quantity, name = `Item ${menuItemId}`) {
  return { key, menuItemId, name, quantity };
}

/** Records what reconciliation asks the cart to do, in call order. */
function createCart() {
  const calls = { limits: null, quantities: [], removed: [] };
  return {
    calls,
    cart: {
      setStockLimits: (limits) => {
        calls.limits = limits;
      },
      setQuantity: (key, quantity) => {
        calls.quantities.push([key, quantity]);
      },
      removeItem: (key) => {
        calls.removed.push(key);
      },
    },
  };
}

test("one item's portions are shared across its variant lines", () => {
  const { calls, cart } = createCart();
  const adjusted = reconcileCartStock(
    [menuItem(1, 3)],
    [line("hot", 1, 2), line("iced", 1, 3)],
    cart
  );

  assert.deepEqual(calls.limits, { 1: 3 });
  assert.deepEqual(calls.quantities, [["iced", 1]]);
  assert.deepEqual(calls.removed, []);
  assert.deepEqual(adjusted, [
    { name: "Item 1", from: 3, to: 1, reason: "sold_out" },
  ]);
});

test("the first line keeps stock and later lines can be removed entirely", () => {
  const { calls, cart } = createCart();
  const adjusted = reconcileCartStock(
    [menuItem(6, 2)],
    [line("large", 6, 4), line("small", 6, 1)],
    cart
  );

  assert.deepEqual(calls.quantities, [["large", 2]]);
  assert.deepEqual(calls.removed, ["small"]);
  assert.deepEqual(adjusted, [
    { name: "Item 6", from: 4, to: 2, reason: "sold_out" },
    { name: "Item 6", from: 1, to: 0, reason: "sold_out" },
  ]);
});

test("a sold-out item is removed from every line that holds it", () => {
  const { calls, cart } = createCart();
  const adjusted = reconcileCartStock(
    [menuItem(2, 0)],
    [line("a", 2, 1), line("b", 2, 2)],
    cart
  );

  assert.deepEqual(calls.limits, { 2: 0 });
  assert.deepEqual(calls.quantities, []);
  assert.deepEqual(calls.removed, ["a", "b"]);
  assert.deepEqual(adjusted, [
    { name: "Item 2", from: 1, to: 0, reason: "sold_out" },
    { name: "Item 2", from: 2, to: 0, reason: "sold_out" },
  ]);
});

test("an out flag outranks a positive stock count", () => {
  const { calls, cart } = createCart();
  const adjusted = reconcileCartStock(
    [menuItem(4, 5, { out: true })],
    [line("only", 4, 2)],
    cart
  );

  assert.deepEqual(calls.limits, { 4: 0 });
  assert.deepEqual(calls.removed, ["only"]);
  assert.deepEqual(adjusted, [
    { name: "Item 4", from: 2, to: 0, reason: "sold_out" },
  ]);
});

test("lines whose item left the menu are pruned as removed", () => {
  const { calls, cart } = createCart();
  const adjusted = reconcileCartStock(
    [menuItem(1, 5)],
    [
      line("kept", 1, 2),
      line("ghost", 99, 3, "Ghost latte"),
      line("other-ghost", 99, 1, "Ghost latte"),
    ],
    cart
  );

  assert.equal(calls.limits[99], 0);
  assert.equal(calls.limits[1], 5);
  assert.deepEqual(calls.quantities, []);
  assert.deepEqual(calls.removed, ["ghost", "other-ghost"]);
  assert.deepEqual(adjusted, [
    { name: "Ghost latte", from: 3, to: 0, reason: "removed" },
    { name: "Ghost latte", from: 1, to: 0, reason: "removed" },
  ]);
});

test("a deactivated item is pruned as removed, not sold out", () => {
  const { calls, cart } = createCart();
  const adjusted = reconcileCartStock(
    [menuItem(5, 5, { active: false }), menuItem(7, 10)],
    [
      line("croissant", 5, 2, "Almond croissant"),
      line("coffee", 7, 1, "Bullet coffee"),
    ],
    cart
  );

  assert.deepEqual(calls.limits, { 5: 0, 7: 10 });
  assert.deepEqual(calls.quantities, []);
  assert.deepEqual(calls.removed, ["croissant"]);
  assert.deepEqual(adjusted, [
    { name: "Almond croissant", from: 2, to: 0, reason: "removed" },
  ]);
});

test("deactivation outranks tracked stock and outranks untracked stock", () => {
  const { calls, cart } = createCart();
  const adjusted = reconcileCartStock(
    [menuItem(9, 0, { active: false, tracked: false, status: "available" })],
    [line("one", 9, 1), line("two", 9, 3)],
    cart
  );

  assert.equal(calls.limits[9], 0);
  assert.deepEqual(calls.removed, ["one", "two"]);
  assert.deepEqual(
    adjusted.map((entry) => entry.reason),
    ["removed", "removed"]
  );
});

test("untracked stock never trims a line and reports no limit", () => {
  const { calls, cart } = createCart();
  const adjusted = reconcileCartStock(
    [menuItem(3, 0, { tracked: false, status: "available" })],
    [line("big", 3, 9)],
    cart
  );

  assert.equal(calls.limits[3], null);
  assert.deepEqual(calls.quantities, []);
  assert.deepEqual(calls.removed, []);
  assert.deepEqual(adjusted, []);
});

test("a cart that exactly fits the stock is left alone", () => {
  const { calls, cart } = createCart();
  const adjusted = reconcileCartStock(
    [menuItem(5, 5), menuItem(7, 1)],
    [line("croissant", 5, 5), line("coffee", 7, 1, "Bullet coffee")],
    cart
  );

  assert.deepEqual(calls.quantities, []);
  assert.deepEqual(calls.removed, []);
  assert.deepEqual(adjusted, []);
  assert.deepEqual(calls.limits, { 5: 5, 7: 1 });
});

test("limits still refresh when nothing needs trimming", () => {
  const { calls, cart } = createCart();
  reconcileCartStock([menuItem(8, 8)], [], cart);

  assert.deepEqual(calls.limits, { 8: 8 });
});

test("limits are derived from the menu and the cart together", () => {
  const limits = stockLimitsFromMenu(
    [
      menuItem(1, 9),
      menuItem(2, 0),
      menuItem(3, 4, { tracked: false }),
      menuItem(4, 5, { out: true }),
      menuItem(5, 6, { active: false }),
    ],
    [line("kept", 1, 1), line("ghost", 99, 1)]
  );

  assert.deepEqual(limits, { 1: 9, 2: 0, 3: null, 4: 0, 5: 0, 99: 0 });
});

test("warning rows tell a menu removal apart from a sell-out", () => {
  assert.deepEqual(
    stockWarningDetails([
      { name: "Almond croissant", from: 5, to: 2, reason: "sold_out" },
      { name: "Cold brew", from: 1, to: 0, reason: "sold_out" },
      { name: "Matcha latte", from: 2, to: 0, reason: "removed" },
    ]),
    [
      { label: "Almond croissant", value: "5 → 2 left" },
      { label: "Cold brew", value: "Removed · sold out" },
      { label: "Matcha latte", value: "No longer on the menu" },
    ]
  );
  assert.deepEqual(stockWarningDetails([]), []);
});

test("a sell-out warning talks about portions, not the menu", () => {
  const adjusted = [
    { name: "Almond croissant", from: 5, to: 2, reason: "sold_out" },
  ];

  assert.deepEqual(stockWarningCopy(adjusted, "browse"), {
    title: "Some items sold out",
    message:
      "Some portions sold while you were deciding, so we trimmed your cart to what is still available.",
  });
  assert.deepEqual(stockWarningCopy(adjusted, "checkout"), {
    title: "Some items sold out",
    message:
      "A few portions sold while you were checking out. We updated your cart — please review it and try again.",
  });
});

test("a menu removal warning never blames a sell-out", () => {
  const adjusted = [{ name: "Matcha latte", from: 2, to: 0, reason: "removed" }];

  assert.deepEqual(stockWarningCopy(adjusted, "browse"), {
    title: "Some items left the menu",
    message:
      "Some items were taken off the menu, so we removed them from your cart. Please review it and try again.",
  });
  assert.deepEqual(stockWarningCopy(adjusted, "checkout"), {
    title: "Some items left the menu",
    message:
      "Some items left the menu while you were checking out, so we took them out of your cart. Please review it and try again.",
  });
});

test("a mixed warning names both causes", () => {
  const adjusted = [
    { name: "Cold brew", from: 1, to: 0, reason: "sold_out" },
    { name: "Matcha latte", from: 2, to: 0, reason: "removed" },
  ];

  assert.deepEqual(stockWarningCopy(adjusted, "browse"), {
    title: "Some items changed",
    message:
      "Some portions sold and some items left the menu, so we updated your cart. Please review it and try again.",
  });
  assert.deepEqual(stockWarningCopy(adjusted, "checkout"), {
    title: "Some items changed",
    message:
      "A few portions sold and some items left the menu while you were checking out. We updated your cart — please review it and try again.",
  });
});

test("copy and details stay in step for a reconcile result", () => {
  const adjusted = reconcileCartStock(
    [menuItem(1, 0), menuItem(2, 4, { active: false })],
    [line("sold", 1, 1, "Cold brew"), line("gone", 2, 1, "Matcha latte")],
    createCart().cart
  );

  assert.equal(stockWarningCopy(adjusted, "browse").title, "Some items changed");
  assert.deepEqual(stockWarningDetails(adjusted), [
    { label: "Cold brew", value: "Removed · sold out" },
    { label: "Matcha latte", value: "No longer on the menu" },
  ]);
});

test("a mixed cart reports both reasons in one warning", () => {
  const adjusted = reconcileCartStock(
    [menuItem(1, 0), menuItem(2, 4, { active: false })],
    [line("sold", 1, 1, "Cold brew"), line("gone", 2, 1, "Matcha latte")],
    createCart().cart
  );

  assert.deepEqual(stockWarningDetails(adjusted), [
    { label: "Cold brew", value: "Removed · sold out" },
    { label: "Matcha latte", value: "No longer on the menu" },
  ]);
});
