/**
 * Merrylane Cafe - database initializer
 * Run with: npm run db:init
 *
 * Uses Node's built-in node:sqlite so there are no native database
 * dependencies to compile on Windows.
 */

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "merrylane.db");
for (const suffix of ["", "-wal", "-shm"]) {
  const file = dbPath + suffix;
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA encoding = 'UTF-8';
`);

const schema = `
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL,
  display_order INTEGER DEFAULT 0
);

CREATE TABLE menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL DEFAULT 0,
  category_id INTEGER NOT NULL,
  image_url TEXT,
  is_active INTEGER DEFAULT 1,
  is_best_seller INTEGER DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  stock_count INTEGER DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 5,
  stock_status TEXT NOT NULL DEFAULT 'available' CHECK (stock_status IN ('available','low','out')),
  stock_note TEXT,
  stock_scope TEXT NOT NULL DEFAULT 'today' CHECK (stock_scope IN ('today','until_changed')),
  stock_tracking_enabled INTEGER NOT NULL DEFAULT 1,
  stock_manual_out_date TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE item_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  variant_type TEXT NOT NULL DEFAULT 'Size',
  price_modifier REAL DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
);

CREATE TABLE item_extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price_modifier REAL DEFAULT 0,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
);

-- Admin-managed add-on catalog (pearl, nata, cheese foam, extra shot, ...).
-- A single add-on can be offered on many menu items.
CREATE TABLE addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  price_modifier REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE item_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL,
  addon_id INTEGER NOT NULL,
  display_order INTEGER DEFAULT 0,
  UNIQUE (menu_item_id, addon_id),
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
  FOREIGN KEY (addon_id) REFERENCES addons(id) ON DELETE CASCADE
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_number INTEGER NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('dine_in', 'take_out')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'payment_pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('gcash', 'counter', 'cash')),
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'verified', 'rejected')),
  customer_name TEXT,
  subtotal REAL DEFAULT 0,
  service_charge REAL DEFAULT 0,
  total REAL DEFAULT 0,
  remarks TEXT,
  queue_number INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime')),
  confirmed_at TEXT,
  preparing_at TEXT,
  cancelled_at TEXT,
  ready_at TEXT,
  completed_at TEXT,
  completion_reason TEXT,
  cancellation_reason TEXT,
  payment_proof_url TEXT,
  payment_reference TEXT,
  payment_amount REAL,
  cash_received REAL,
  change_given REAL,
  prep_minutes INTEGER,
  estimated_ready_at TEXT,
  guest_id TEXT
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  menu_item_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  variant_name TEXT,
  extras TEXT DEFAULT '[]',
  sugar_level TEXT,
  note TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  price_at_time REAL NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
);

-- Add-ons that staff add after the customer has ordered (for example when the
-- guest asks for pearl at the table). Kept separate from the customer's own
-- extras so every change has an audit trail and the order total stays correct.
CREATE TABLE order_item_addons (
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

CREATE TABLE order_stock_deductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  order_item_id INTEGER NOT NULL UNIQUE,
  menu_item_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  previous_stock_status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  restored_at TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
);

CREATE TABLE order_balance_payments (
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

CREATE TABLE waiter_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_number INTEGER NOT NULL,
  order_id INTEGER,
  guest_id TEXT,
  attempt_no INTEGER,
  request_type TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'acknowledged', 'resolved')),
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime')),
  acknowledged_at TEXT,
  resolved_at TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  table_number INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  customer_name TEXT,
  comment TEXT,
  photo_url TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE stock_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('out_of_stock', 'restock', 'orders_left', 'quantity')),
  quantity INTEGER,
  note TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX idx_order_stock_deductions_order
  ON order_stock_deductions(order_id, restored_at);

