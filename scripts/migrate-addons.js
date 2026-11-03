/**
 * Non-destructive migration for the add-on catalog and drink customization.
 * Run with: npm run db:migrate
 *
 * Safe to run more than once. It keeps existing orders, reviews and accounts.
 */

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const dbPath = path.join(process.cwd(), "data", "merrylane.db");
if (!fs.existsSync(dbPath)) {
  console.error(
    "No database found at data/merrylane.db. Run `npm run db:init` first."
  );
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

function columns(table) {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => row.name)
  );
}

function ensureColumn(table, name, definition) {
  if (!columns(table).has(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    console.log(`  + ${table}.${name}`);
  }
}

console.log("Migrating Merrylane Cafe database…");

db.exec(`
  CREATE TABLE IF NOT EXISTS addons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    price_modifier REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    display_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS item_addons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_item_id INTEGER NOT NULL,
    addon_id INTEGER NOT NULL,
    display_order INTEGER DEFAULT 0,
    UNIQUE (menu_item_id, addon_id),
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    FOREIGN KEY (addon_id) REFERENCES addons(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS order_item_addons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    order_item_id INTEGER NOT NULL,
    addon_id INTEGER,
    name TEXT NOT NULL,
    price_modifier REAL NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    added_by INTEGER,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
    FOREIGN KEY (addon_id) REFERENCES addons(id) ON DELETE SET NULL,
    FOREIGN KEY (added_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS order_balance_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('gcash', 'counter')),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'verified', 'rejected')),
    payment_reference TEXT,
    payment_proof_url TEXT,
    received_by INTEGER,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    verified_at TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (received_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL DEFAULT 'staff',
    area TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_order_addons_order ON order_item_addons(order_id);
  CREATE INDEX IF NOT EXISTS idx_item_addons_item ON item_addons(menu_item_id);
  CREATE INDEX IF NOT EXISTS idx_order_balance_payments_order ON order_balance_payments(order_id);
  CREATE INDEX IF NOT EXISTS idx_order_balance_payments_status ON order_balance_payments(status);
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_area ON activity_logs(area, created_at DESC);
`);

ensureColumn("order_items", "sugar_level", "TEXT");
ensureColumn("order_items", "note", "TEXT");
ensureColumn("orders", "prep_minutes", "INTEGER");
ensureColumn("orders", "estimated_ready_at", "TEXT");
ensureColumn("orders", "customer_name", "TEXT");
ensureColumn("orders", "guest_id", "TEXT");
ensureColumn("orders", "cancelled_at", "TEXT");
ensureColumn("orders", "preparing_at", "TEXT");
ensureColumn("orders", "completion_reason", "TEXT");
ensureColumn("orders", "cancellation_reason", "TEXT");
ensureColumn("waiter_requests", "guest_id", "TEXT");
ensureColumn("waiter_requests", "attempt_no", "INTEGER");
db.exec(`
  UPDATE orders
  SET cancelled_at = updated_at
  WHERE status = 'cancelled' AND cancelled_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at ON orders(cancelled_at);
  CREATE INDEX IF NOT EXISTS idx_orders_status_ready_at ON orders(status, ready_at);
  CREATE INDEX IF NOT EXISTS idx_orders_preparing_at ON orders(preparing_at);
  CREATE INDEX IF NOT EXISTS idx_orders_payment_confirmed
    ON orders(payment_status, confirmed_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_balance_payments_status_verified
    ON order_balance_payments(status, verified_at);
  CREATE INDEX IF NOT EXISTS idx_waiter_status_created
    ON waiter_requests(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_waiter_acknowledged
    ON waiter_requests(status, acknowledged_at);
  CREATE INDEX IF NOT EXISTS idx_waiter_guest_created
    ON waiter_requests(guest_id, created_at DESC);
`);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_orders_guest_created ON orders(guest_id, created_at DESC)"
);

const catalog = [
  ["Extra shot", 25, 1],
  ["Oat milk", 20, 2],
  ["Whipped cream", 15, 3],
  ["Extra syrup", 10, 4],
  ["Pearl", 20, 5],
  ["Nata de coco", 20, 6],
  ["Grass jelly", 20, 7],
  ["Cheese foam", 30, 8],
  ["Brown sugar boba", 25, 9],
  ["Extra jam", 15, 10],
];

const insertAddon = db.prepare(
  `INSERT INTO addons (name, price_modifier, display_order)
   VALUES (?, ?, ?)
   ON CONFLICT(name) DO UPDATE SET
     price_modifier = excluded.price_modifier,
     display_order = excluded.display_order`
);
for (const [name, price, order] of catalog) insertAddon.run(name, price, order);

const addonIdByName = Object.fromEntries(
  db.prepare("SELECT id, name FROM addons").all().map((row) => [row.name, row.id])
);

const drinkAddons = [
  "Extra shot",
  "Oat milk",
  "Whipped cream",
  "Extra syrup",
  "Pearl",
  "Nata de coco",
  "Grass jelly",
  "Cheese foam",
  "Brown sugar boba",
];
const pastryAddons = ["Whipped cream", "Extra jam"];

const insertItemAddon = db.prepare(
  `INSERT OR IGNORE INTO item_addons (menu_item_id, addon_id, display_order)
   VALUES (?, ?, ?)`
);

for (const item of db.prepare("SELECT id, category_id FROM menu_items").all()) {
  const names = item.category_id === 1 || item.category_id === 2 ? drinkAddons : pastryAddons;
  names.forEach((name, index) => {
    const addonId = addonIdByName[name];
    if (addonId) insertItemAddon.run(item.id, addonId, index);
  });
}

// Preserve any custom extras that were configured per item before the catalog.
const legacyExtras = db
  .prepare("SELECT DISTINCT menu_item_id, name, price_modifier FROM item_extras")
  .all();
for (const extra of legacyExtras) {
  let addonId = addonIdByName[extra.name];
  if (!addonId) {
    const result = db
      .prepare("INSERT INTO addons (name, price_modifier) VALUES (?, ?)")
      .run(extra.name, extra.price_modifier);
    addonId = Number(result.lastInsertRowid);
    addonIdByName[extra.name] = addonId;
  }
  insertItemAddon.run(extra.menu_item_id, addonId, 99);
}

db.close();
console.log("Done. Add-ons, item assignments and drink customization are ready.");