CREATE TABLE activity_logs (
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

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_orders_table ON orders(table_number);
CREATE INDEX idx_orders_guest_created ON orders(guest_id, created_at DESC);
CREATE INDEX idx_orders_payment_confirmed ON orders(payment_status, confirmed_at DESC, id DESC);
CREATE INDEX idx_orders_status_ready_at ON orders(status, ready_at);
CREATE INDEX idx_orders_preparing_at ON orders(preparing_at);
CREATE INDEX idx_waiter_status_created ON waiter_requests(status, created_at DESC);
CREATE INDEX idx_waiter_guest_created ON waiter_requests(guest_id, created_at DESC);
CREATE INDEX idx_waiter_acknowledged ON waiter_requests(status, acknowledged_at);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_addons_order ON order_item_addons(order_id);
CREATE INDEX idx_item_addons_item ON item_addons(menu_item_id);
CREATE INDEX idx_order_balance_payments_order ON order_balance_payments(order_id);
CREATE INDEX idx_order_balance_payments_status ON order_balance_payments(status);
CREATE INDEX idx_balance_payments_status_verified ON order_balance_payments(status, verified_at);
CREATE INDEX idx_waiter_status ON waiter_requests(status);
CREATE INDEX idx_activity_created ON activity_logs(created_at DESC, id DESC);
CREATE INDEX idx_activity_area ON activity_logs(area, created_at DESC);
`;

db.exec(schema);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
function localStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function daysAgo(n, hour = 10, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return localStamp(d);
}

// ---------------------------------------------------------------------------
// Categories and menu
// ---------------------------------------------------------------------------
const categories = [
  ["Coffee", "coffee", 1],
  ["Non-Coffee", "non-coffee", 2],
  ["Pastries", "pastries", 3],
];
for (const c of categories) {
  db.prepare("INSERT INTO categories (name, slug, display_order) VALUES (?, ?, ?)").run(...c);
}

const menu = [
  { name: "Spanish latte", desc: "Rich espresso, creamy milk and just the right sweetness.", price: 150, cat: 1, best: 1, stock: 18, status: "available", note: null, order: 1 },
  { name: "Butter croissant", desc: "Flaky, buttery, and baked fresh this morning.", price: 95, cat: 3, best: 1, stock: 12, status: "available", note: null, order: 1 },
  { name: "Matcha latte", desc: "Premium Japanese matcha whisked with creamy milk.", price: 165, cat: 2, best: 0, stock: 0, status: "out", note: "Out of stock today", order: 1 },
  { name: "Iced americano", desc: "Smooth espresso over ice with a clean, bold finish.", price: 120, cat: 1, best: 0, stock: 8, status: "low", note: "Only 3 orders left", order: 2 },
  { name: "Almond croissant", desc: "Butter croissant filled with almond cream and toasted flakes.", price: 125, cat: 3, best: 0, stock: 6, status: "low", note: "Only 2 orders left", order: 2 },
  { name: "Cafe mocha", desc: "Espresso with dark chocolate and velvety steamed milk.", price: 180, cat: 1, best: 1, stock: 6, status: "available", note: null, order: 3 },
  { name: "Bullet coffee", desc: "Espresso blended with ghee and coconut oil for a smooth lift.", price: 165, cat: 1, best: 0, stock: 10, status: "available", note: null, order: 4 },
  { name: "Oat milk cappuccino", desc: "Creamy oat milk, double espresso, and a soft foam crown.", price: 155, cat: 2, best: 0, stock: 9, status: "available", note: null, order: 2 },
  { name: "Cold brew", desc: "Slow-steeped for 18 hours. Smooth, chocolatey, low-acid.", price: 150, cat: 1, best: 0, stock: 0, status: "out", note: "Brewing again tomorrow", order: 5 },
  { name: "Cappuccino", desc: "A classic balance of espresso, steamed milk, and foam.", price: 140, cat: 1, best: 0, stock: 14, status: "available", note: null, order: 6 },
  { name: "Blueberry muffin", desc: "Soft, buttery muffin with pockets of wild blueberry.", price: 85, cat: 3, best: 0, stock: 5, status: "low", note: "Only 3 orders left", order: 3 },
  { name: "Avocado toast", desc: "Smashed avocado on sourdough with chili, lime, and olive oil.", price: 195, cat: 3, best: 0, stock: 4, status: "low", note: "Only 4 orders left", order: 4 },
  { name: "Sourdough toast", desc: "Toasted sourdough with cultured butter and house jam.", price: 75, cat: 3, best: 0, stock: 20, status: "available", note: null, order: 5 },
  { name: "Matcha croissant", desc: "Crisp croissant folded with white chocolate and matcha cream.", price: 145, cat: 3, best: 0, stock: 7, status: "available", note: null, order: 6 },
  { name: "Hot chocolate", desc: "Single-origin cacao, steamed milk, and a pinch of sea salt.", price: 130, cat: 2, best: 0, stock: 10, status: "available", note: null, order: 3 },
];

const insertItem = db.prepare(`
  INSERT INTO menu_items
    (name, description, price, category_id, image_url, is_best_seller, display_order, stock_count, stock_status, stock_note)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const item of menu) {
  insertItem.run(
    item.name,
    item.desc,
    item.price,
    item.cat,
    "",
    item.best,
    item.order,
    item.stock,
    item.status,
    item.note
  );
}

const insertVariant = db.prepare(
  "INSERT INTO item_variants (menu_item_id, name, variant_type, price_modifier, display_order) VALUES (?, ?, ?, ?, ?)"
);

// The add-on catalog is global. Admins decide which items each add-on is
// offered on from Admin → Menu → Add-ons.
const addons = [
  { name: "Extra shot", price: 25, order: 1 },
  { name: "Oat milk", price: 20, order: 2 },
  { name: "Whipped cream", price: 15, order: 3 },
  { name: "Extra syrup", price: 10, order: 4 },
  { name: "Pearl", price: 20, order: 5 },
  { name: "Nata de coco", price: 20, order: 6 },
  { name: "Grass jelly", price: 20, order: 7 },
  { name: "Cheese foam", price: 30, order: 8 },
  { name: "Brown sugar boba", price: 25, order: 9 },
  { name: "Extra jam", price: 15, order: 10 },
];
const insertAddon = db.prepare(
  "INSERT INTO addons (name, price_modifier, display_order) VALUES (?, ?, ?)"
);
const addonIdByName = {};
for (const addon of addons) {
  const result = insertAddon.run(addon.name, addon.price, addon.order);
  addonIdByName[addon.name] = Number(result.lastInsertRowid);
}

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
  "INSERT INTO item_addons (menu_item_id, addon_id, display_order) VALUES (?, ?, ?)"
);

for (const item of db.prepare("SELECT id, category_id FROM menu_items").all()) {
  if (item.category_id === 1 || item.category_id === 2) {
    insertVariant.run(item.id, "Hot", "Temperature", 0, 1);
    insertVariant.run(item.id, "Iced", "Temperature", 0, 2);
    insertVariant.run(item.id, "Regular", "Size", 0, 3);
    insertVariant.run(item.id, "Large", "Size", 20, 4);
    drinkAddons.forEach((name, index) =>
      insertItemAddon.run(item.id, addonIdByName[name], index)
    );
  } else {
    pastryAddons.forEach((name, index) =>
      insertItemAddon.run(item.id, addonIdByName[name], index)
    );
  }
}

// ---------------------------------------------------------------------------
// Users & settings
// ---------------------------------------------------------------------------
const insertUser = db.prepare(
  "INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, ?, ?)"
);
insertUser.run("Ava Reyes", "admin@merrylane.com", "admin", "sha256_admin123");
insertUser.run("Mika Santos", "barista@merrylane.com", "staff", "sha256_staff123");
insertUser.run("Noel Cruz", "noel@merrylane.com", "staff", "sha256_staff123");
insertUser.run("Trina Lim", "trina@merrylane.com", "staff", "sha256_staff123");

const settings = [
  ["cafe_name", "Merrylane Cafe"],
  ["cafe_location", "Lipa City, Batangas"],
  ["wifi_ssid", "MERLYLANE-WIFI"],
  ["gcash_number", "0917 123 4567"],
  ["gcash_name", "Merrylane Cafe"],
  ["ordering_closed", "false"],
  ["last_order_time", "21:00"],
  ["opening_time", "09:00"],
  ["closing_time", "22:00"],
  ["service_charge_pct", "0"],
  ["vat_inclusive", "true"],
  ["days_operating", "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday"],
];
const insertSetting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
for (const s of settings) insertSetting.run(...s);

// ---------------------------------------------------------------------------
// A tiny demo GCash receipt used by the staff verification screen.
// ---------------------------------------------------------------------------
const receiptSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="900" viewBox="0 0 720 900">
  <rect width="720" height="900" fill="#f4f7fb"/>
  <rect x="36" y="36" width="648" height="828" rx="28" fill="#ffffff"/>
  <rect x="36" y="36" width="648" height="150" rx="28" fill="#0070e0"/>
  <rect x="36" y="150" width="648" height="36" fill="#0070e0"/>
  <text x="80" y="105" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">GCash</text>
  <text x="80" y="144" font-family="Arial, sans-serif" font-size="19" fill="#d8e9ff">Payment sent successfully</text>
  <circle cx="360" cy="255" r="48" fill="#e7f7ec"/>
  <path d="M336 256 l17 17 32-38" fill="none" stroke="#1c9c54" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="360" y="355" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#667085">Amount sent</text>
  <text x="360" y="420" text-anchor="middle" font-family="Arial, sans-serif" font-size="58" font-weight="700" fill="#101828">PHP 275.00</text>
  <line x1="80" y1="475" x2="640" y2="475" stroke="#eaecf0"/>
  <text x="80" y="525" font-family="Arial, sans-serif" font-size="19" fill="#667085">Sent to</text>
  <text x="80" y="558" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#101828">Merrylane Cafe</text>
  <text x="80" y="615" font-family="Arial, sans-serif" font-size="19" fill="#667085">Reference no.</text>
  <text x="80" y="648" font-family="Arial, sans-serif" font-size="22" font-weight="600" fill="#101828">2048 0319 7350</text>
  <text x="80" y="705" font-family="Arial, sans-serif" font-size="19" fill="#667085">Date &amp; time</text>
  <text x="80" y="738" font-family="Arial, sans-serif" font-size="22" font-weight="600" fill="#101828">27 Oct 2026, 4:16 PM</text>
  <rect x="80" y="782" width="560" height="1" fill="#eaecf0"/>
  <text x="360" y="825" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#98a2b3">This is a demo receipt for the Merrylane system.</text>
</svg>`;
const proofUrl = `data:image/svg+xml;base64,${Buffer.from(receiptSvg).toString("base64")}`;

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
const itemRows = db.prepare("SELECT id, name, price, category_id FROM menu_items").all();
const itemById = Object.fromEntries(itemRows.map((i) => [i.id, i]));

const insertOrder = db.prepare(`
  INSERT INTO orders
    (table_number, order_type, status, payment_method, payment_status, subtotal, service_charge, total,
     remarks, queue_number, created_at, updated_at, confirmed_at, ready_at, completed_at,
     payment_proof_url, payment_reference, payment_amount)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertOrderItem = db.prepare(`
  INSERT INTO order_items
    (order_id, menu_item_id, name, variant_name, extras, sugar_level, note, quantity, price_at_time)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function addOrder(opts) {
  const subtotal = opts.items.reduce((sum, it) => sum + itemById[it.id].price * it.qty, 0);
  const total = subtotal + (opts.service || 0);
  const result = insertOrder.run(
    opts.table,
    opts.type || "dine_in",
    opts.status,
    opts.payment || "gcash",
    opts.payStatus || "pending",
    subtotal,
    opts.service || 0,
    total,
    opts.remarks || null,
    opts.queue || null,
    opts.createdAt,
    opts.createdAt,
    opts.confirmedAt || null,
    opts.readyAt || null,
    opts.completedAt || null,
    opts.proof || null,
    opts.reference || null,
    opts.proof ? total : null
  );
  const id = Number(result.lastInsertRowid);
  for (const it of opts.items) {
    const row = itemById[it.id];
    insertOrderItem.run(
      id,
      row.id,
      row.name,
      it.variant || null,
      JSON.stringify(it.extras || []),
      it.sugar || null,
      it.note || null,
      it.qty,
      row.price
    );
  }
  return id;
}

// Demo order shown on the customer's table (table 7) after completion.
const completedId = addOrder({
  table: 7,
  status: "completed",
  payment: "gcash",
  payStatus: "verified",
  items: [
    {
      id: 1,
      qty: 1,
      variant: "Iced · Large",
      extras: [{ name: "Extra shot", price_modifier: 25 }],
      sugar: "50%",
      note: "Light ice, please.",
    },
    { id: 2, qty: 1, variant: null, extras: [] },
  ],
  queue: 42,
  createdAt: daysAgo(0, 8, 41),
  confirmedAt: daysAgo(0, 8, 44),
  readyAt: daysAgo(0, 8, 59),
  completedAt: daysAgo(0, 9, 3),
  proof: proofUrl,
  reference: "2048 0319 7350",
});

// Active queue / staff demo orders.
addOrder({
  table: 5,
  status: "payment_pending",
  payment: "gcash",
  payStatus: "pending",
  items: [
    { id: 1, qty: 1, variant: "Iced · Large", sugar: "25%", note: "No straw." },
    { id: 15, qty: 1, variant: "Hot · Regular", sugar: "75%" },
  ],
  createdAt: daysAgo(0, new Date().getHours(), Math.max(0, new Date().getMinutes() - 4)),
  proof: proofUrl,
  reference: "2048 0319 7350",
});
addOrder({
  table: 3,
  status: "preparing",
  payment: "counter",
  payStatus: "verified",
  items: [
    { id: 10, qty: 1, variant: "Hot · Regular", sugar: "0%", note: "Extra hot." },
    { id: 11, qty: 1 },
  ],
  queue: 44,
  createdAt: daysAgo(0, new Date().getHours(), Math.max(0, new Date().getMinutes() - 15)),
  confirmedAt: daysAgo(0, new Date().getHours(), Math.max(0, new Date().getMinutes() - 12)),
});
addOrder({
  table: 8,
  status: "ready",
  payment: "gcash",
  payStatus: "verified",
  items: [
    { id: 6, qty: 1, variant: "Iced · Regular" },
    { id: 2, qty: 1 },
  ],
  queue: 45,
  createdAt: daysAgo(0, new Date().getHours(), Math.max(0, new Date().getMinutes() - 19)),
  confirmedAt: daysAgo(0, new Date().getHours(), Math.max(0, new Date().getMinutes() - 17)),
  readyAt: daysAgo(0, new Date().getHours(), Math.max(0, new Date().getMinutes() - 3)),
});
addOrder({
  table: 2,
  status: "pending",
  payment: "counter",
  payStatus: "pending",
  items: [
    { id: 7, qty: 1, variant: "Hot · Regular" },
    { id: 14, qty: 1 },
  ],
  createdAt: daysAgo(0, new Date().getHours(), Math.max(0, new Date().getMinutes() - 7)),
});

// Historical orders for sales, chart and forecasting.
const historyPattern = [
  [1, 2], [3, 0], [2, 1], [6, 0], [4, 1],
  [5, 2], [10, 0], [7, 1], [2, 1], [1, 1],
  [14, 0], [6, 1], [8, 0], [4, 2], [2, 1],
];
let queue = 46;
for (let day = 1; day <= 9; day++) {
  const ordersToday = day <= 2 ? 7 : 5;
  for (let i = 0; i < ordersToday; i++) {
    const pattern = historyPattern[(day * 3 + i) % historyPattern.length];
    const hour = [9, 10, 11, 13, 15, 17, 19][i % 7];
    const minute = (i * 11 + day * 7) % 60;
    const items = [{ id: pattern[0], qty: 1 + (pattern[1] % 2), variant: "Regular" }];
    if (i % 3 === 0) items.push({ id: itemRows[(day + i) % itemRows.length].id, qty: 1 });
    addOrder({
      table: ((day + i) % 8) + 1,
      type: i % 4 === 0 ? "take_out" : "dine_in",
      status: "completed",
      payment: i % 3 === 0 ? "counter" : "gcash",
      payStatus: "verified",
      items,
      queue: queue++,
      createdAt: daysAgo(day, hour, minute),
      confirmedAt: daysAgo(day, hour, minute + 2),
      readyAt: daysAgo(day, hour, minute + 12),
      completedAt: daysAgo(day, hour, minute + 16),
    });
  }
}

// Waiter requests
const insertRequest = db.prepare(`
  INSERT INTO waiter_requests (table_number, order_id, request_type, message, status, created_at, acknowledged_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
insertRequest.run(5, null, "Water refill", "Two glasses, please.", "pending", daysAgo(0, 9, 40), null);
insertRequest.run(2, null, "Question about my order", "Can we make the mocha less sweet?", "acknowledged", daysAgo(0, 9, 22), daysAgo(0, 9, 23));
insertRequest.run(4, null, "Something else", "Could we get an extra plate?", "resolved", daysAgo(0, 8, 55), daysAgo(0, 8, 56));
insertRequest.run(7, null, "Water refill", "One glass, please.", "pending", daysAgo(0, 9, 12), null);

// Reviews
const insertReview = db.prepare(`
  INSERT INTO reviews (order_id, table_number, rating, customer_name, comment, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
insertReview.run(completedId, 7, 4, "Anonymous", "The Spanish latte was lovely, and the croissant was perfectly warm. Will visit again!", daysAgo(0, 9, 10));
insertReview.run(completedId, 7, 5, "Sam", "Best cafe stop in Lipa. The oat milk cappuccino is my new favorite.", daysAgo(1, 16, 20));
insertReview.run(completedId, 7, 4, "Anonymous", "Cozy place, kind staff, and the pastries are always fresh.", daysAgo(2, 11, 5));
insertReview.run(completedId, 7, 5, "Trina", "Quiet corner, good coffee, and the matcha croissant is a must-try.", daysAgo(3, 14, 40));
insertReview.run(completedId, 7, 4, "Anonymous", "The perfect little break. I stayed for a second cup.", daysAgo(4, 10, 15));
insertReview.run(completedId, 7, 3, "Miguel", "Good coffee, but it was a little busy when we visited.", daysAgo(5, 15, 30));

db.close();
console.log("Merrylane Cafe database initialized at:", dbPath);
console.log(`  ${categories.length} categories · ${menu.length} menu items · 4 staff accounts`);
console.log("  Demo orders, payments, waiter requests and reviews are ready.");
