/**
 * Data models for the Merrylane Cafe system.
 * All persistence goes through PGlite (PostgreSQL compiled to WASM, see ./db/index.ts).
 */

import { getDb } from "./db";
import type { PGliteDatabase } from "./db/pglite";
import {
  calculateOrderDiscounts,
  type DiscountRecipient,
  type OrderDiscount,
} from "./orderDiscount";
import { STAFF_BOARD_ACTIVE_STATUSES } from "./orderLifecycle";
import { usernameForAccount } from "./usernames";
import type { RejectedPayment, SalesTransaction } from "./types";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false;
  if (stored.startsWith("sha256_")) {
    return stored === `sha256_${password}`;
  }
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const a = Buffer.from(hash, "hex");
    const b = scryptSync(password, salt, 64);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ============================================================
// Categories
// ============================================================
export interface Category {
  id: number;
  name: string;
  slug: string;
  display_order: number;
}

export const CategoryModel = {
  async all(): Promise<Category[]> {
    return await getDb()
      .prepare("SELECT * FROM categories ORDER BY display_order, name")
      .all() as unknown as Category[];
  },

  async byId(id: number): Promise<Category | undefined> {
    return await getDb().prepare("SELECT * FROM categories WHERE id = ?").get(id) as
      | Category
      | undefined;
  },

  async create(name: string, slug: string, displayOrder = 0): Promise<number> {
    const result = await getDb()
      .prepare("INSERT INTO categories (name, slug, display_order) VALUES (?, ?, ?)")
      .run(name, slug, displayOrder);
    return Number(result.lastInsertRowid);
  },

  async hasName(name: string): Promise<boolean> {
    return Boolean(
      await getDb()
        .prepare("SELECT 1 FROM categories WHERE lower(name) = lower(?) LIMIT 1")
        .get(name)
    );
  },

  async nextDisplayOrder(): Promise<number> {
    const row = (await getDb()
      .prepare("SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM categories")
      .get()) as { next_order: number };
    return row.next_order;
  },

  async itemCount(id: number): Promise<number> {
    const row = (await getDb()
      .prepare("SELECT COUNT(*) AS count FROM menu_items WHERE category_id = ?")
      .get(id)) as { count: number };
    return row.count;
  },

  async remove(id: number, replacementId?: number): Promise<void> {
    const db = getDb();
    const categories = await CategoryModel.all();
    if (!categories.some((category) => category.id === id)) {
      throw new Error("Category not found.");
    }
    if (categories.length <= 1) {
      throw new Error("Keep at least one category in the menu.");
    }

    const itemCount = await CategoryModel.itemCount(id);
    if (itemCount > 0) {
      if (!replacementId || replacementId === id || !categories.some((category) => category.id === replacementId)) {
        throw new Error("Choose another category to move this category's menu items into.");
      }
    }

    await db.transaction(async () => {
      if (itemCount > 0 && replacementId) {
        await db.prepare("UPDATE menu_items SET category_id = ? WHERE category_id = ?").run(
          replacementId,
          id
        );
      }
      await db.prepare("DELETE FROM categories WHERE id = ?").run(id);
    });
  },
};

// ============================================================
// Menu items, variants and extras
// ============================================================
export interface MenuItem {
  id: number;
  name: string;
  description: string;
  price: number;
  category_id: number;
  category_name?: string;
  image_url: string;
  is_active: number | boolean;
  is_best_seller: number | boolean;
  display_order: number;
  stock_count: number;
  stock_tracking_enabled: number | boolean;
  low_stock_threshold: number;
  stock_status: "available" | "low" | "out";
  stock_note: string | null;
  stock_scope: "today" | "until_changed";
  stock_manual_out_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Variant {
  id: number;
  menu_item_id: number;
  name: string;
  variant_type: string;
  price_modifier: number;
  display_order: number;
}

export interface Extra {
  id: number;
  menu_item_id: number;
  name: string;
  price_modifier: number;
}

export interface Addon {
  id: number;
  name: string;
  price_modifier: number;
  is_active: number | boolean;
  display_order: number;
  created_at?: string;
}

export interface MenuItemFull extends MenuItem {
  variants: Variant[];
  extras: Extra[];
}

export function normalizeVariantGroups(input: unknown): {
  type: string;
  options: { name: string; price_modifier: number }[];
}[] {
  if (!Array.isArray(input) || input.length > 25) {
    throw new Error("Option groups must be a list with no more than 25 groups.");
  }

  const groupNames = new Set<string>();
  return input.map((rawGroup, groupIndex) => {
    if (!rawGroup || typeof rawGroup !== "object") {
      throw new Error(`Option group ${groupIndex + 1} is invalid.`);
    }

    const group = rawGroup as { type?: unknown; options?: unknown };
    const type = typeof group.type === "string" ? group.type.trim() : "";
    if (!type || type.length > 40) {
      throw new Error(`Option group ${groupIndex + 1} needs a name up to 40 characters.`);
    }
    if (groupNames.has(type.toLowerCase())) {
      throw new Error(`Option group "${type}" is duplicated.`);
    }
    groupNames.add(type.toLowerCase());

    if (!Array.isArray(group.options) || group.options.length === 0 || group.options.length > 50) {
      throw new Error(`"${type}" must have between 1 and 50 choices.`);
    }

    const optionNames = new Set<string>();
    const options = group.options.map((rawOption, optionIndex) => {
      if (!rawOption || typeof rawOption !== "object") {
        throw new Error(`Choice ${optionIndex + 1} in "${type}" is invalid.`);
      }
      const option = rawOption as { name?: unknown; price_modifier?: unknown };
      const name = typeof option.name === "string" ? option.name.trim() : "";
      const price_modifier = Number(option.price_modifier);
      if (!name || name.length > 60 || !Number.isFinite(price_modifier) || price_modifier < 0) {
        throw new Error(`Each choice in "${type}" needs a name and a valid non-negative price.`);
      }
      if (optionNames.has(name.toLowerCase())) {
        throw new Error(`Choice "${name}" is duplicated in "${type}".`);
      }
      optionNames.add(name.toLowerCase());
      return { name, price_modifier };
    });

    return { type, options };
  });
}

const menuStockColumnsReady = new WeakMap<object, Promise<void>>();

async function ensureMenuStockColumns(): Promise<void> {
  const db = getDb();
  const existing = menuStockColumnsReady.get(db);
  if (existing) return existing;
  const ready = (async () => {
    const columns = (await db.prepare("PRAGMA table_info(menu_items)").all()) as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === "stock_tracking_enabled")) {
      await db.exec(
        "ALTER TABLE menu_items ADD COLUMN stock_tracking_enabled INTEGER NOT NULL DEFAULT 1"
      );
    }
    if (!columns.some((column) => column.name === "stock_manual_out_date")) {
      await db.exec("ALTER TABLE menu_items ADD COLUMN stock_manual_out_date TEXT");
    }
  })();
  menuStockColumnsReady.set(db, ready);
  try {
    await ready;
  } catch (error) {
    menuStockColumnsReady.delete(db);
    throw error;
  }
}

async function orderingDateKey(): Promise<string> {
  return SettingsModel.paymentBusinessDate();
}

async function resetExpiredManualStockOuts(): Promise<void> {
  await ensureMenuStockColumns();
  const db = getDb();
  const today = await orderingDateKey();
  await db.prepare(
    `UPDATE menu_items
     SET stock_count = 0,
         updated_at = datetime('now', 'localtime')
     WHERE stock_manual_out_date IS NOT NULL
       AND stock_count > 0`
  ).run();
  await db.prepare(
    `UPDATE menu_items
     SET stock_status = CASE
           WHEN stock_tracking_enabled = 0 OR stock_count <= 0 THEN 'available'
           WHEN stock_count <= low_stock_threshold THEN 'low'
           ELSE 'available'
         END,
         stock_tracking_enabled = CASE
           WHEN stock_count <= 0 THEN 0
           ELSE stock_tracking_enabled
         END,
         stock_manual_out_date = NULL,
         stock_note = NULL,
         updated_at = datetime('now', 'localtime')
     WHERE stock_manual_out_date IS NOT NULL
       AND stock_scope = 'today'
       AND stock_manual_out_date <> ?`
  ).run(today);
}

async function attachOptions(item: MenuItem): Promise<MenuItemFull> {
  const db = getDb();
  const variants = (await db
    .prepare(
      "SELECT * FROM item_variants WHERE menu_item_id = ? ORDER BY variant_type, display_order"
    )
    .all(item.id)) as unknown as Variant[];
  const extras = (await db
    .prepare(
      `SELECT a.id, ia.menu_item_id, a.name, a.price_modifier
       FROM item_addons ia
       JOIN addons a ON a.id = ia.addon_id
       WHERE ia.menu_item_id = ? AND a.is_active = 1
       ORDER BY ia.display_order, a.display_order, a.name`
    )
    .all(item.id)) as unknown as Extra[];
  const trackingEnabled =
    item.stock_tracking_enabled !== false &&
    Number(item.stock_tracking_enabled) !== 0;
  // Sold out always means nothing left on hand. Manual "sold out for today"
  // flags zero the count, and any positive count moves the item back to
  // low/available so the badge and the count can never disagree.
  const manualOut = Boolean(item.stock_manual_out_date);
  const counted = trackingEnabled ? Math.max(0, Number(item.stock_count) || 0) : 0;
  const stockCount = manualOut ? 0 : counted;
  const stockStatus: MenuItem["stock_status"] = manualOut
    ? "out"
    : !trackingEnabled
      ? "available"
      : stockCount <= 0
        ? "out"
        : stockCount <= item.low_stock_threshold
          ? "low"
          : "available";
  return {
    ...item,
    stock_count: stockCount,
    stock_status: stockStatus,
    variants,
    extras,
  };
}

// ============================================================
// Add-on catalog (admin-managed)
// ============================================================
export const AddonModel = {
  async all(includeInactive = false): Promise<Addon[]> {
    return await getDb()
      .prepare(
        `SELECT * FROM addons
         ${includeInactive ? "" : "WHERE is_active = 1"}
         ORDER BY display_order, name`
      )
      .all() as unknown as Addon[];
  },

  async byId(id: number): Promise<Addon | undefined> {
    return await getDb().prepare("SELECT * FROM addons WHERE id = ?").get(id) as
      | Addon
      | undefined;
  },

  async create(data: {
    name: string;
    price_modifier?: number;
    is_active?: boolean;
    display_order?: number;
  }): Promise<number> {
    const result = await getDb()
      .prepare(
        `INSERT INTO addons (name, price_modifier, is_active, display_order)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        data.name.trim(),
        Number(data.price_modifier) || 0,
        data.is_active === false ? 0 : 1,
        Number(data.display_order) || 0
      );
    return Number(result.lastInsertRowid);
  },

  async update(id: number, data: Partial<Addon>): Promise<void> {
    const allowed = new Set(["name", "price_modifier", "is_active", "display_order"]);
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (allowed.has(key) && value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(
          key === "is_active"
            ? value
              ? 1
              : 0
            : key === "price_modifier" || key === "display_order"
              ? Number(value)
              : value
        );
      }
    }
    if (!fields.length) return;
    values.push(id);
    await getDb()
      .prepare(`UPDATE addons SET ${fields.join(", ")} WHERE id = ?`)
      .run(...(values as any[]));
  },

  async remove(id: number): Promise<void> {
    await getDb().prepare("DELETE FROM addons WHERE id = ?").run(id);
  },

  async idsForItem(menuItemId: number): Promise<number[]> {
    return (
      (await getDb()
        .prepare("SELECT addon_id FROM item_addons WHERE menu_item_id = ?")
        .all(menuItemId)) as unknown as { addon_id: number }[]
    ).map((row) => Number(row.addon_id));
  },

  async setForItem(menuItemId: number, addonIds: unknown[]): Promise<void> {
    const db = getDb();
    const ids = Array.from(
      new Set(
        addonIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
      )
    );
    await db.prepare("DELETE FROM item_addons WHERE menu_item_id = ?").run(menuItemId);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO item_addons (menu_item_id, addon_id, display_order) VALUES (?, ?, ?)"
    );
    for (const [index, addonId] of ids.entries()) {
      await insert.run(menuItemId, addonId, index);
    }
  },
};

export const MenuItemModel = {
  async allActive(): Promise<MenuItemFull[]> {
    await resetExpiredManualStockOuts();
    const rows = (await getDb()
      .prepare(
        `SELECT m.*, c.name AS category_name, c.display_order AS category_order
         FROM menu_items m
         JOIN categories c ON m.category_id = c.id
         WHERE m.is_active = 1
         ORDER BY c.display_order, m.display_order, m.name`
      )
      .all()) as unknown as MenuItem[];
    return Promise.all(rows.map(attachOptions));
  },

  async stockAlerts(
    limit = 20
  ): Promise<Pick<MenuItem, "id" | "name" | "stock_count" | "stock_status">[]> {
    await resetExpiredManualStockOuts();
    return (await getDb()
      .prepare(
        `SELECT id, name, stock_count, stock_status
         FROM menu_items
         WHERE is_active = 1
           AND (
             stock_status = 'out'
             OR (stock_tracking_enabled = 1 AND stock_status = 'low')
           )
         ORDER BY CASE stock_status WHEN 'out' THEN 0 ELSE 1 END, name
         LIMIT ?`
      )
      .all(Math.min(Math.max(limit, 1), 100))) as Pick<
      MenuItem,
      "id" | "name" | "stock_count" | "stock_status"
    >[];
  },

  async stockSnapshot(): Promise<Pick<
    MenuItem,
    "id" | "name" | "stock_count" | "stock_tracking_enabled" |
      "low_stock_threshold" | "stock_status" | "updated_at"
  >[]> {
    await resetExpiredManualStockOuts();
    return (await getDb()
      .prepare(
        `SELECT id, name, stock_count, stock_tracking_enabled,
                low_stock_threshold, stock_status, updated_at
         FROM menu_items
         WHERE is_active = 1 AND stock_tracking_enabled = 1
         ORDER BY id`
      )
      .all()) as Pick<
      MenuItem,
      "id" | "name" | "stock_count" | "stock_tracking_enabled" |
        "low_stock_threshold" | "stock_status" | "updated_at"
    >[];
  },

  async byCategory(): Promise<Record<string, MenuItemFull[]>> {
    const grouped: Record<string, MenuItemFull[]> = {};
    for (const item of await MenuItemModel.allActive()) {
      const key = item.category_name || "Menu";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    }
    return grouped;
  },

  async all(): Promise<MenuItemFull[]> {
    await resetExpiredManualStockOuts();
    const rows = (await getDb()
      .prepare(
        `SELECT m.*, c.name AS category_name
         FROM menu_items m
         JOIN categories c ON m.category_id = c.id
         ORDER BY c.display_order, m.display_order, m.name`
      )
      .all()) as unknown as MenuItem[];
    return Promise.all(rows.map(attachOptions));
  },

  async byId(id: number): Promise<MenuItemFull | undefined> {
    await resetExpiredManualStockOuts();
    const item = (await getDb()
      .prepare(
        `SELECT m.*, c.name AS category_name
         FROM menu_items m JOIN categories c ON m.category_id = c.id
         WHERE m.id = ?`
      )
      .get(id)) as MenuItem | undefined;
    return item ? await attachOptions(item) : undefined;
  },

  async create(data: {
    name: string;
    description?: string;
    price: number;
    category_id: number;
    image_url?: string;
    is_best_seller?: boolean;
    display_order?: number;
    stock_count?: number;
    stock_tracking_enabled?: boolean;
    stock_status?: string;
    stock_note?: string | null;
    stock_scope?: "today" | "until_changed";
  }): Promise<number> {
    await ensureMenuStockColumns();
    const trackingEnabled = data.stock_tracking_enabled !== false;
    const stock = trackingEnabled ? data.stock_count ?? 12 : 0;
    const stockStatus =
      trackingEnabled && stock <= 0
        ? "out"
        : data.stock_status || "available";
    const result = await getDb()
      .prepare(
        `INSERT INTO menu_items
          (name, description, price, category_id, image_url, is_best_seller, display_order, stock_count, stock_status, stock_note, stock_tracking_enabled, stock_scope, stock_manual_out_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.name,
        data.description || "",
        data.price,
        data.category_id,
        data.image_url || "",
        data.is_best_seller ? 1 : 0,
        data.display_order || 0,
        stock,
        stockStatus,
        data.stock_note || null,
        trackingEnabled ? 1 : 0,
        data.stock_scope || "today",
        stockStatus === "out" ? await orderingDateKey() : null
      );
    return Number(result.lastInsertRowid);
  },

  async setVariants(
    menuItemId: number,
    groups: { type: string; options: { name: string; price_modifier: number }[] }[]
  ): Promise<void> {
    await ensureMenuStockColumns();
    const db = getDb();
    const item = await db.prepare("SELECT id FROM menu_items WHERE id = ?").get(menuItemId);
    if (!item) throw new Error("Menu item not found.");

    const pglite = db as typeof db & Partial<PGliteDatabase>;
    if (pglite.transaction) {
      await pglite.transaction(async (transactionDb) => {
        await transactionDb
          .prepare("DELETE FROM item_variants WHERE menu_item_id = ?")
          .run(menuItemId);
        const insert = transactionDb.prepare(
          `INSERT INTO item_variants
             (menu_item_id, name, variant_type, price_modifier, display_order)
           VALUES (?, ?, ?, ?, ?)`
        );
        for (const group of groups) {
          for (const [index, option] of group.options.entries()) {
            await insert.run(
              menuItemId,
              option.name,
              group.type,
              option.price_modifier,
              index
            );
          }
        }
      });
      return;
    }

    await db.transaction(async () => {
      await db.prepare("DELETE FROM item_variants WHERE menu_item_id = ?").run(menuItemId);
      const insert = db.prepare(
        `INSERT INTO item_variants
           (menu_item_id, name, variant_type, price_modifier, display_order)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const group of groups) {
        for (const [index, option] of group.options.entries()) {
          await insert.run(
            menuItemId,
            option.name,
            group.type,
            option.price_modifier,
            index
          );
        }
      }
    });
  },

  async update(
    id: number,
    data: Partial<Omit<MenuItem, "stock_count">> & {
      stock_count?: number | null;
    }
  ): Promise<void> {
    await ensureMenuStockColumns();
    const updateData = { ...data };
    if (
      updateData.stock_tracking_enabled === false &&
      updateData.stock_count === null
    ) {
      updateData.stock_count = 0;
    }
    if (
      updateData.stock_count !== undefined ||
      updateData.stock_status !== undefined ||
      updateData.stock_tracking_enabled !== undefined
    ) {
      const current = await getDb()
        .prepare("SELECT stock_count, stock_tracking_enabled FROM menu_items WHERE id = ?")
        .get(id) as
        | { stock_count: number; stock_tracking_enabled: number }
        | undefined;
      const trackingEnabled =
        updateData.stock_tracking_enabled ?? current?.stock_tracking_enabled;
      const stockCount = updateData.stock_count ?? current?.stock_count;
      if (trackingEnabled && stockCount !== undefined && stockCount <= 0) {
        updateData.stock_status = "out";
      }
      if (
        updateData.stock_status === "out" &&
        trackingEnabled &&
        typeof stockCount === "number" &&
        stockCount > 0
      ) {
        // Sold out is only truthful when nothing is left on hand.
        updateData.stock_count = 0;
      }
    }
    if (
      updateData.stock_manual_out_date === undefined &&
      updateData.stock_status !== undefined
    ) {
      updateData.stock_manual_out_date =
        updateData.stock_status === "out" ? await orderingDateKey() : null;
    }
    const allowed = new Set([
      "name",
      "description",
      "price",
      "category_id",
      "image_url",
      "is_active",
      "is_best_seller",
      "display_order",
      "stock_count",
      "stock_tracking_enabled",
      "low_stock_threshold",
      "stock_status",
      "stock_note",
      "stock_scope",
      "stock_manual_out_date",
    ]);
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(updateData)) {
      if (allowed.has(key) && value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
      }
    }
    if (!fields.length) return;
    values.push(id);
    await getDb()
      .prepare(
        `UPDATE menu_items SET ${fields.join(", ")}, updated_at = datetime('now', 'localtime') WHERE id = ?`
      )
      .run(...(values as any[]));
  },

  async delete(id: number): Promise<void> {
    await getDb().prepare("DELETE FROM menu_items WHERE id = ?").run(id);
  },
};

export const StockModel = {
  async update(
    id: number,
    data: {
      stock_status: "available" | "low" | "out";
      stock_note?: string | null;
      stock_scope?: "today" | "until_changed";
      stock_count?: number | null;
      stock_tracking_enabled?: boolean;
      manual_out?: boolean;
      low_stock_threshold?: number;
    },
    userId?: number
  ): Promise<void> {
    await ensureMenuStockColumns();
    const previous = await MenuItemModel.byId(id);
    if (!previous) throw new Error("Menu item not found.");
    const trackingEnabled =
      data.manual_out === true
        ? true
        : data.stock_tracking_enabled ??
          (data.stock_count === undefined
            ? Boolean(previous.stock_tracking_enabled)
            : data.stock_count !== null);
    const stockCount = data.manual_out
      ? 0
      : trackingEnabled
      ? data.stock_count ?? previous.stock_count
      : 0;
    const scope = data.stock_scope || previous.stock_scope || "today";
    const manuallyOut = data.manual_out === true;
    const stockStatus =
      manuallyOut || (trackingEnabled && stockCount <= 0)
        ? "out"
        : !trackingEnabled
          ? "available"
          : stockCount <= (data.low_stock_threshold ?? previous.low_stock_threshold)
              ? "low"
              : "available";
    await MenuItemModel.update(id, {
      stock_status: stockStatus,
      stock_note: data.stock_note === undefined ? previous.stock_note : data.stock_note,
      stock_scope: scope,
      stock_count: stockCount,
      stock_tracking_enabled: trackingEnabled,
      stock_manual_out_date: manuallyOut ? await orderingDateKey() : null,
      low_stock_threshold:
        data.low_stock_threshold ?? previous.low_stock_threshold,
    });
    if (userId) {
      const updated = await MenuItemModel.byId(id);
      if (!updated) throw new Error("Menu item not found.");
      const action =
        updated.stock_status === "out"
          ? "out_of_stock"
          : updated.stock_status === "low"
            ? "orders_left"
            : previous?.stock_count !== updated.stock_count
              ? "quantity"
              : "restock";
      await getDb()
        .prepare(
          `INSERT INTO stock_logs (menu_item_id, action, quantity, note, created_by)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, action, updated.stock_count, data.stock_note ?? null, userId);
    }
  },
};

// ============================================================
// Orders
// ============================================================
export type OrderStatus =
  | "pending"
  | "payment_pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";
export type OrderType = "dine_in" | "take_out";
export type PaymentMethod = "gcash" | "counter" | "cash";
export type PaymentStatus = "pending" | "verified" | "rejected";

export interface OrderBalancePayment {
  id: number;
  order_id: number;
  amount: number;
  payment_method: "gcash" | "counter";
  status: "pending" | "verified" | "rejected";
  payment_reference?: string | null;
  payment_proof_url?: string | null;
  received_by?: number | null;
  received_by_name?: string | null;
  created_at: string;
  verified_at?: string | null;
}

export interface Order {
  id: number;
  table_number: number;
  order_type: OrderType;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  customer_name?: string | null;
  subtotal: number;
  service_charge: number;
  total: number;
  discount_amount?: number;
  discounts?: OrderDiscount[];
  discounts_json?: string | null;
  remarks?: string | null;
  queue_number?: number | null;
  order_number?: number;
  created_at: string;
  updated_at: string;
  confirmed_at?: string | null;
  preparing_at?: string | null;
  cancelled_at?: string | null;
  ready_at?: string | null;
  completed_at?: string | null;
  completion_reason?: string | null;
  cancellation_reason?: string | null;
  payment_proof_url?: string | null;
  payment_reference?: string | null;
  payment_amount?: number | null;
  cash_received?: number | null;
  change_given?: number | null;
  balance_due?: number;
  balance_payments?: OrderBalancePayment[];
  prep_minutes?: number | null;
  estimated_ready_at?: string | null;
  items?: OrderItem[];
}

export interface OrderItemAddon {
  id: number;
  order_id: number;
  order_item_id: number;
  addon_id?: number | null;
  name: string;
  price_modifier: number;
  quantity: number;
  added_by?: number | null;
  added_by_name?: string | null;
  created_at: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  menu_item_id: number;
  name: string;
  variant_name?: string | null;
  extras: string;
  sugar_level?: string | null;
  note?: string | null;
  quantity: number;
  price_at_time: number;
  addons?: OrderItemAddon[];
}

async function balancePaymentsFor(orderId: number): Promise<OrderBalancePayment[]> {
  return (await orderDetailsFor([{ id: orderId } as Order]))[0]?.balance_payments || [];
}

function balanceDueFor(
  order: Order,
  payments: OrderBalancePayment[]
): number {
  if (order.payment_status !== "verified") return 0;
  const round = (value: number) => Math.round(value * 100) / 100;
  const initialPaid =
    order.payment_amount == null
      ? order.payment_method === "counter"
        ? Number(order.total)
        : 0
      : Number(order.payment_amount);
  const additionalPaid = payments
    .filter((payment) => payment.status === "verified")
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  return Math.max(0, round(Number(order.total) - initialPaid - additionalPaid));
}

async function gcashReferenceIsInUse(
  reference: string,
  excludedBalancePaymentId?: number,
  excludedOrderId?: number
): Promise<boolean> {
  const db = getDb();
  const initialPayment = await db
    .prepare(
      `SELECT 1 FROM orders
       WHERE payment_method = 'gcash'
         AND payment_status IN ('pending', 'verified')
         AND payment_reference = ?
         AND (CAST(? AS INTEGER) IS NULL OR id != ?)
       LIMIT 1`
    )
    .get(reference, excludedOrderId ?? null, excludedOrderId ?? null);
  if (initialPayment) return true;
  const balancePayment = await db
    .prepare(
      `SELECT 1 FROM order_balance_payments
       WHERE payment_method = 'gcash'
         AND status IN ('pending', 'verified')
         AND payment_reference = ?
         AND (CAST(? AS INTEGER) IS NULL OR id != ?)
       LIMIT 1`
    )
    .get(reference, excludedBalancePaymentId ?? null, excludedBalancePaymentId ?? null);
  return Boolean(balancePayment);
}

const ORDER_COLUMNS = `
  id, table_number, order_type, status, payment_method, payment_status,
  customer_name, subtotal, service_charge, total, remarks, queue_number,
  (SELECT COUNT(*) + 1
   FROM orders earlier
   WHERE earlier.created_at >= date(orders.created_at)
     AND earlier.created_at < date(orders.created_at, '+1 day')
     AND (earlier.created_at < orders.created_at
       OR (earlier.created_at = orders.created_at AND earlier.id < orders.id))
  ) AS order_number,
  created_at, updated_at, confirmed_at, preparing_at, cancelled_at, ready_at, completed_at,
  completion_reason, cancellation_reason,
  payment_proof_url, payment_reference, payment_amount, cash_received,
  change_given, prep_minutes, discount_amount, discounts_json,
  estimated_ready_at
`;

const orderColumnsReady = new WeakMap<object, Promise<void>>();
const orderPaymentRejectionsReady = new WeakMap<object, Promise<void>>();

async function ensureOrderColumns(): Promise<void> {
  const db = getDb();
  const existing = orderColumnsReady.get(db);
  if (existing) return existing;
  const ready = (async () => {
    const columns = (await db.prepare("PRAGMA table_info(orders)").all()) as {
      name: string;
    }[];
    const add = async (name: string, sql: string) => {
      if (!columns.some((column) => column.name === name)) {
        await db.exec(sql);
      }
    };
    await add("cash_received", "ALTER TABLE orders ADD COLUMN cash_received REAL");
    await add("change_given", "ALTER TABLE orders ADD COLUMN change_given REAL");
    await add(
      "cancellation_reason",
      "ALTER TABLE orders ADD COLUMN cancellation_reason TEXT"
    );
    await add("preparing_at", "ALTER TABLE orders ADD COLUMN preparing_at TEXT");
    await add(
      "discount_amount",
      "ALTER TABLE orders ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0"
    );
    await add("discounts_json", "ALTER TABLE orders ADD COLUMN discounts_json TEXT");
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_orders_preparing_at ON orders(preparing_at)"
    );
  })();
  orderColumnsReady.set(db, ready);
  try {
    await ready;
  } catch (error) {
    orderColumnsReady.delete(db);
    throw error;
  }
}

async function ensureOrderPaymentRejectionsTable(): Promise<void> {
  const db = getDb();
  const existing = orderPaymentRejectionsReady.get(db);
  if (existing) return existing;
  const ready = (async () => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS order_payment_rejections (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        rejected_at TEXT NOT NULL,
        rejected_by TEXT,
        payment_proof_url TEXT,
        payment_reference TEXT,
        payment_amount REAL NOT NULL
      )
    `);
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_order_payment_rejections_rejected_at ON order_payment_rejections(rejected_at)"
    );
  })();
  orderPaymentRejectionsReady.set(db, ready);
  try {
    await ready;
  } catch (error) {
    orderPaymentRejectionsReady.delete(db);
    throw error;
  }
}

function discountRecipientsFromJson(value?: string | null): DiscountRecipient[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Saved order discounts are invalid.");
  }
  return parsed.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !["staff", "senior", "pwd", "other"].includes(
        String((entry as Record<string, unknown>).type)
      )
    ) {
      throw new Error("Saved order discounts are invalid.");
    }
    const discount = entry as Record<string, unknown>;
    return {
      type: discount.type as DiscountRecipient["type"],
      id_number: String(discount.id_number || ""),
      name: String(discount.name || ""),
    };
  });
}

function discountsFromJson(value?: string | null): OrderDiscount[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Saved order discounts are invalid.");
  }
  return parsed.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !["staff", "senior", "pwd", "other"].includes(
        String((entry as Record<string, unknown>).type)
      )
    ) {
      throw new Error("Saved order discounts are invalid.");
    }
    const discount = entry as Record<string, unknown>;
    if (
      typeof discount.id_number !== "string" ||
      typeof discount.name !== "string" ||
      typeof discount.meal_discount !== "number" ||
      typeof discount.drink_discount !== "number" ||
      typeof discount.discount_amount !== "number"
    ) {
      throw new Error("Saved order discounts are invalid.");
    }
    return {
      type: discount.type as OrderDiscount["type"],
      id_number: discount.id_number,
      name: discount.name,
      meal_discount: discount.meal_discount,
      drink_discount: discount.drink_discount,
      discount_amount: discount.discount_amount,
    };
  });
}

async function calculateDiscountsForOrder(
  orderId: number,
  recipients: DiscountRecipient[]
): Promise<OrderDiscount[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT oi.id, oi.quantity, oi.price_at_time AS unit_price, c.name AS category_name
       FROM order_items oi
       JOIN menu_items mi ON mi.id = oi.menu_item_id
       JOIN categories c ON c.id = mi.category_id
       WHERE oi.order_id = ?
       ORDER BY oi.id`
    )
    .all(orderId)) as unknown as {
    id: number;
    quantity: number;
    unit_price: number;
    category_name: string;
  }[];
  return calculateOrderDiscounts(rows, recipients);
}

async function orderDetailsFor(orders: Order[]): Promise<Order[]> {
  const detailed: Order[] = [];
  for (let start = 0; start < orders.length; start += 300) {
    detailed.push(...(await orderDetailsBatch(orders.slice(start, start + 300))));
  }
  return detailed;
}

async function orderDetailsBatch(orders: Order[]): Promise<Order[]> {
  if (!orders.length) return [];

  const db = getDb();
  const placeholders = orders.map(() => "?").join(", ");
  const ids = orders.map((order) => order.id);
  const items = (await db
    .prepare(
      `SELECT * FROM order_items
       WHERE order_id IN (${placeholders})
       ORDER BY order_id, id`
    )
    .all(...ids)) as unknown as OrderItem[];
  const addons = (await db
    .prepare(
      `SELECT oia.*, u.name AS added_by_name
       FROM order_item_addons oia
       LEFT JOIN users u ON u.id = oia.added_by
       WHERE oia.order_id IN (${placeholders})
       ORDER BY oia.order_id, oia.id`
    )
    .all(...ids)) as unknown as OrderItemAddon[];
  const payments = (await db
    .prepare(
      `SELECT obp.*, u.name AS received_by_name
       FROM order_balance_payments obp
       LEFT JOIN users u ON u.id = obp.received_by
       WHERE obp.order_id IN (${placeholders})
       ORDER BY obp.order_id, obp.created_at, obp.id`
    )
    .all(...ids)) as unknown as OrderBalancePayment[];

  const addonsByItem = new Map<number, OrderItemAddon[]>();
  for (const addon of addons) {
    const itemAddons = addonsByItem.get(addon.order_item_id) || [];
    itemAddons.push(addon);
    addonsByItem.set(addon.order_item_id, itemAddons);
  }

  const itemsByOrder = new Map<number, OrderItem[]>();
  for (const item of items) {
    const orderItems = itemsByOrder.get(item.order_id) || [];
    orderItems.push({ ...item, addons: addonsByItem.get(item.id) || [] });
    itemsByOrder.set(item.order_id, orderItems);
  }

  const paymentsByOrder = new Map<number, OrderBalancePayment[]>();
  for (const payment of payments) {
    const orderPayments = paymentsByOrder.get(payment.order_id) || [];
    orderPayments.push(payment);
    paymentsByOrder.set(payment.order_id, orderPayments);
  }

  return orders.map((order) => {
    const orderPayments = paymentsByOrder.get(order.id) || [];
    const { discounts_json: discountsJson, ...orderFields } = order;
    return {
      ...orderFields,
      items: itemsByOrder.get(order.id) || [],
      balance_payments: orderPayments,
      balance_due: balanceDueFor(order, orderPayments),
      discounts: discountsFromJson(discountsJson),
    };
  });
}

const orderStockDeductionsReady = new WeakMap<object, Promise<void>>();
const staffNotificationReadsReady = new WeakMap<object, Promise<void>>();

async function ensureOrderStockDeductionsTable(): Promise<void> {
  const db = getDb();
  const existing = orderStockDeductionsReady.get(db);
  if (existing) return existing;
  const ready = (async () => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS order_stock_deductions (
        id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        order_id INTEGER NOT NULL,
        order_item_id INTEGER NOT NULL UNIQUE,
        menu_item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        previous_stock_status TEXT NOT NULL DEFAULT 'available',
        created_at TEXT NOT NULL DEFAULT (to_char(timezone('Asia/Manila', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS')),
        restored_at TEXT,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_order_stock_deductions_order
        ON order_stock_deductions(order_id, restored_at);
    `);
    const columns = (await db
      .prepare("PRAGMA table_info(order_stock_deductions)")
      .all()) as { name: string }[];
    if (!columns.some((column) => column.name === "previous_stock_status")) {
      await db.exec(
        "ALTER TABLE order_stock_deductions ADD COLUMN previous_stock_status TEXT NOT NULL DEFAULT 'available'"
      );
    }
  })();
  orderStockDeductionsReady.set(db, ready);
  try {
    await ready;
  } catch (error) {
    orderStockDeductionsReady.delete(db);
    throw error;
  }
}

async function ensureStaffNotificationReadsTable(): Promise<void> {
  const db = getDb();
  const existing = staffNotificationReadsReady.get(db);
  if (existing) return existing;
  const ready = db.exec(`
    CREATE TABLE IF NOT EXISTS staff_notification_reads (
      user_id INTEGER NOT NULL,
      notification_id TEXT NOT NULL,
      read_at TEXT NOT NULL DEFAULT (to_char(timezone('Asia/Manila', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS')),
      PRIMARY KEY (user_id, notification_id)
    );
    CREATE INDEX IF NOT EXISTS idx_staff_notification_reads_user
      ON staff_notification_reads(user_id, read_at);
  `);
  staffNotificationReadsReady.set(db, ready);
  try {
    await ready;
  } catch (error) {
    staffNotificationReadsReady.delete(db);
    throw error;
  }
}

class InsufficientMenuStockError extends Error {}

class OrderChangeConflict extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

async function deductMenuItemStock(
  orderId: number,
  orderItemId: number,
  menuItemId: number,
  quantity: number
): Promise<void> {
  await ensureMenuStockColumns();
  const db = getDb();
  const item = (await db
    .prepare(
      `SELECT name, stock_count, stock_tracking_enabled,
              low_stock_threshold, stock_status
       FROM menu_items WHERE id = ?`
    )
    .get(menuItemId)) as
    | {
        name: string;
        stock_count: number;
        stock_tracking_enabled: number;
        low_stock_threshold: number;
        stock_status: "available" | "low" | "out";
      }
    | undefined;

  if (!item || item.stock_status === "out") {
    throw new InsufficientMenuStockError(
      `${item?.name || "This item"} is sold out. Please update your cart.`
    );
  }
  if (!item.stock_tracking_enabled) return;
  if (item.stock_count < quantity) {
    const remaining = Math.max(0, item?.stock_count || 0);
    throw new InsufficientMenuStockError(
      remaining > 0
        ? `Only ${remaining} ${item.name} left. Update your cart quantity and try again.`
        : `${item.name} is sold out. Please update your cart.`
    );
  }

  const nextCount = item.stock_count - quantity;
  const nextStatus =
    nextCount === 0
      ? "out"
      : nextCount <= item.low_stock_threshold
        ? "low"
        : "available";
  const update = await db
    .prepare(
      `UPDATE menu_items
       SET stock_count = ?, stock_status = ?,
           updated_at = datetime('now', 'localtime')
       WHERE id = ? AND stock_count >= ? AND stock_status != 'out'`
    )
    .run(nextCount, nextStatus, menuItemId, quantity);
  if (Number(update.changes) !== 1) {
    throw new InsufficientMenuStockError(
      `${item.name} stock changed while placing your order. Please try again.`
    );
  }

  await db.prepare(
    `INSERT INTO order_stock_deductions
       (order_id, order_item_id, menu_item_id, quantity, previous_stock_status)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orderId, orderItemId, menuItemId, quantity, item.stock_status);
}

async function restoreOrderStock(orderId: number): Promise<void> {
  await ensureMenuStockColumns();
  const db = getDb();
  const deductions = (await db
    .prepare(
      `SELECT id, menu_item_id, quantity, previous_stock_status
       FROM order_stock_deductions
       WHERE order_id = ? AND restored_at IS NULL
       ORDER BY id DESC`
    )
    .all(orderId)) as {
    id: number;
    menu_item_id: number;
    quantity: number;
    previous_stock_status: "available" | "low" | "out";
  }[];

  for (const deduction of deductions) {
    const item = (await db
      .prepare(
        `SELECT stock_count, stock_tracking_enabled, stock_manual_out_date,
                low_stock_threshold, stock_status
         FROM menu_items WHERE id = ?`
      )
      .get(deduction.menu_item_id)) as
      | {
          stock_count: number;
          stock_tracking_enabled: number;
          stock_manual_out_date: string | null;
          low_stock_threshold: number;
          stock_status: "available" | "low" | "out";
        }
      | undefined;

    if (item) {
      const nextCount = item.stock_count + deduction.quantity;
      let nextStatus: "available" | "low" | "out";
      if (item.stock_manual_out_date) {
        nextStatus = "out";
      } else if (!item.stock_tracking_enabled) {
        nextStatus = "available";
      } else {
        nextStatus =
          nextCount <= 0
            ? "out"
            : nextCount <= item.low_stock_threshold
              ? "low"
              : "available";
      }
      await db.prepare(
        `UPDATE menu_items
         SET stock_count = ?, stock_status = ?,
             updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      ).run(nextCount, nextStatus, deduction.menu_item_id);
    }

    await db.prepare(
      `UPDATE order_stock_deductions
       SET restored_at = datetime('now', 'localtime')
       WHERE id = ? AND restored_at IS NULL`
    ).run(deduction.id);
  }
}

async function cancelUnpaidOrder(
  id: number,
  guestId?: string,
  cancellationReason?: string
): Promise<boolean> {
  await ensureOrderColumns();
  await ensureOrderStockDeductionsTable();
  const db = getDb();
  return db.transaction(async () => {
    const result = await db
      .prepare(
        `UPDATE orders
         SET status = 'cancelled',
             cancelled_at = datetime('now', 'localtime'),
             cancellation_reason = COALESCE(?, cancellation_reason),
             updated_at = datetime('now', 'localtime')
         WHERE id = ?
           AND status IN ('pending', 'payment_pending')
           AND payment_status != 'verified'
           ${
             cancellationReason === "unpaid_timeout"
               ? `AND payment_status = 'pending'
                  AND payment_method IN ('counter', 'cash')
                  AND created_at <= datetime('now', 'localtime', '-90 minutes')`
               : ""
           }
           ${guestId === undefined ? "" : "AND guest_id = ?"}`
      )
      .run(
        cancellationReason ?? null,
        ...(guestId === undefined ? [id] : [id, guestId])
      );
    if (Number(result.changes) !== 1) {
      return false;
    }
    await restoreOrderStock(id);
    return true;
  });
}

export const OrderModel = {
  async autoCancelUnpaidCounterOrders(): Promise<number> {
    await ensureOrderColumns();
    const orders = (await getDb()
      .prepare(
        `SELECT id FROM orders
         WHERE status IN ('pending', 'payment_pending')
           AND payment_method IN ('counter', 'cash')
           AND payment_status = 'pending'
           AND created_at <= datetime('now', 'localtime', '-90 minutes')
         ORDER BY id`
      )
      .all()) as { id: number }[];
    let cancelled = 0;
    for (const order of orders) {
      if (await cancelUnpaidOrder(order.id, undefined, "unpaid_timeout")) {
        cancelled += 1;
      }
    }
    return cancelled;
  },

  async recentVerified(
    limit = 10,
    offset = 0,
    date?: string
  ): Promise<{ orders: Order[]; total: number }> {
    await ensureOrderColumns();
    const db = getDb();
    const dayFilter = date ? "AND date(confirmed_at) = date(?)" : "";
    const params: string[] = date ? [date] : [];
    const orders = (await db
      .prepare(
        `SELECT ${ORDER_COLUMNS} FROM orders
         WHERE payment_status = 'verified' AND confirmed_at IS NOT NULL ${dayFilter}
         ORDER BY confirmed_at DESC, id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset)) as unknown as Order[];
    const row = (await db
      .prepare(
        `SELECT COUNT(*) AS total FROM orders
         WHERE payment_status = 'verified' AND confirmed_at IS NOT NULL ${dayFilter}`
      )
      .get(...params)) as { total: number };
    return {
      orders: await orderDetailsFor(orders),
      total: Number(row.total),
    };
  },

  async salesForDate(date: string): Promise<SalesTransaction[]> {
    await ensureOrderColumns();
    await ensureActivityTable();
    return (await getDb()
      .prepare(
        `SELECT * FROM (
           SELECT
             'order-' || id AS transaction_id,
             id AS order_id,
             (SELECT COUNT(*) + 1
              FROM orders earlier
              WHERE earlier.created_at >= date(orders.created_at)
                AND earlier.created_at < date(orders.created_at, '+1 day')
                AND (earlier.created_at < orders.created_at
                  OR (earlier.created_at = orders.created_at AND earlier.id < orders.id))
             ) AS order_number,
             table_number,
             COALESCE(customer_name, 'Guest') AS customer_name,
             CASE WHEN payment_method = 'gcash' THEN 'gcash' ELSE 'counter' END AS payment_method,
             COALESCE(payment_amount, total) AS amount,
             confirmed_at AS paid_at,
             payment_reference,
             (SELECT NULLIF(log.actor_name, 'Merrylane staff')
              FROM activity_logs AS log
              WHERE log.action = 'payment.verified'
                AND log.entity_type = 'order'
                AND log.entity_id = orders.id
              ORDER BY log.created_at DESC, log.id DESC
              LIMIT 1) AS handled_by,
             'order' AS transaction_type
           FROM orders
           WHERE payment_status = 'verified'
             AND confirmed_at IS NOT NULL
             AND confirmed_at >= ?
             AND confirmed_at < date(?, '+1 day')

           UNION ALL

           SELECT
             'balance-' || payments.id AS transaction_id,
             payments.order_id,
             (SELECT COUNT(*) + 1
              FROM orders earlier
              WHERE earlier.created_at >= date(orders.created_at)
                AND earlier.created_at < date(orders.created_at, '+1 day')
                AND (earlier.created_at < orders.created_at
                  OR (earlier.created_at = orders.created_at AND earlier.id < orders.id))
             ) AS order_number,
             orders.table_number,
             COALESCE(orders.customer_name, 'Guest') AS customer_name,
             payments.payment_method,
             payments.amount,
             payments.verified_at AS paid_at,
             payments.payment_reference,
             (SELECT users.name
              FROM users
              WHERE users.id = payments.received_by) AS handled_by,
             'additional' AS transaction_type
           FROM order_balance_payments AS payments
           JOIN orders ON orders.id = payments.order_id
           WHERE payments.status = 'verified'
             AND payments.verified_at IS NOT NULL
             AND payments.verified_at >= ?
             AND payments.verified_at < date(?, '+1 day')
         )
         ORDER BY paid_at DESC, order_id DESC`
      )
      .all(date, date, date, date)) as unknown as SalesTransaction[];
  },

  async salesTotalsForRange(
    startDate: string,
    endDateExclusive: string
  ): Promise<{ amount: number; transactions: number }> {
    await ensureOrderColumns();
    const row = (await getDb()
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS transactions
         FROM (
           SELECT COALESCE(payment_amount, total, 0) AS amount
           FROM orders
           WHERE payment_status = 'verified'
             AND confirmed_at IS NOT NULL
             AND confirmed_at >= ?
             AND confirmed_at < ?

           UNION ALL

           SELECT amount
           FROM order_balance_payments
           WHERE status = 'verified'
             AND verified_at IS NOT NULL
             AND verified_at >= ?
             AND verified_at < ?
         )`
      )
      .get(startDate, endDateExclusive, startDate, endDateExclusive)) as {
      amount: number;
      transactions: number;
    };
    return {
      amount: Number(row.amount || 0),
      transactions: Number(row.transactions || 0),
    };
  },

  async cancelledForDate(date: string): Promise<Order[]> {
    await ensureOrderColumns();
    const orders = (await getDb()
      .prepare(
        `SELECT ${ORDER_COLUMNS} FROM orders
         WHERE status = 'cancelled'
           AND cancelled_at IS NOT NULL
           AND cancelled_at >= ?
           AND cancelled_at < date(?, '+1 day')
         ORDER BY cancelled_at DESC, id DESC`
      )
      .all(date, date)) as unknown as Order[];
    return orderDetailsFor(orders);
  },

  async rejectedPaymentsForDate(date: string): Promise<RejectedPayment[]> {
    await ensureOrderColumns();
    await ensureOrderPaymentRejectionsTable();
    const records = (await getDb()
      .prepare(
        `SELECT
           rejections.id AS rejection_id,
           orders.id AS order_id,
           ROW_NUMBER() OVER (
             PARTITION BY orders.created_at::timestamp::date
             ORDER BY orders.created_at, orders.id
           ) AS order_number,
           orders.table_number,
           COALESCE(orders.customer_name, 'Guest') AS customer_name,
           orders.payment_method,
           rejections.payment_amount AS amount,
           rejections.rejected_at,
           rejections.rejected_by,
           rejections.payment_reference,
           CASE
             WHEN rejections.payment_proof_url LIKE 'data:image/%' THEN 'inline'
             WHEN rejections.payment_proof_url IS NOT NULL THEN 'external'
             ELSE NULL
           END AS proof_type,
           CASE
             WHEN rejections.payment_proof_url IS NOT NULL
               AND rejections.payment_proof_url NOT LIKE 'data:image/%'
             THEN rejections.payment_proof_url
             ELSE NULL
           END AS external_proof_url
         FROM order_payment_rejections AS rejections
         JOIN orders ON orders.id = rejections.order_id
         WHERE rejections.rejected_at::timestamp >= ?::timestamp
           AND rejections.rejected_at::timestamp < (?::date + INTERVAL '1 day')
         ORDER BY rejections.rejected_at DESC, rejections.id DESC`
      )
      .all(`${date} 00:00:00`, date)) as unknown as RejectedPayment[];
    return records.map((record) => ({
      ...record,
      rejection_id: Number(record.rejection_id),
      order_id: Number(record.order_id),
      order_number: Number(record.order_number),
      table_number: Number(record.table_number),
      amount: Number(record.amount),
    }));
  },

  async rejectedPaymentProof(rejectionId: number): Promise<string | null> {
    await ensureOrderPaymentRejectionsTable();
    const record = (await getDb()
      .prepare(
        `SELECT payment_proof_url
         FROM order_payment_rejections
         WHERE id = ?`
      )
      .get(rejectionId)) as { payment_proof_url: string | null } | undefined;
    return record?.payment_proof_url ?? null;
  },

  async unpaidTimeoutCancellationsForDate(date: string): Promise<Order[]> {
    await ensureOrderColumns();
    const orders = (await getDb()
      .prepare(
        `SELECT ${ORDER_COLUMNS} FROM orders
         WHERE status = 'cancelled'
           AND cancellation_reason = 'unpaid_timeout'
           AND cancelled_at IS NOT NULL
           AND cancelled_at >= ?
           AND cancelled_at < date(?, '+1 day')
         ORDER BY cancelled_at DESC, id DESC`
      )
      .all(date, date)) as unknown as Order[];
    return orderDetailsFor(orders);
  },

  async recentUnpaidTimeoutCancellations(limit = 100): Promise<Order[]> {
    await ensureOrderColumns();
    const orders = (await getDb()
      .prepare(
        `SELECT ${ORDER_COLUMNS} FROM orders
         WHERE status = 'cancelled'
           AND cancellation_reason = 'unpaid_timeout'
           AND cancelled_at >= datetime('now', 'localtime', '-30 days')
         ORDER BY cancelled_at DESC, id DESC
         LIMIT ?`
      )
      .all(Math.min(Math.max(limit, 1), 200))) as unknown as Order[];
    return orderDetailsFor(orders);
  },

  async notificationReads(userId: number): Promise<string[]> {
    await ensureStaffNotificationReadsTable();
    return (
      (await getDb()
        .prepare(
          "SELECT notification_id FROM staff_notification_reads WHERE user_id = ?"
        )
        .all(userId)) as unknown as { notification_id: string }[]
    ).map((row) => row.notification_id);
  },

  async markNotificationRead(userId: number, notificationId: string): Promise<void> {
    await ensureStaffNotificationReadsTable();
    await getDb()
      .prepare(
        `INSERT OR IGNORE INTO staff_notification_reads (user_id, notification_id)
         VALUES (?, ?)`
      )
      .run(userId, notificationId);
  },

  async markNotificationsRead(
    userId: number,
    notificationIds: string[]
  ): Promise<void> {
    await ensureStaffNotificationReadsTable();
    const db = getDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO staff_notification_reads (user_id, notification_id)
       VALUES (?, ?)`
    );
    await db.transaction(async () => {
      for (const id of new Set(notificationIds)) {
        await insert.run(userId, id);
      }
    });
  },

  async gcashReferenceIsInUse(
    reference: string,
    excludedOrderId?: number
  ): Promise<boolean> {
    return gcashReferenceIsInUse(reference.trim(), undefined, excludedOrderId);
  },

  async create(data: {
    table_number: number;
    order_type: OrderType;
    payment_method: PaymentMethod;
    customer_name?: string;
    subtotal: number;
    service_charge?: number;
    total: number;
    remarks?: string;
    status?: OrderStatus;
    guest_id: string;
    payment_proof_url?: string | null;
    payment_reference?: string | null;
    payment_amount?: number | null;
  }): Promise<number> {
    const result = await getDb()
      .prepare(
        `INSERT INTO orders
           (table_number, order_type, status, payment_method, payment_status,
            customer_name, subtotal, service_charge, total, remarks, guest_id,
            payment_proof_url, payment_reference, payment_amount)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.table_number,
        data.order_type,
        data.status || "pending",
        data.payment_method,
        data.customer_name?.trim() || null,
        data.subtotal,
        data.service_charge || 0,
        data.total,
        data.remarks || null,
        data.guest_id,
        data.payment_proof_url ?? null,
        data.payment_reference ?? null,
        data.payment_amount ?? null
      );
    return Number(result.lastInsertRowid);
  },

  async createWithStockDeduction(data: {
    order: {
      table_number: number;
      order_type: OrderType;
      payment_method: PaymentMethod;
      customer_name?: string;
      subtotal: number;
      service_charge?: number;
      total: number;
      remarks?: string;
      status?: OrderStatus;
      guest_id: string;
      payment_proof_url?: string | null;
      payment_reference?: string | null;
      payment_amount?: number | null;
    };
    items: {
      menu_item_id: number;
      name: string;
      variant_name?: string;
      extras: string;
      sugar_level?: string | null;
      note?: string | null;
      quantity: number;
      price_at_time: number;
    }[];
  }): Promise<
    { ok: true; orderId: number } | { ok: false; error: string; status: number }
  > {
    await ensureOrderStockDeductionsTable();
    await ensureMenuStockColumns();
    const db = getDb();
    try {
      return await db.transaction(async () => {
        for (const [menuItemId, quantity] of data.items.reduce((totals, item) => {
          totals.set(
            item.menu_item_id,
            (totals.get(item.menu_item_id) || 0) + item.quantity
          );
          return totals;
        }, new Map<number, number>())) {
          const item = (await db
            .prepare(
              `SELECT name, stock_count, stock_tracking_enabled, stock_status
               FROM menu_items WHERE id = ?`
            )
            .get(menuItemId)) as
            | {
                name: string;
                stock_count: number;
                stock_tracking_enabled: number;
                stock_status: string;
              }
            | undefined;
          if (
            !item ||
            item.stock_status === "out" ||
            (item.stock_tracking_enabled !== 0 && item.stock_count < quantity)
          ) {
            throw new InsufficientMenuStockError(
              item && item.stock_tracking_enabled !== 0 && item.stock_count > 0
                ? `Only ${item.stock_count} ${item.name} left. Update your cart quantity and try again.`
                : `${item?.name || "This item"} is sold out. Please update your cart.`
            );
          }
        }

        const orderId = await OrderModel.create(data.order);
        for (const item of data.items) {
          const orderItemId = await OrderModel.createItem(orderId, item);
          await deductMenuItemStock(
            orderId,
            orderItemId,
            item.menu_item_id,
            item.quantity
          );
        }
        return { ok: true as const, orderId };
      });
    } catch (error: unknown) {
      if (error instanceof InsufficientMenuStockError) {
        return { ok: false, error: error.message, status: 409 };
      }
      throw error;
    }
  },

  async createItem(
    orderId: number,
    data: {
      menu_item_id: number;
      name: string;
      variant_name?: string;
      extras: string;
      sugar_level?: string | null;
      note?: string | null;
      quantity: number;
      price_at_time: number;
    }
  ): Promise<number> {
    const result = await getDb()
      .prepare(
        `INSERT INTO order_items
           (order_id, menu_item_id, name, variant_name, extras, sugar_level, note, quantity, price_at_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        orderId,
        data.menu_item_id,
        data.name,
        data.variant_name || null,
        data.extras,
        data.sugar_level || null,
        data.note || null,
        data.quantity,
        data.price_at_time
      );
    return Number(result.lastInsertRowid);
  },

  async byId(id: number): Promise<Order | undefined> {
    await ensureOrderColumns();
    const db = getDb();
    const order = (await db
      .prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = ?`)
      .get(id)) as Order | undefined;
    if (!order) return undefined;
    return (await orderDetailsFor([order]))[0];
  },

  async guestOwner(id: number): Promise<string | null | undefined> {
    const order = (await getDb()
      .prepare("SELECT guest_id FROM orders WHERE id = ?")
      .get(id)) as { guest_id: string | null } | undefined;
    return order?.guest_id;
  },

  async cancelUnpaidForGuest(id: number, guestId: string): Promise<boolean> {
    return cancelUnpaidOrder(id, guestId);
  },

  async cancelUnpaidByStaff(id: number): Promise<boolean> {
    return cancelUnpaidOrder(id);
  },

  async byGuest(guestId: string): Promise<Order[]> {
    await ensureOrderColumns();
    const orders = (await getDb()
      .prepare(
        `SELECT ${ORDER_COLUMNS} FROM orders
         WHERE guest_id = ? ORDER BY created_at DESC, id DESC`
      )
      .all(guestId)) as unknown as Order[];
    return orderDetailsFor(orders);
  },

  async byIds(ids: number[]): Promise<Order[]> {
    await ensureOrderColumns();
    const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (!uniqueIds.length) return [];
    const orders = (await getDb()
      .prepare(
        `SELECT ${ORDER_COLUMNS} FROM orders
         WHERE id IN (${uniqueIds.map(() => "?").join(", ")})`
      )
      .all(...uniqueIds)) as unknown as Order[];
    return orderDetailsFor(orders);
  },

  async list(statuses?: OrderStatus[], limit = 100): Promise<Order[]> {
    await ensureOrderColumns();
    const db = getDb();
    let query = `SELECT ${ORDER_COLUMNS} FROM orders`;
    const params: unknown[] = [];
    if (statuses?.length) {
      query += ` WHERE status IN (${statuses.map(() => "?").join(",")})`;
      params.push(...statuses);
    }
    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);
    const orders = (await db
      .prepare(query)
      .all(...(params as any[]))) as unknown as Order[];
    return orderDetailsFor(orders);
  },

  async listForDate(
    statuses: OrderStatus[],
    date: string,
    limit = 100
  ): Promise<Order[]> {
    await ensureOrderColumns();
    const orders = (await getDb()
      .prepare(
        `SELECT ${ORDER_COLUMNS} FROM orders
         WHERE date(created_at) = date(?)
           AND status IN (${statuses.map(() => "?").join(",")})
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(date, ...statuses, limit)) as unknown as Order[];
    return orderDetailsFor(orders);
  },

  async staffBoard(date: string): Promise<Order[]> {
    await ensureOrderColumns();
    const activePlaceholders = STAFF_BOARD_ACTIVE_STATUSES.map(() => "?").join(", ");
    const orders = (await getDb()
      .prepare(
        `SELECT ${ORDER_COLUMNS} FROM orders
         WHERE date(created_at) = date(?)
            OR status IN (${activePlaceholders})
         ORDER BY CASE
           WHEN status IN (${activePlaceholders})
             AND date(created_at) < date(?) THEN 0
           ELSE 1
         END,
         created_at DESC, id DESC`
      )
      .all(
        date,
        ...STAFF_BOARD_ACTIVE_STATUSES,
        ...STAFF_BOARD_ACTIVE_STATUSES,
        date
      )) as unknown as Order[];
    return orderDetailsFor(orders);
  },

  async byTable(tableNumber: number, limit = 10): Promise<Order[]> {
    await ensureOrderColumns();
    const orders = (await getDb()
      .prepare(
        `SELECT ${ORDER_COLUMNS} FROM orders
         WHERE table_number = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(tableNumber, limit)) as unknown as Order[];
    return orderDetailsFor(orders);
  },

  async update(id: number, data: Partial<Order>): Promise<void> {
    await ensureOrderColumns();
    const allowed = new Set([
      "status",
      "payment_status",
      "queue_number",
      "confirmed_at",
      "preparing_at",
      "cancelled_at",
      "ready_at",
      "completed_at",
      "completion_reason",
      "cancellation_reason",
      "payment_proof_url",
      "payment_reference",
      "payment_amount",
      "cash_received",
      "change_given",
      "prep_minutes",
      "estimated_ready_at",
      "remarks",
      "total",
      "subtotal",
      "discount_amount",
      "discounts_json",
    ]);
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (allowed.has(key) && value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (!fields.length) return;
    values.push(id);
    await getDb()
      .prepare(
        `UPDATE orders SET ${fields.join(", ")}, updated_at = datetime('now', 'localtime') WHERE id = ?`
      )
      .run(...(values as any[]));
  },

  async rejectPayment(
    id: number,
    data: Partial<Order>,
    rejectedAt: string,
    rejectedBy: string
  ): Promise<void> {
    await ensureOrderColumns();
    await ensureOrderPaymentRejectionsTable();
    const db = getDb();
    await db.transaction(async () => {
      const current = (await db
        .prepare(
          `SELECT payment_status, payment_proof_url, payment_reference,
                  payment_amount, total
           FROM orders
           WHERE id = ?
           FOR UPDATE`
        )
        .get(id)) as
        | {
            payment_status: string;
            payment_proof_url: string | null;
            payment_reference: string | null;
            payment_amount: number | null;
            total: number;
          }
        | undefined;
      if (!current) throw new Error("Order not found while rejecting payment.");

      if (current.payment_status !== "rejected") {
        await db
          .prepare(
            `INSERT INTO order_payment_rejections
              (order_id, rejected_at, rejected_by, payment_proof_url,
               payment_reference, payment_amount)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            rejectedAt,
            rejectedBy,
            current.payment_proof_url,
            current.payment_reference,
            Number(current.payment_amount ?? current.total)
          );
      }

      await OrderModel.update(id, data);
    });
  },

  async recalculateTotals(
    orderId: number
  ): Promise<{ subtotal: number; service_charge: number; total: number }> {
    const db = getDb();
    const round = (value: number) => Math.round(value * 100) / 100;
    const discountRow = (await db
      .prepare("SELECT discounts_json FROM orders WHERE id = ?")
      .get(orderId)) as { discounts_json?: string | null } | undefined;
    const recipients = discountRecipientsFromJson(discountRow?.discounts_json);
    const discounts = recipients.length
      ? await calculateDiscountsForOrder(orderId, recipients)
      : [];
    const discountAmount = round(
      discounts.reduce((sum, discount) => sum + discount.discount_amount, 0)
    );
    const itemsRow = (await db
      .prepare(
        "SELECT COALESCE(SUM(price_at_time * quantity), 0) AS total FROM order_items WHERE order_id = ?"
      )
      .get(orderId)) as { total?: number } | undefined;
    const addonsRow = (await db
      .prepare(
        "SELECT COALESCE(SUM(price_modifier * quantity), 0) AS total FROM order_item_addons WHERE order_id = ?"
      )
      .get(orderId)) as { total?: number } | undefined;
    const subtotal = round(Number(itemsRow?.total || 0) + Number(addonsRow?.total || 0));
    const pctRow = (await db
      .prepare("SELECT value FROM settings WHERE key = 'service_charge_pct'")
      .get()) as { value?: string } | undefined;
    const serviceCharge = round(subtotal * (Number(pctRow?.value || 0) / 100));
    const total = round(subtotal + serviceCharge - discountAmount);
    await db
      .prepare(
        `UPDATE orders
         SET payment_amount = CASE
               WHEN payment_amount IS NULL AND payment_status = 'verified'
                 AND payment_method = 'counter' THEN total
               ELSE payment_amount
             END,
             subtotal = ?, service_charge = ?, total = ?, discount_amount = ?,
             discounts_json = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      )
      .run(
        subtotal,
        serviceCharge,
        total,
        discountAmount,
        discounts.length ? JSON.stringify(discounts) : null,
        orderId
      );
    return { subtotal, service_charge: serviceCharge, total };
  },

  async calculateDiscounts(
    orderId: number,
    recipients: DiscountRecipient[]
  ): Promise<OrderDiscount[]> {
    return calculateDiscountsForOrder(orderId, recipients);
  },

  async addStaffItem(data: {
    orderId: number;
    menuItemId: number;
    quantity?: number;
    variantIds?: number[];
    extraIds?: number[];
    sugarLevel?: string | null;
    note?: string | null;
    userId?: number;
  }): Promise<{ ok: true; order: Order } | { ok: false; error: string; status: number }> {
    const db = getDb();
    const order = await OrderModel.byId(data.orderId);
    if (!order) return { ok: false, error: "Order not found.", status: 404 };
    if (!["pending", "payment_pending"].includes(order.status)) {
      return {
        ok: false,
        error: "Items can only be added before payment is verified.",
        status: 400,
      };
    }
    if (order.payment_status === "verified") {
      return {
        ok: false,
        error: "Menu items can only be added before the order is paid.",
        status: 409,
      };
    }
    if (
      order.balance_payments?.some((payment) => payment.status === "pending")
    ) {
      return {
        ok: false,
        error: "Resolve the pending additional payment before changing the order total.",
        status: 409,
      };
    }
    if (
      order.payment_method === "gcash" &&
      order.payment_status === "pending" &&
      order.payment_proof_url
    ) {
      return {
        ok: false,
        error: "Wait for the submitted GCash receipt to be reviewed before changing the order.",
        status: 409,
      };
    }
    if ((order.balance_payments || []).some((payment) => payment.status === "pending")) {
      return {
        ok: false,
        error: "Resolve the pending additional payment before changing the order.",
        status: 409,
      };
    }

    const menuItem = await MenuItemModel.byId(data.menuItemId);
    if (!menuItem || !menuItem.is_active) {
      return { ok: false, error: "That menu item is not available.", status: 400 };
    }
    if (
      menuItem.stock_status === "out" ||
      (menuItem.stock_tracking_enabled && menuItem.stock_count <= 0)
    ) {
      return { ok: false, error: `${menuItem.name} is out of stock.`, status: 400 };
    }

    const selectedVariants = Array.from(new Set(data.variantIds || [])).map((id) =>
      menuItem.variants.find((variant) => variant.id === id)
    );
    if (selectedVariants.some((variant) => !variant)) {
      return { ok: false, error: "One of the selected options is unavailable.", status: 400 };
    }
    const variantGroups = new Set<string>();
    for (const variant of selectedVariants) {
      if (!variant) continue;
      if (variantGroups.has(variant.variant_type)) {
        return {
          ok: false,
          error: `Choose only one ${variant.variant_type.toLowerCase()} option.`,
          status: 400,
        };
      }
      variantGroups.add(variant.variant_type);
    }

    const extraIds = Array.from(new Set(data.extraIds || []));
    const selectedExtras = extraIds.map((id) =>
      menuItem.extras.find((extra) => extra.id === id)
    );
    if (selectedExtras.some((extra) => !extra)) {
      return { ok: false, error: "One of the selected extras is unavailable.", status: 400 };
    }
    const quantity = Math.min(20, Math.max(1, Math.floor(Number(data.quantity) || 1)));
    const variantName = selectedVariants
      .filter((variant): variant is Variant => Boolean(variant))
      .map((variant) => variant.name)
      .join(" · ");
    const extrasSnapshot = selectedExtras
      .filter((extra): extra is Extra => Boolean(extra))
      .map((extra) => ({
        id: extra.id,
        name: extra.name,
        price_modifier: extra.price_modifier,
      }));
    const unitPrice =
      Number(menuItem.price) +
      selectedVariants.reduce(
        (sum, variant) => sum + Number(variant?.price_modifier || 0),
        0
      ) +
      selectedExtras.reduce(
        (sum, extra) => sum + Number(extra?.price_modifier || 0),
        0
      );

    await ensureOrderStockDeductionsTable();
    try {
      await db.transaction(async () => {
        const current = await OrderModel.byId(order.id);
        if (
          !current ||
          !["pending", "payment_pending"].includes(current.status) ||
          current.payment_status === "verified" ||
          current.balance_payments?.some((payment) => payment.status === "pending") ||
          (current.payment_method === "gcash" &&
            current.payment_status === "pending" &&
            Boolean(current.payment_proof_url)) ||
          current.balance_payments?.some((payment) => payment.status === "pending")
        ) {
          throw new OrderChangeConflict(
            current?.payment_status === "verified"
              ? "Menu items can only be added before the order is paid."
              : "The order can no longer be changed while its payment is being reviewed.",
            409
          );
        }
        const itemResult = await db.prepare(
          `INSERT INTO order_items
             (order_id, menu_item_id, name, variant_name, extras, sugar_level, note, quantity, price_at_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          order.id,
          menuItem.id,
          menuItem.name,
          variantName || null,
          JSON.stringify(extrasSnapshot),
          data.sugarLevel || null,
          data.note?.trim().slice(0, 180) || null,
          quantity,
          unitPrice
        );
        await deductMenuItemStock(
          order.id,
          Number(itemResult.lastInsertRowid),
          menuItem.id,
          quantity
        );
        await OrderModel.recalculateTotals(order.id);
      });
    } catch (error) {
      if (error instanceof OrderChangeConflict) {
        return { ok: false, error: error.message, status: error.status };
      }
      if (error instanceof InsufficientMenuStockError) {
        return { ok: false, error: error.message, status: 409 };
      }
      throw error;
    }
    return { ok: true, order: (await OrderModel.byId(order.id))! };
  },

  async updateStaffOrderItem(data: {
    orderId: number;
    orderItemId: number;
    quantity: number;
    variantIds: number[];
    extraIds: number[];
    sugarLevel?: string | null;
    note?: string | null;
  }): Promise<{ ok: true; order: Order } | { ok: false; error: string; status: number }> {
    await ensureOrderStockDeductionsTable();
    const db = getDb();
    const order = await OrderModel.byId(data.orderId);
    if (!order) return { ok: false, error: "Order not found.", status: 404 };
    if (
      !["pending", "payment_pending"].includes(order.status) ||
      order.payment_status === "verified"
    ) {
      return {
        ok: false,
        error: "Order items can only be edited before payment is verified.",
        status: 409,
      };
    }
    if (
      (order.payment_method === "gcash" &&
        order.payment_status === "pending" &&
        order.payment_proof_url) ||
      order.balance_payments?.some((payment) => payment.status === "pending")
    ) {
      return {
        ok: false,
        error: "Resolve the pending payment review before editing this order.",
        status: 409,
      };
    }

    const currentItem = await db
      .prepare("SELECT * FROM order_items WHERE id = ? AND order_id = ?")
      .get(data.orderItemId, data.orderId) as OrderItem | undefined;
    if (!currentItem) {
      return { ok: false, error: "Order item not found.", status: 404 };
    }
    const menuItem = await MenuItemModel.byId(currentItem.menu_item_id);
    if (!menuItem || !menuItem.is_active) {
      return { ok: false, error: "That menu item is no longer available.", status: 409 };
    }

    const selectedVariants = data.variantIds.map((id) =>
      menuItem.variants.find((variant) => variant.id === id)
    );
    if (selectedVariants.some((variant) => !variant)) {
      return { ok: false, error: "One of the selected options is unavailable.", status: 400 };
    }
    const groups = new Set<string>();
    for (const variant of selectedVariants) {
      if (!variant) continue;
      if (groups.has(variant.variant_type)) {
        return {
          ok: false,
          error: `Choose only one ${variant.variant_type.toLowerCase()} option.`,
          status: 400,
        };
      }
      groups.add(variant.variant_type);
    }
    const selectedExtras = data.extraIds.map((id) =>
      menuItem.extras.find((extra) => extra.id === id)
    );
    if (selectedExtras.some((extra) => !extra)) {
      return { ok: false, error: "One of the selected extras is unavailable.", status: 400 };
    }

    const variantName = selectedVariants
      .filter((variant): variant is Variant => Boolean(variant))
      .map((variant) => variant.name)
      .join(" · ");
    const extrasSnapshot = selectedExtras
      .filter((extra): extra is Extra => Boolean(extra))
      .map((extra) => ({
        id: extra.id,
        name: extra.name,
        price_modifier: extra.price_modifier,
      }));
    const unitPrice =
      Number(menuItem.price) +
      selectedVariants.reduce(
        (sum, variant) => sum + Number(variant?.price_modifier || 0),
        0
      ) +
      selectedExtras.reduce(
        (sum, extra) => sum + Number(extra?.price_modifier || 0),
        0
      );

    try {
      await db.transaction(async () => {
        const currentOrder = await OrderModel.byId(data.orderId);
        const ledger = (await db
          .prepare(
            `SELECT id, quantity, previous_stock_status
             FROM order_stock_deductions
             WHERE order_item_id = ? AND restored_at IS NULL`
          )
          .get(data.orderItemId)) as
          | {
              id: number;
              quantity: number;
              previous_stock_status: "available" | "low" | "out";
            }
          | undefined;
        if (
          !currentOrder ||
          !["pending", "payment_pending"].includes(currentOrder.status) ||
          currentOrder.payment_status === "verified" ||
          (currentOrder.payment_method === "gcash" &&
            currentOrder.payment_status === "pending" &&
            Boolean(currentOrder.payment_proof_url)) ||
          currentOrder.balance_payments?.some((payment) => payment.status === "pending")
        ) {
          throw new OrderChangeConflict(
            "The order can no longer be changed while payment is being reviewed.",
            409
          );
        }

        const reservedQuantity = ledger?.quantity || 0;
        const difference = data.quantity - reservedQuantity;
        if (!menuItem.stock_tracking_enabled) {
          if (ledger) {
            await db
              .prepare(
                `UPDATE order_stock_deductions
                 SET restored_at = datetime('now', 'localtime')
                 WHERE id = ?`
              )
              .run(ledger.id);
          }
        } else if (difference > 0) {
          const stock = (await db
            .prepare(
              `SELECT stock_count, low_stock_threshold, stock_status
               FROM menu_items WHERE id = ?`
            )
            .get(menuItem.id)) as
            | {
                stock_count: number;
                low_stock_threshold: number;
                stock_status: "available" | "low" | "out";
              }
            | undefined;
          if (
            !stock ||
            stock.stock_status === "out" ||
            stock.stock_count < difference
          ) {
            throw new OrderChangeConflict(
              stock && stock.stock_count > 0
                ? `Only ${stock.stock_count} ${menuItem.name} left.`
                : `${menuItem.name} is sold out.`,
              409
            );
          }
          const nextCount = stock.stock_count - difference;
          const nextStatus =
            nextCount === 0
              ? "out"
              : nextCount <= stock.low_stock_threshold
                ? "low"
                : "available";
          await db
            .prepare(
              `UPDATE menu_items
               SET stock_count = ?, stock_status = ?,
                   updated_at = datetime('now', 'localtime')
               WHERE id = ?`
            )
            .run(nextCount, nextStatus, menuItem.id);
          if (ledger) {
            await db
              .prepare(
                "UPDATE order_stock_deductions SET quantity = ? WHERE id = ?"
              )
              .run(data.quantity, ledger.id);
          } else {
            await db
              .prepare(
                `INSERT INTO order_stock_deductions
                   (order_id, order_item_id, menu_item_id, quantity, previous_stock_status)
                 VALUES (?, ?, ?, ?, ?)`
              )
              .run(
                data.orderId,
                data.orderItemId,
                menuItem.id,
                data.quantity,
                stock.stock_status
              );
          }
        } else if (difference < 0) {
          const stock = (await db
            .prepare(
              `SELECT stock_count, low_stock_threshold, stock_status
               FROM menu_items WHERE id = ?`
            )
            .get(menuItem.id)) as
            | {
                stock_count: number;
                low_stock_threshold: number;
                stock_status: "available" | "low" | "out";
              }
            | undefined;
          if (!stock || !ledger) {
            throw new OrderChangeConflict(
              "The reserved stock for this item could not be found.",
              409
            );
          }
          const nextCount = stock.stock_count - difference;
          let nextStatus = stock.stock_status;
          if (stock.stock_status === "out" && stock.stock_count === 0) {
            nextStatus =
              ledger.previous_stock_status === "out"
                ? nextCount <= stock.low_stock_threshold
                  ? "low"
                  : "available"
                : ledger.previous_stock_status;
          } else if (
            stock.stock_status === "available" &&
            nextCount <= stock.low_stock_threshold
          ) {
            nextStatus = "low";
          }
          await db
            .prepare(
              `UPDATE menu_items
               SET stock_count = ?, stock_status = ?,
                   updated_at = datetime('now', 'localtime')
               WHERE id = ?`
            )
            .run(nextCount, nextStatus, menuItem.id);
          await db
            .prepare(
              "UPDATE order_stock_deductions SET quantity = ? WHERE id = ?"
            )
            .run(data.quantity, ledger.id);
        }

        await db
          .prepare(
            `UPDATE order_items
             SET menu_item_id = ?, name = ?, variant_name = ?, extras = ?,
                 sugar_level = ?, note = ?, quantity = ?, price_at_time = ?
             WHERE id = ? AND order_id = ?`
          )
          .run(
            menuItem.id,
            menuItem.name,
            variantName || null,
            JSON.stringify(extrasSnapshot),
            data.sugarLevel || null,
            data.note?.trim().slice(0, 180) || null,
            data.quantity,
            unitPrice,
            data.orderItemId,
            data.orderId
          );
        await OrderModel.recalculateTotals(data.orderId);
      });
    } catch (error) {
      if (error instanceof OrderChangeConflict) {
        return { ok: false, error: error.message, status: error.status };
      }
      if (error instanceof InsufficientMenuStockError) {
        return { ok: false, error: error.message, status: 409 };
      }
      throw error;
    }
    return { ok: true, order: (await OrderModel.byId(data.orderId))! };
  },

  async removeStaffOrderItem(data: {
    orderId: number;
    orderItemId: number;
  }): Promise<
    { ok: true; order: Order } | { ok: false; error: string; status: number }
  > {
    await ensureOrderStockDeductionsTable();
    const db = getDb();
    try {
      await db.transaction(async () => {
        const order = await OrderModel.byId(data.orderId);
        if (!order) {
          throw new OrderChangeConflict("Order not found.", 404);
        }
        if (
          !["pending", "payment_pending"].includes(order.status) ||
          order.payment_status === "verified" ||
          (order.payment_method === "gcash" &&
            order.payment_status === "pending" &&
            order.payment_proof_url) ||
          order.balance_payments?.some((payment) => payment.status === "pending")
        ) {
          throw new OrderChangeConflict(
            "Order items can only be removed before payment is verified.",
            409
          );
        }
        const item = await db
          .prepare("SELECT id FROM order_items WHERE id = ? AND order_id = ?")
          .get(data.orderItemId, data.orderId);
        if (!item) {
          throw new OrderChangeConflict("Order item not found.", 404);
        }
        const count = (await db
          .prepare("SELECT COUNT(*) AS count FROM order_items WHERE order_id = ?")
          .get(data.orderId)) as { count: number };
        if (count.count <= 1) {
          throw new OrderChangeConflict(
            "An order must keep at least one item. Cancel the order instead.",
            409
          );
        }
        const ledger = (await db
          .prepare(
            `SELECT id, menu_item_id, quantity, previous_stock_status
             FROM order_stock_deductions
             WHERE order_item_id = ? AND restored_at IS NULL`
          )
          .get(data.orderItemId)) as
          | {
              id: number;
              menu_item_id: number;
              quantity: number;
              previous_stock_status: "available" | "low" | "out";
            }
          | undefined;
        if (ledger) {
          const stock = (await db
            .prepare(
              `SELECT stock_count, low_stock_threshold, stock_status
               FROM menu_items WHERE id = ?`
            )
            .get(ledger.menu_item_id)) as
            | {
                stock_count: number;
                low_stock_threshold: number;
                stock_status: "available" | "low" | "out";
              }
            | undefined;
          if (stock) {
            const nextCount = stock.stock_count + ledger.quantity;
            let nextStatus = stock.stock_status;
            if (stock.stock_status === "out" && stock.stock_count === 0) {
              nextStatus =
                ledger.previous_stock_status === "out"
                  ? nextCount <= stock.low_stock_threshold
                    ? "low"
                    : "available"
                  : ledger.previous_stock_status;
            } else if (
              stock.stock_status === "available" &&
              nextCount <= stock.low_stock_threshold
            ) {
              nextStatus = "low";
            }
            await db
              .prepare(
                `UPDATE menu_items
                 SET stock_count = ?, stock_status = ?,
                     updated_at = datetime('now', 'localtime')
                 WHERE id = ?`
              )
              .run(nextCount, nextStatus, ledger.menu_item_id);
          }
          await db
            .prepare(
              `UPDATE order_stock_deductions
               SET restored_at = datetime('now', 'localtime')
               WHERE id = ?`
            )
            .run(ledger.id);
        }
        await db
          .prepare("DELETE FROM order_items WHERE id = ? AND order_id = ?")
          .run(data.orderItemId, data.orderId);
        await OrderModel.recalculateTotals(data.orderId);
      });
    } catch (error) {
      if (error instanceof OrderChangeConflict) {
        return { ok: false, error: error.message, status: error.status };
      }
      throw error;
    }
    return { ok: true, order: (await OrderModel.byId(data.orderId))! };
  },

  async addStaffAddon(data: {
    orderId: number;
    orderItemId: number;
    addonId: number;
    quantity?: number;
    userId?: number;
  }): Promise<{ ok: true; order: Order } | { ok: false; error: string; status: number }> {
    const db = getDb();
    const order = await OrderModel.byId(data.orderId);
    if (!order) return { ok: false, error: "Order not found.", status: 404 };
    if (!["pending", "payment_pending", "confirmed", "preparing"].includes(order.status)) {
      return {
        ok: false,
        error: "Add-ons can only be added before the order starts preparing.",
        status: 400,
      };
    }
    const item = (order.items || []).find((line) => line.id === data.orderItemId);
    if (!item) {
      return { ok: false, error: "That item is not part of this order.", status: 404 };
    }
    if (order.balance_payments?.some((payment) => payment.status === "pending")) {
      return {
        ok: false,
        error: "Resolve the pending additional payment before changing the order total.",
        status: 409,
      };
    }
    if (
      order.payment_method === "gcash" &&
      order.payment_status === "pending" &&
      order.payment_proof_url
    ) {
      return {
        ok: false,
        error: "Wait for the submitted GCash receipt to be reviewed before changing the order.",
        status: 409,
      };
    }
    const addon = await AddonModel.byId(data.addonId);
    if (!addon || !addon.is_active) {
      return { ok: false, error: "That add-on is not available.", status: 400 };
    }
    const quantity = Math.max(1, Math.min(20, Number(data.quantity) || 1));
    try {
      await db.transaction(async () => {
        const current = await OrderModel.byId(order.id);
        if (
          !current ||
          !["pending", "payment_pending", "confirmed", "preparing"].includes(
            current.status
          ) ||
          current.balance_payments?.some((payment) => payment.status === "pending") ||
          (current.payment_method === "gcash" &&
            current.payment_status === "pending" &&
            Boolean(current.payment_proof_url))
        ) {
          throw new OrderChangeConflict(
            "The order can no longer be changed while its payment is being reviewed.",
            409
          );
        }
        await db
          .prepare(
            `INSERT INTO order_item_addons
               (order_id, order_item_id, addon_id, name, price_modifier, quantity, added_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            order.id,
            item.id,
            addon.id,
            addon.name,
            Number(addon.price_modifier) || 0,
            quantity,
            data.userId || null
          );
        await OrderModel.recalculateTotals(order.id);
      });
    } catch (error) {
      if (error instanceof OrderChangeConflict) {
        return { ok: false, error: error.message, status: error.status };
      }
      throw error;
    }
    return { ok: true, order: (await OrderModel.byId(order.id))! };
  },

  async createBalancePayment(data: {
    orderId: number;
    method: "gcash" | "counter";
    amount: number;
    status: "pending" | "verified";
    paymentReference?: string;
    paymentProofUrl?: string;
    receivedBy?: number;
  }): Promise<
    | { ok: true; payment: OrderBalancePayment; order: Order }
    | {
        ok: false;
        error: string;
        status: number;
      }
  > {
    const db = getDb();
    const paymentReference = data.paymentReference?.trim() || null;
    if (
      data.method === "gcash" &&
      (!paymentReference || !data.paymentProofUrl)
    ) {
      return {
        ok: false,
        error: "A GCash reference number and receipt image are required.",
        status: 400,
      };
    }
    const order = await OrderModel.byId(data.orderId);
    if (!order) return { ok: false, error: "Order not found.", status: 404 };
    if (
      order.payment_status !== "verified" ||
      order.status === "cancelled"
    ) {
      return {
        ok: false,
        error: "Additional balances can only be paid on an order that was not cancelled.",
        status: 400,
      };
    }
    if ((order.balance_due || 0) <= 0) {
      return { ok: false, error: "This order has no outstanding balance.", status: 400 };
    }
    if (order.balance_payments?.some((payment) => payment.status === "pending")) {
      return {
        ok: false,
        error: "An additional payment is already awaiting review.",
        status: 409,
      };
    }

    const amount = Math.round(Number(order.balance_due) * 100) / 100;
    if (!Number.isFinite(data.amount) || Math.abs(data.amount - amount) > 0.01) {
      return {
        ok: false,
        error: "The balance changed. Refresh the order and try again.",
        status: 409,
      };
    }
    const stamp = new Date();
    const verifiedAt =
      data.status === "verified"
        ? `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")} ${String(stamp.getHours()).padStart(2, "0")}:${String(stamp.getMinutes()).padStart(2, "0")}:${String(stamp.getSeconds()).padStart(2, "0")}`
        : null;

    let paymentId = 0;
    try {
      await db.transaction(async () => {
        const current = await OrderModel.byId(data.orderId);
        if (
          !current ||
          current.payment_status !== "verified" ||
          current.status === "cancelled" ||
          Math.abs(Number(current.balance_due || 0) - amount) > 0.01 ||
          current.balance_payments?.some((payment) => payment.status === "pending")
        ) {
          throw new OrderChangeConflict(
            "The outstanding balance has changed. Refresh and try again.",
            409
          );
        }
        if (
          data.method === "gcash" &&
          paymentReference &&
          (await gcashReferenceIsInUse(paymentReference))
        ) {
          throw new OrderChangeConflict(
            "That GCash reference has already been submitted for another payment.",
            409
          );
        }
        const result = await db
          .prepare(
            `INSERT INTO order_balance_payments
               (order_id, amount, payment_method, status, payment_reference,
                payment_proof_url, received_by, verified_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            order.id,
            amount,
            data.method,
            data.status,
            paymentReference,
            data.paymentProofUrl || null,
            data.receivedBy || null,
            verifiedAt
          );
        paymentId = Number(result.lastInsertRowid);
      });
    } catch (error) {
      if (error instanceof OrderChangeConflict) {
        return { ok: false, error: error.message, status: error.status };
      }
      throw error;
    }
    const payment = (await balancePaymentsFor(order.id)).find(
      (entry) => entry.id === paymentId
    )!;
    return { ok: true, payment, order: (await OrderModel.byId(order.id))! };
  },

  async decideBalancePayment(
    paymentId: number,
    status: "verified" | "rejected",
    userId: number
  ): Promise<
    | { ok: true; payment: OrderBalancePayment; order: Order }
    | {
        ok: false;
        error: string;
        status: number;
      }
  > {
    const db = getDb();
    let resolvedOrderId = 0;
    try {
      await db.transaction(async () => {
        const payment = (await db
          .prepare("SELECT * FROM order_balance_payments WHERE id = ?")
          .get(paymentId)) as OrderBalancePayment | undefined;
        if (!payment) {
          throw new OrderChangeConflict("Additional payment not found.", 404);
        }
        if (payment.status !== "pending" || payment.payment_method !== "gcash") {
          throw new OrderChangeConflict(
            "This GCash balance payment has already been handled.",
            409
          );
        }
        const order = await OrderModel.byId(payment.order_id);
        if (!order) {
          throw new OrderChangeConflict(
            "The order for this payment no longer exists.",
            409
          );
        }
        resolvedOrderId = payment.order_id;
        if (
          status === "verified" &&
          (order.payment_status !== "verified" ||
            order.status === "cancelled" ||
            Math.abs(Number(order.balance_due || 0) - Number(payment.amount)) > 0.01)
        ) {
          throw new OrderChangeConflict(
            "The order balance has changed or is no longer payable. Refresh and review the order.",
            409
          );
        }
        if (
          status === "verified" &&
          payment.payment_reference &&
          (await gcashReferenceIsInUse(payment.payment_reference, paymentId))
        ) {
          throw new OrderChangeConflict(
            "This GCash reference is already linked to another payment.",
            409
          );
        }
        const stamp = new Date();
        const verifiedAt =
          status === "verified"
            ? `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")} ${String(stamp.getHours()).padStart(2, "0")}:${String(stamp.getMinutes()).padStart(2, "0")}:${String(stamp.getSeconds()).padStart(2, "0")}`
            : null;
        const result = await db
          .prepare(
            `UPDATE order_balance_payments
             SET status = ?, received_by = ?, verified_at = ?
             WHERE id = ? AND status = 'pending'`
          )
          .run(status, userId, verifiedAt, paymentId);
        if (Number(result.changes) !== 1) {
          throw new OrderChangeConflict(
            "This GCash balance payment has already been handled.",
            409
          );
        }
      });
    } catch (error) {
      if (error instanceof OrderChangeConflict) {
        return { ok: false, error: error.message, status: error.status };
      }
      throw error;
    }
    const payment = (await balancePaymentsFor(resolvedOrderId)).find(
      (entry) => entry.id === paymentId
    )!;
    return {
      ok: true,
      payment,
      order: (await OrderModel.byId(resolvedOrderId))!,
    };
  },

  async pendingBalancePayments(
    date?: string
  ): Promise<(OrderBalancePayment & { order: Order })[]> {
    const dateFilter = date ? "AND date(o.created_at) = date(?)" : "";
    const payments = (await getDb()
      .prepare(
        `SELECT obp.* FROM order_balance_payments obp
         JOIN orders o ON o.id = obp.order_id
         WHERE obp.status = 'pending' AND obp.payment_method = 'gcash' ${dateFilter}
         ORDER BY obp.created_at, obp.id`
      )
      .all(...(date ? [date] : []))) as unknown as OrderBalancePayment[];
    const ordersById = new Map(
      (await OrderModel.byIds(payments.map((payment) => payment.order_id))).map(
        (order) => [order.id, order]
      )
    );
    return payments.flatMap((payment) => {
      const order = ordersById.get(payment.order_id);
      return order ? [{ ...payment, order }] : [];
    });
  },

  async nextQueueNumber(date = dateKeyInOrderingZone(new Date())): Promise<number> {
    const row = (await getDb()
      .prepare(
        "SELECT MAX(queue_number) AS max_qn FROM orders WHERE date(created_at) = date(?)"
      )
      .get(date)) as { max_qn?: number } | undefined;
    return Number(row?.max_qn || 0) + 1;
  },

  async active(): Promise<Order[]> {
    return OrderModel.list([
      "pending",
      "payment_pending",
      "confirmed",
      "preparing",
      "ready",
    ]);
  },

  async pendingPayments(): Promise<Order[]> {
    return (await OrderModel.list(["pending", "payment_pending"])).filter(
      (order) => order.payment_status === "pending"
    );
  },

  async pendingPaymentCount(): Promise<number> {
    const row = (await getDb()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM orders
         WHERE status IN ('pending', 'payment_pending')
           AND payment_status = 'pending'`
      )
      .get()) as { count: number } | undefined;
    return Number(row?.count || 0);
  },

  async todayStats(date?: string) {
    const dateFilter = date ? "DATE(created_at) = ?" : "DATE(created_at) = DATE('now', 'localtime')";
    const row = (await getDb()
      .prepare(
        `SELECT
           COUNT(*) AS orders,
           COALESCE(SUM(total), 0) AS revenue,
           COALESCE(SUM(CASE WHEN status = 'preparing' THEN 1 ELSE 0 END), 0) AS preparing,
           COALESCE(SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END), 0) AS ready,
           COALESCE(SUM(CASE WHEN status IN ('pending','payment_pending') THEN 1 ELSE 0 END), 0) AS awaiting
         FROM orders
         WHERE ${dateFilter}
           AND status != 'cancelled'`
      )
      .get(...(date ? [date] : []))) as any;
    return {
      orders: Number(row?.orders || 0),
      revenue: Number(row?.revenue || 0),
      preparing: Number(row?.preparing || 0),
      ready: Number(row?.ready || 0),
      awaiting: Number(row?.awaiting || 0),
    };
  },
};

// ============================================================
// Waiter requests
// ============================================================
/** Each customer gets three waiter calls per calendar day. */
export const WAITER_DAILY_ATTEMPT_LIMIT = 3;
/** Wait after the first call before the second one. */
export const WAITER_REQUEST_COOLDOWN_SECONDS = 5 * 60;
/** Wait after the second call before the third (and final) one. */
export const WAITER_SECOND_COOLDOWN_SECONDS = 10 * 60;

/**
 * Cooldown enforced after a customer's Nth call of the day.
 * 1st -> wait 5 minutes, 2nd -> wait 10 minutes, 3rd -> no more calls.
 */
export function waiterCooldownAfterAttempt(attemptNumber: number): number {
  if (attemptNumber <= 0) return WAITER_REQUEST_COOLDOWN_SECONDS;
  if (attemptNumber === 1) return WAITER_REQUEST_COOLDOWN_SECONDS;
  if (attemptNumber === 2) return WAITER_SECOND_COOLDOWN_SECONDS;
  return 0;
}

const waiterColumnsReady = new WeakMap<object, Promise<void>>();

async function ensureWaiterRequestColumns(): Promise<void> {
  const db = getDb();
  const existing = waiterColumnsReady.get(db);
  if (existing) return existing;
  const ready = (async () => {
    const columns = (await db.prepare("PRAGMA table_info(waiter_requests)").all()) as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === "guest_id")) {
      await db.exec("ALTER TABLE waiter_requests ADD COLUMN guest_id TEXT");
    }
    if (!columns.some((column) => column.name === "attempt_no")) {
      await db.exec("ALTER TABLE waiter_requests ADD COLUMN attempt_no INTEGER");
    }
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_waiter_guest_created ON waiter_requests(guest_id, created_at DESC)"
    );
  })();
  waiterColumnsReady.set(db, ready);
  try {
    await ready;
  } catch (error) {
    waiterColumnsReady.delete(db);
    throw error;
  }
}

export interface WaiterRequest {
  id: number;
  table_number: number;
  order_id?: number | null;
  guest_id?: string | null;
  attempt_no?: number | null;
  request_type: string;
  message: string;
  status: "pending" | "acknowledged" | "resolved";
  created_at: string;
  updated_at?: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
}

export interface WaiterAttemptStatus {
  limit: number;
  used: number;
  remaining: number;
  /** Number this next call would be (1-3), or null when the daily cap is reached. */
  next_attempt: number | null;
  /** Seconds the customer still has to wait before their next call. */
  retry_after_seconds: number;
  cooldown_active: boolean;
  latest_request?: WaiterRequest | null;
}

function guestAttemptFilter(
  guestId: string | null,
  tableNumber: number
): { where: string; params: (string | number)[] } {
  if (guestId) {
    return {
      where: "AND (guest_id = ? OR (guest_id IS NULL AND table_number = ?))",
      params: [guestId, tableNumber],
    };
  }
  return {
    where: "AND guest_id IS NULL AND table_number = ?",
    params: [tableNumber],
  };
}

export const WaiterRequestModel = {
  async create(data: {
    table_number: number;
    order_id?: number;
    guest_id?: string;
    attempt_no?: number;
    request_type: string;
    message?: string;
  }): Promise<number> {
    await ensureWaiterRequestColumns();
    const result = await getDb()
      .prepare(
        `INSERT INTO waiter_requests (table_number, order_id, guest_id, attempt_no, request_type, message)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.table_number,
        data.order_id || null,
        data.guest_id || null,
        data.attempt_no || null,
        data.request_type,
        data.message || ""
      );
    return Number(result.lastInsertRowid);
  },

  /**
   * A customer's real waiter calls for today (order follow-ups are tracked
   * separately and do not use up one of the three calls).
   */
  async attemptsToday(
    guestId: string | null,
    tableNumber: number
  ): Promise<WaiterRequest[]> {
    await ensureWaiterRequestColumns();
    const filter = guestAttemptFilter(guestId, tableNumber);
    return await getDb()
      .prepare(
        `SELECT * FROM waiter_requests
         WHERE request_type <> 'Order follow-up'
           AND date(created_at) = date('now','localtime')
           ${filter.where}
         ORDER BY id ASC`
      )
      .all(...filter.params) as unknown as WaiterRequest[];
  },

  async attemptStatus(
    guestId: string | null,
    tableNumber: number
  ): Promise<WaiterAttemptStatus> {
    const attempts = await WaiterRequestModel.attemptsToday(guestId, tableNumber);
    const used = attempts.length;
    const remaining = Math.max(0, WAITER_DAILY_ATTEMPT_LIMIT - used);
    const latest = attempts[attempts.length - 1];
    const nextAttempt = used < WAITER_DAILY_ATTEMPT_LIMIT ? used + 1 : null;
    const cooldownSeconds = latest
      ? waiterCooldownAfterAttempt(latest.attempt_no || used)
      : 0;
    let retryAfter = 0;
    if (latest && cooldownSeconds > 0) {
      const createdAt = new Date(latest.created_at.replace(" ", "T")).getTime();
      const elapsed = Number.isFinite(createdAt)
        ? Math.floor((Date.now() - createdAt) / 1000)
        : cooldownSeconds;
      retryAfter = Math.max(0, cooldownSeconds - elapsed);
    }
    return {
      limit: WAITER_DAILY_ATTEMPT_LIMIT,
      used,
      remaining,
      next_attempt: nextAttempt,
      retry_after_seconds: retryAfter,
      cooldown_active: retryAfter > 0,
      latest_request: latest || null,
    };
  },

  async list(status?: string): Promise<WaiterRequest[]> {
    if (status) {
      return await getDb()
        .prepare(
          "SELECT * FROM waiter_requests WHERE status = ? ORDER BY created_at DESC"
        )
        .all(status) as unknown as WaiterRequest[];
    }
    return await getDb()
      .prepare("SELECT * FROM waiter_requests ORDER BY created_at DESC")
      .all() as unknown as WaiterRequest[];
  },

  async listByTable(tableNumber: number): Promise<WaiterRequest[]> {
    return await getDb()
      .prepare(
        "SELECT * FROM waiter_requests WHERE table_number = ? ORDER BY created_at DESC LIMIT 50"
      )
      .all(tableNumber) as unknown as WaiterRequest[];
  },

  async activeByTable(): Promise<Record<number, WaiterRequest[]>> {
    const active = (await getDb()
      .prepare(
        `SELECT * FROM waiter_requests
         WHERE status IN ('pending', 'acknowledged')
         ORDER BY created_at DESC`
      )
      .all()) as unknown as WaiterRequest[];
    const grouped: Record<number, WaiterRequest[]> = {};
    for (const request of active) {
      (grouped[request.table_number] ||= []).push(request);
    }
    return grouped;
  },

  async byId(id: number): Promise<WaiterRequest | undefined> {
    return await getDb()
      .prepare("SELECT * FROM waiter_requests WHERE id = ?")
      .get(id) as WaiterRequest | undefined;
  },

  async latestCallByTable(tableNumber: number): Promise<WaiterRequest | undefined> {
    return await getDb()
      .prepare(
        `SELECT * FROM waiter_requests
         WHERE table_number = ? AND request_type <> 'Order follow-up'
         ORDER BY id DESC LIMIT 1`
      )
      .get(tableNumber) as WaiterRequest | undefined;
  },

  async activeFollowUp(orderId: number): Promise<WaiterRequest | undefined> {
    return await getDb()
      .prepare(
        `SELECT * FROM waiter_requests
         WHERE order_id = ? AND request_type = 'Order follow-up'
           AND status IN ('pending', 'acknowledged')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(orderId) as WaiterRequest | undefined;
  },

  async update(id: number, data: Partial<WaiterRequest>): Promise<boolean> {
    const db = getDb();
    if (data.status === "acknowledged") {
      return Number((await db.prepare(
        `UPDATE waiter_requests SET status = 'acknowledged', acknowledged_at = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ? AND status = 'pending'`
      ).run(id)).changes) > 0;
    } else if (data.status === "resolved") {
      return Number((await db.prepare(
        `UPDATE waiter_requests SET status = 'resolved', resolved_at = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ? AND status IN ('pending', 'acknowledged')`
      ).run(id)).changes) > 0;
    }
    return false;
  },

  async resolveAcknowledgedOlderThan(minutes: number): Promise<number> {
    const result = await getDb()
      .prepare(
        `UPDATE waiter_requests
         SET status = 'resolved',
             resolved_at = datetime('now','localtime'),
             updated_at = datetime('now','localtime')
         WHERE status = 'acknowledged'
           AND acknowledged_at IS NOT NULL
           AND acknowledged_at <= datetime('now','localtime', ?)`
      )
      .run(`-${minutes} minutes`);
    return Number(result.changes);
  },

  async stats() {
    const row = (await getDb()
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN status = 'acknowledged' THEN 1 ELSE 0 END), 0) AS acknowledged,
          COALESCE(SUM(CASE WHEN status = 'resolved' AND resolved_at >= DATE('now','localtime') AND resolved_at < DATE('now','localtime', '+1 day') THEN 1 ELSE 0 END), 0) AS resolved_today
         FROM waiter_requests`
      )
      .get()) as any;
    return {
      pending: Number(row?.pending || 0),
      acknowledged: Number(row?.acknowledged || 0),
      resolved_today: Number(row?.resolved_today || 0),
    };
  },
};

// ============================================================
// Reviews
// ============================================================
export interface Review {
  id: number;
  order_id: number;
  table_number: number;
  rating: number;
  customer_name?: string | null;
  comment?: string | null;
  photo_url?: string | null;
  created_at: string;
}

export const ReviewModel = {
  async create(data: {
    order_id: number;
    table_number: number;
    rating: number;
    customer_name?: string;
    comment?: string;
    photo_url?: string;
  }): Promise<number> {
    const result = await getDb()
      .prepare(
        `INSERT INTO reviews (order_id, table_number, rating, customer_name, comment, photo_url)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.order_id,
        data.table_number,
        data.rating,
        data.customer_name || null,
        data.comment || null,
        data.photo_url || null
      );
    return Number(result.lastInsertRowid);
  },

  async all(limit = 100): Promise<Review[]> {
    return (await getDb()
      .prepare("SELECT * FROM reviews ORDER BY created_at DESC LIMIT ?")
      .all(limit)) as unknown as Review[];
  },

  async byOrder(orderId: number): Promise<Review | undefined> {
    return (await getDb()
      .prepare("SELECT * FROM reviews WHERE order_id = ? ORDER BY id DESC LIMIT 1")
      .get(orderId)) as Review | undefined;
  },

  async stats() {
    const row = await getDb()
      .prepare(
        `SELECT
           COALESCE(ROUND(AVG(rating), 1), 0) AS avg_rating,
           COUNT(*) AS total_reviews,
           COALESCE(ROUND(100.0 * SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 0), 0) AS positive_pct
         FROM reviews`
      )
      .get() as any;
    const latest = await getDb()
      .prepare("SELECT rating FROM reviews ORDER BY created_at DESC LIMIT 1")
      .get() as { rating?: number } | undefined;
    return {
      avg_rating: Number(row?.avg_rating || 0),
      total_reviews: Number(row?.total_reviews || 0),
      positive_pct: Number(row?.positive_pct || 0),
      latest_rating: Number(latest?.rating || 0),
    };
  },
};

// ============================================================
// Users
// ============================================================
export interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  contact_number?: string | null;
  address?: string | null;
  duty_hours?: string | null;
  role: "admin" | "staff";
  password_hash?: string;
  created_at?: string;
  is_active?: number;
  last_login_at?: string | null;
  last_logout_at?: string | null;
  duty_minutes?: number;
  session_id?: string | null;
}

const userColumnsReady = new WeakMap<object, Promise<void>>();
const staffDutySessionsReady = new WeakMap<object, Promise<void>>();

async function ensureUserColumns(): Promise<void> {
  const db = getDb();
  const existing = userColumnsReady.get(db);
  if (existing) return existing;
  const ready = (async () => {
    const columns = (await db.prepare("PRAGMA table_info(users)").all()) as {
      name: string;
    }[];
    const add = async (name: string, sql: string) => {
      if (!columns.some((column) => column.name === name)) {
        await db.exec(sql);
      }
    };
    await add("is_active", "ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
    await add("last_login_at", "ALTER TABLE users ADD COLUMN last_login_at TEXT");
    await add("last_logout_at", "ALTER TABLE users ADD COLUMN last_logout_at TEXT");
    await add("duty_minutes", "ALTER TABLE users ADD COLUMN duty_minutes INTEGER NOT NULL DEFAULT 0");
    await add("session_id", "ALTER TABLE users ADD COLUMN session_id TEXT");
    await add("contact_number", "ALTER TABLE users ADD COLUMN contact_number TEXT");
    await add("address", "ALTER TABLE users ADD COLUMN address TEXT");
    await add("duty_hours", "ALTER TABLE users ADD COLUMN duty_hours TEXT");
    await add("username", "ALTER TABLE users ADD COLUMN username TEXT");
    // Backfill usernames for existing users
    await getDb()
      .prepare(
        `UPDATE users SET username = lower(
          CASE
            WHEN role = 'admin' THEN 'admin-merrylane'
            ELSE split_part(name, ' ', 1) || '-merrylane'
          END
        ) WHERE username IS NULL OR trim(username) = ''`
      )
      .run();
  })();
  userColumnsReady.set(db, ready);
  try {
    await ready;
  } catch (error) {
    userColumnsReady.delete(db);
    throw error;
  }
}

async function ensureStaffDutySessionsTable(): Promise<void> {
  const db = getDb();
  const existing = staffDutySessionsReady.get(db);
  if (existing) return existing;
  const ready = Promise.resolve().then(() => db.exec(`
    CREATE TABLE IF NOT EXISTS staff_duty_sessions (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id INTEGER,
      login_at TEXT NOT NULL,
      logout_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_staff_duty_sessions_user_login
      ON staff_duty_sessions(user_id, login_at);
  `));
  staffDutySessionsReady.set(db, ready);
  try {
    await ready;
  } catch (error) {
    staffDutySessionsReady.delete(db);
    throw error;
  }
}

export const UserModel = {
  async ensureColumns(): Promise<void> {
    await ensureUserColumns();
  },

  async byEmail(email: string): Promise<User | undefined> {
    await ensureUserColumns();
    // An account may have no saved email; never match blank values together.
    if (!email?.trim()) return undefined;
    return await getDb()
      .prepare("SELECT * FROM users WHERE lower(email) = lower(?)")
      .get(email.trim()) as User | undefined;
  },

  async byUsername(username: string): Promise<User | undefined> {
    await ensureUserColumns();
    return await getDb()
      .prepare("SELECT * FROM users WHERE lower(username) = lower(?)")
      .get(username.trim()) as User | undefined;
  },

  async byId(id: number): Promise<User | undefined> {
    await ensureUserColumns();
    return await getDb()
      .prepare(
        "SELECT id, name, username, email, contact_number, address, duty_hours, role, created_at, is_active, last_login_at, last_logout_at, duty_minutes, session_id FROM users WHERE id = ?"
      )
      .get(id) as User | undefined;
  },

  async passwordHashById(id: number): Promise<string | undefined> {
    await ensureUserColumns();
    const row = (await getDb()
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(id)) as { password_hash?: string } | undefined;
    return row?.password_hash;
  },

  async all(): Promise<User[]> {
    await ensureUserColumns();
    return await getDb()
      .prepare(
        "SELECT id, name, username, email, contact_number, address, duty_hours, role, created_at, is_active, last_login_at, last_logout_at, duty_minutes, session_id FROM users ORDER BY role DESC, name"
      )
      .all() as unknown as User[];
  },

  async create(data: {
    name: string;
    username?: string;
    email?: string;
    role: "admin" | "staff";
    password: string;
    contact_number?: string | null;
    address?: string | null;
    duty_hours?: string | null;
  }): Promise<number> {
    await ensureUserColumns();
    const username =
      data.username?.trim() ||
      usernameForAccount(data.name, data.role);
    const result = await getDb()
      .prepare(
        `INSERT INTO users (
          name, username, email, role, password_hash, contact_number, address, duty_hours
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.name,
        username.toLowerCase().trim(),
        (data.email ?? "").toLowerCase().trim(),
        data.role,
        hashPassword(data.password),
        data.contact_number?.trim() || null,
        data.address?.trim() || null,
        data.duty_hours?.trim() || null
      );
    return Number(result.lastInsertRowid);
  },

  async remove(id: number): Promise<void> {
    await ensureUserColumns();
    await getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
  },

  async update(id: number, data: {
    name?: string;
    username?: string;
    email?: string;
    role?: "admin" | "staff";
    is_active?: boolean;
    contact_number?: string | null;
    address?: string | null;
    duty_hours?: string | null;
  }): Promise<void> {
    await ensureUserColumns();
    const fields: string[] = [];
    const values: unknown[] = [];
    if (data.name !== undefined) {
      fields.push("name = ?");
      values.push(String(data.name).trim());
    }
    if (data.username !== undefined) {
      fields.push("username = ?");
      values.push(String(data.username).trim().toLowerCase());
    }
    if (data.email !== undefined) {
      fields.push("email = ?");
      values.push(String(data.email).trim().toLowerCase());
    }
    if (data.role !== undefined) {
      fields.push("role = ?");
      values.push(data.role === "admin" ? "admin" : "staff");
    }
    if (data.is_active !== undefined) {
      fields.push("is_active = ?");
      values.push(data.is_active ? 1 : 0);
    }
    if (data.contact_number !== undefined) {
      fields.push("contact_number = ?");
      values.push(data.contact_number?.trim() || null);
    }
    if (data.address !== undefined) {
      fields.push("address = ?");
      values.push(data.address?.trim() || null);
    }
    if (data.duty_hours !== undefined) {
      fields.push("duty_hours = ?");
      values.push(data.duty_hours?.trim() || null);
    }
    if (fields.length === 0) return;
    values.push(id);
    await getDb().prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  },

  async resetPassword(id: number, password: string): Promise<void> {
    await ensureUserColumns();
    await getDb()
      .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(hashPassword(password), id);
  },

  async setActive(id: number, active: boolean): Promise<void> {
    await ensureUserColumns();
    await getDb().prepare("UPDATE users SET is_active = ? WHERE id = ?").run(active ? 1 : 0, id);
  },

  async correctMissingDutySignOut(
    id: number,
    date: string,
    time: string
  ): Promise<{ login_at: string; logout_at: string } | null> {
    await ensureStaffDutySessionsTable();
    const db = getDb();
    const logoutAt = `${date} ${time}:00`;
    return db.transaction(async () => {
      const session = (await db
        .prepare(
          `SELECT id, login_at FROM staff_duty_sessions
           WHERE user_id = ?
             AND logout_at IS NULL
             AND login_at < date(?, '+1 day')
             AND login_at <= ?
           ORDER BY login_at DESC, id DESC
           LIMIT 1`
        )
        .get(id, date, logoutAt)) as
        | { id: number; login_at: string }
        | undefined;
      if (!session) {
        return null;
      }

      const result = await db
        .prepare(
          `UPDATE staff_duty_sessions
           SET logout_at = ?
           WHERE id = ? AND logout_at IS NULL`
        )
        .run(logoutAt, session.id);
      if (Number(result.changes) !== 1) {
        return null;
      }
      await db
        .prepare(
          `UPDATE users
           SET duty_minutes = COALESCE(duty_minutes, 0) +
             MAX(0, ROUND((julianday(?) - julianday(?)) * 1440))
           WHERE id = ?`
        )
        .run(logoutAt, session.login_at, id);
      return { login_at: session.login_at, logout_at: logoutAt };
    });
  },

  async recordLogin(id: number): Promise<void> {
    await ensureUserColumns();
    await ensureStaffDutySessionsTable();
    const db = getDb();
    await db.transaction(async () => {
      const currentUser = await UserModel.byId(id);
      await db.prepare(
        `UPDATE users
         SET last_login_at = CASE
           WHEN role = 'staff' AND date(last_login_at) = date('now', 'localtime')
             THEN last_login_at
           ELSE datetime('now', 'localtime')
         END
         WHERE id = ?`
      ).run(id);
      if (currentUser?.role === "staff") {
        const staleSessions = (await db
          .prepare(
            `SELECT id, login_at FROM staff_duty_sessions
             WHERE user_id = ?
               AND logout_at IS NULL
               AND date(login_at) < date('now', 'localtime')`
          )
          .all(id)) as { id: number; login_at: string }[];
        const closeSession = db.prepare(
          `UPDATE staff_duty_sessions SET logout_at = ?
           WHERE id = ? AND logout_at IS NULL`
        );
        const addDutyMinutes = db.prepare(
          `UPDATE users SET duty_minutes = COALESCE(duty_minutes, 0) + ?
           WHERE id = ?`
        );
        const now = new Date();
        for (const session of staleSessions) {
          const loginAt = new Date(session.login_at.replace(" ", "T"));
          const logoutAt =
            (await SettingsModel.scheduledCloseAfter(loginAt, now)) ||
            `${session.login_at.slice(0, 10)} 23:59:59`;
          const minutes = Math.max(
            0,
            Math.round(
              (new Date(logoutAt.replace(" ", "T")).getTime() -
                loginAt.getTime()) /
                60000
            )
          );
          await closeSession.run(logoutAt, session.id);
          await addDutyMinutes.run(minutes, id);
        }
        const activeDutyToday = await db
          .prepare(
            `SELECT id FROM staff_duty_sessions
             WHERE user_id = ?
               AND logout_at IS NULL
               AND date(login_at) = date('now', 'localtime')
             ORDER BY id DESC LIMIT 1`
          )
          .get(id);
        if (!activeDutyToday) {
          await db.prepare(
            `INSERT INTO staff_duty_sessions (user_id, login_at)
             VALUES (?, datetime('now', 'localtime'))`
          ).run(id);
        }
      }
    });
  },

  async setSession(id: number, sessionId: string | null): Promise<void> {
    await ensureUserColumns();
    await getDb()
      .prepare("UPDATE users SET session_id = ? WHERE id = ?")
      .run(sessionId, id);
  },

  async recordLogout(id: number, logoutAt?: string): Promise<void> {
    await ensureUserColumns();
    await ensureStaffDutySessionsTable();
    const db = getDb();
    const activeDuty = await db
      .prepare(
        `SELECT id, login_at FROM staff_duty_sessions
         WHERE user_id = ? AND logout_at IS NULL
         ORDER BY id DESC LIMIT 1`
      )
      .get(id) as { id: number; login_at: string } | undefined;
    const row = await db
      .prepare("SELECT last_login_at, duty_minutes FROM users WHERE id = ?")
      .get(id) as { last_login_at: string | null; duty_minutes: number } | undefined;
    const tracked = await db
      .prepare("SELECT 1 AS exists_flag FROM staff_duty_sessions WHERE user_id = ? LIMIT 1")
      .get(id) as { exists_flag: number } | undefined;
    const activeStart = activeDuty?.login_at
      ? new Date(activeDuty.login_at.replace(" ", "T")).getTime()
      : NaN;
    const requestedEnd = logoutAt
      ? new Date(logoutAt.replace(" ", "T")).getTime()
      : NaN;
    const effectiveLogoutAt =
      logoutAt &&
      Number.isFinite(activeStart) &&
      Number.isFinite(requestedEnd) &&
      requestedEnd > activeStart
        ? logoutAt
        : undefined;
    let added = 0;
    if (activeDuty?.login_at) {
      const start = activeStart;
      const end = effectiveLogoutAt ? requestedEnd : Date.now();
      if (Number.isFinite(start) && end > start) {
        added = Math.round((end - start) / 60000);
      }
    } else if (!tracked && row?.last_login_at) {
      const start = new Date(row.last_login_at.replace(" ", "T")).getTime();
      const end = effectiveLogoutAt ? requestedEnd : Date.now();
      if (Number.isFinite(start) && end > start) {
        added = Math.round((end - start) / 60000);
      }
    }
    if (activeDuty) {
      await db.prepare(
        `UPDATE staff_duty_sessions
         SET logout_at = COALESCE(?, datetime('now', 'localtime'))
         WHERE id = ? AND logout_at IS NULL`
      ).run(effectiveLogoutAt || null, activeDuty.id);
    }
    await db.prepare(
      "UPDATE users SET last_logout_at = COALESCE(?, datetime('now', 'localtime')), duty_minutes = COALESCE(duty_minutes, 0) + ? WHERE id = ?"
    ).run(effectiveLogoutAt || null, added, id);
  },

  async dutySessionsForDate(
    id: number,
    date: string
  ): Promise<{
    sessions: { id: number; login_at: string; logout_at: string | null; duty_minutes: number }[];
    duty_minutes: number;
  }> {
    await ensureUserColumns();
    await ensureStaffDutySessionsTable();
    const storedSessions = (await getDb()
      .prepare(
        `SELECT id, login_at, logout_at,
           CAST(MAX(0, ROUND(
             (julianday(MIN(COALESCE(
                logout_at,
                CASE WHEN date(login_at) < date('now', 'localtime')
                  THEN date(login_at, '+1 day')
                  ELSE datetime('now', 'localtime')
                END
              ), date(?, '+1 day'))) -
              julianday(MAX(login_at, date(?)))) * 1440
           )) AS INTEGER) AS duty_minutes
         FROM staff_duty_sessions
         WHERE user_id = ?
           AND login_at < date(?, '+1 day')
           AND COALESCE(
             logout_at,
             CASE WHEN date(login_at) < date('now', 'localtime')
               THEN date(login_at, '+1 day')
               ELSE datetime('now', 'localtime')
             END
           ) > date(?)
         ORDER BY login_at`
      )
      .all(date, date, id, date, date)) as {
      id: number;
      login_at: string;
      logout_at: string | null;
      duty_minutes: number;
    }[];

    if (storedSessions.length === 0) {
      const user = await UserModel.byId(id);
      const loginDate = user?.last_login_at?.slice(0, 10);
      const logoutDate = user?.last_logout_at?.slice(0, 10);
      if (loginDate === date || logoutDate === date) {
        const loginAt = loginDate === date ? user?.last_login_at || null : null;
        const logoutAt = logoutDate === date ? user?.last_logout_at || null : null;
        const start = loginAt ? new Date(loginAt.replace(" ", "T")).getTime() : NaN;
        const end = logoutAt ? new Date(logoutAt.replace(" ", "T")).getTime() : NaN;
        const dutyMinutes =
          Number.isFinite(start) && Number.isFinite(end) && end > start
            ? Math.round((end - start) / 60000)
            : 0;
        storedSessions.push({
          id: 0,
          login_at: loginAt || "",
          logout_at: logoutAt,
          duty_minutes: dutyMinutes,
        });
      }
    }

    const isOnDuty = storedSessions.some((session) => !session.logout_at);
    const lastSignOut = storedSessions
      .filter((session) => session.logout_at)
      .reduce<string | null>(
        (latest, session) =>
          !latest || session.logout_at! > latest ? session.logout_at : latest,
        null
      );
    const sessions = storedSessions.length
      ? [
          {
            id: storedSessions[0].id,
            login_at: storedSessions[0].login_at,
            logout_at: isOnDuty ? null : lastSignOut,
            duty_minutes: storedSessions.reduce(
              (total, session) => total + Number(session.duty_minutes || 0),
              0
            ),
          },
        ]
      : [];

    return {
      sessions,
      duty_minutes: sessions.reduce(
        (total, session) => total + Number(session.duty_minutes || 0),
        0
      ),
    };
  },

  async dutySessionsForMonth(
    id: number,
    month: string
  ): Promise<{ date: string; sessions: number; duty_minutes: number }[]> {
    await ensureUserColumns();
    await ensureStaffDutySessionsTable();
    const monthStart = `${month}-01`;
    const monthEnd = (await getDb()
      .prepare("SELECT date(?, '+1 month') AS date")
      .get(monthStart)) as { date: string };
    const days = (await getDb()
      .prepare(
        `WITH RECURSIVE sessions AS (
           SELECT id, login_at, logout_at,
             COALESCE(
               logout_at,
               CASE WHEN date(login_at) < date('now', 'localtime')
                 THEN date(login_at, '+1 day')
                 ELSE datetime('now', 'localtime')
               END
             ) AS effective_logout_at
           FROM staff_duty_sessions
           WHERE user_id = ?
             AND login_at < ?
             AND COALESCE(
               logout_at,
               CASE WHEN date(login_at) < date('now', 'localtime')
                 THEN date(login_at, '+1 day')
                 ELSE datetime('now', 'localtime')
               END
             ) > ?
         ),
         duty_days (id, login_at, effective_logout_at, duty_date) AS (
           SELECT id, login_at, effective_logout_at,
             CASE WHEN date(login_at) < ? THEN ? ELSE date(login_at) END AS duty_date
           FROM sessions
           UNION ALL
           SELECT id, login_at, effective_logout_at, date(duty_date, '+1 day')
           FROM duty_days
           WHERE date(duty_date, '+1 day') <= date(effective_logout_at)
             AND date(duty_date, '+1 day') < ?
         )
         SELECT duty_date AS date,
           COUNT(*) AS sessions,
           SUM(CAST(MAX(0, ROUND(
             (julianday(MIN(effective_logout_at, date(duty_date, '+1 day'))) -
              julianday(MAX(login_at, duty_date))) * 1440
           )) AS INTEGER)) AS duty_minutes
         FROM duty_days
         GROUP BY duty_date
         HAVING SUM(
           julianday(MIN(effective_logout_at, date(duty_date, '+1 day'))) -
           julianday(MAX(login_at, duty_date))
         ) > 0
         ORDER BY duty_date`
      )
      .all(id, monthEnd.date, monthStart, monthStart, monthStart, monthEnd.date)) as {
      date: string;
      sessions: number;
      duty_minutes: number;
    }[];

    const daysByDate = new Map(days.map((day) => [day.date, day]));
    const user = await UserModel.byId(id);
    for (const value of [user?.last_login_at, user?.last_logout_at]) {
      const date = value?.slice(0, 10);
      if (date?.startsWith(`${month}-`) && !daysByDate.has(date)) {
        daysByDate.set(date, { date, sessions: 1, duty_minutes: 0 });
      }
    }
    return [...daysByDate.values()].sort((left, right) =>
      left.date.localeCompare(right.date)
    );
  },
};

// ============================================================
// Settings
// ============================================================
export interface Setting {
  key: string;
  value: string;
}

export interface ScheduleDay {
  day: string;
  open: boolean;
  start: string;
  end: string;
  last_order: string;
}

export type OrderingReason =
  | "open"
  | "manual"
  | "closed-day"
  | "before-open"
  | "after-close"
  | "after-cutoff";

export interface OrderingWindow {
  open: boolean;
  reason: OrderingReason;
  today: string;
  /** The day the cafe next accepts orders. */
  opens_day: string;
  /** "HH:MM" for the next opening, if there is one. */
  opens_at: string | null;
  /** The next scheduled opening after now, including later today if applicable. */
  next_opening: { day: string; start: string } | null;
  /** "HH:MM" for today's scheduled close, if today is an open day. */
  closes_at: string | null;
  /** "HH:MM" last-order cut-off, if one is set. */
  last_order_at: string | null;
  /** True while an open ordering window is within 30 minutes of its cutoff. */
  last_order_warning: boolean;
  opens_tomorrow: boolean;
  schedule: ScheduleDay[];
}

const WEEK_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const ORDERING_TIME_ZONE = "Asia/Manila";
const ORDERING_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: ORDERING_TIME_ZONE,
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DEFAULT_WEEKLY_SCHEDULE: ScheduleDay[] = [
  { day: "Monday", open: true, start: "09:00", end: "22:00", last_order: "21:00" },
  { day: "Tuesday", open: true, start: "09:00", end: "22:00", last_order: "21:00" },
  { day: "Wednesday", open: true, start: "09:00", end: "22:00", last_order: "21:00" },
  { day: "Thursday", open: true, start: "09:00", end: "22:00", last_order: "21:00" },
  { day: "Friday", open: true, start: "09:00", end: "22:00", last_order: "21:00" },
  { day: "Saturday", open: true, start: "08:00", end: "22:00", last_order: "21:00" },
  { day: "Sunday", open: true, start: "08:00", end: "21:00", last_order: "21:00" },
];

function minutesOf(value?: string | null): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec((value || "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

async function scheduleOf(): Promise<ScheduleDay[]> {
  const legacyLastOrder = await SettingsModel.get("last_order_time");
  const defaultLastOrder =
    minutesOf(legacyLastOrder) !== null ? legacyLastOrder! : "21:00";
  try {
    const parsed: unknown = JSON.parse(
      (await SettingsModel.get("weekly_schedule")) || "null"
    );
    if (Array.isArray(parsed) && parsed.length === 7) {
      const entries = parsed.map((entry): ScheduleDay | null => {
        if (typeof entry !== "object" || entry === null) return null;
        const value = entry as Record<string, unknown>;
        if (
          typeof value.day !== "string" ||
          !WEEK_DAYS.includes(value.day) ||
          typeof value.start !== "string" ||
          typeof value.end !== "string"
        ) {
          return null;
        }
        return {
          day: value.day,
          open: value.open !== false,
          start: minutesOf(value.start) !== null ? value.start : "09:00",
          end: minutesOf(value.end) !== null ? value.end : "22:00",
          last_order: normalizedLastOrder(
            typeof value.last_order === "string" &&
              minutesOf(value.last_order) !== null
              ? value.last_order
              : defaultLastOrder,
            typeof value.start === "string" &&
              minutesOf(value.start) !== null
              ? value.start
              : "09:00",
            typeof value.end === "string" && minutesOf(value.end) !== null
              ? value.end
              : "22:00"
          ),
        };
      });
      const days = entries.flatMap((entry) => (entry ? [entry.day] : []));
      if (
        entries.every((entry): entry is ScheduleDay => entry !== null) &&
        new Set(days).size === WEEK_DAYS.length
      ) {
        return entries;
      }
    }
  } catch {
    // fall through to the default week
  }
  return DEFAULT_WEEKLY_SCHEDULE.map((entry) => ({
    ...entry,
    last_order: normalizedLastOrder(
      defaultLastOrder,
      entry.start,
      entry.end
    ),
  }));
}

function normalizedLastOrder(
  value: string,
  startValue: string,
  endValue: string
): string {
  const cutoff = minutesOf(value);
  const start = minutesOf(startValue);
  const end = minutesOf(endValue);
  if (cutoff === null || start === null || end === null) return "21:00";

  const overnight = end !== 0 && end <= start;
  const endOfShift =
    end === 0 ? 24 * 60 : overnight ? end + 24 * 60 : end;
  let cutoffOfShift = cutoff;
  if (overnight && cutoffOfShift < start) cutoffOfShift += 24 * 60;
  if (end === 0 && cutoffOfShift === 0) cutoffOfShift = 24 * 60;
  cutoffOfShift = Math.min(cutoffOfShift, endOfShift);

  const normalized = cutoffOfShift % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60
  ).padStart(2, "0")}`;
}

function orderingTimeOf(at: Date): { day: string; minutes: number } {
  const parts = ORDERING_TIME_FORMATTER.formatToParts(at);
  const day = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  if (
    !day ||
    !WEEK_DAYS.includes(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    throw new Error("Unable to determine the cafe's local time.");
  }
  return { day, minutes: hour * 60 + minute };
}

function dateKeyInOrderingZone(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ORDERING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

function localDateTime(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((value) => value.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  const hour = part("hour");
  const minute = part("minute");
  const second = part("second");
  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error("Unable to determine the cafe's local date and time.");
  }
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

async function scheduledBusinessDate(at: Date): Promise<string | null> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ORDERING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (![year, month, day].every(Number.isFinite)) {
    throw new Error("Unable to determine the cafe's business date.");
  }

  const schedule = await scheduleOf();
  const now = at.getTime();
  let latestOpenAt = Number.NEGATIVE_INFINITY;
  let businessDate: string | null = null;
  for (let daysAgo = 0; daysAgo <= 7; daysAgo += 1) {
    const date = new Date(Date.UTC(year, month - 1, day - daysAgo));
    const daySchedule = schedule.find(
      (entry) => entry.day === WEEK_DAYS[date.getUTCDay()]
    );
    const startMinutes = daySchedule?.open
      ? minutesOf(daySchedule.start)
      : null;
    if (startMinutes === null) continue;

    const openingAt =
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
      ) -
      8 * 60 * 60 * 1000 +
      startMinutes * 60 * 1000;
    if (openingAt <= now && openingAt > latestOpenAt) {
      latestOpenAt = openingAt;
      businessDate = `${date.getUTCFullYear()}-${String(
        date.getUTCMonth() + 1
      ).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    }
  }
  return businessDate;
}

function isWithinSchedule(entry: ScheduleDay, current: number): boolean {
  const start = minutesOf(entry.start);
  const parsedEnd = minutesOf(entry.end);
  if (start === null || parsedEnd === null) return false;

  // 00:00 is the end of the calendar day, not the start of an overnight shift.
  const end = parsedEnd === 0 ? 24 * 60 : parsedEnd;
  return end <= start
    ? current >= start || current < end
    : current >= start && current < end;
}

function nextOpening(
  schedule: ScheduleDay[],
  today: string,
  current: number
): { day: string; start: string; tomorrow: boolean } | null {
  const todayIndex = WEEK_DAYS.indexOf(today);
  for (let offset = 0; offset < 8; offset += 1) {
    const index = (todayIndex + offset) % 7;
    const entry = schedule.find((day) => day.day === WEEK_DAYS[index]);
    if (!entry || !entry.open) continue;
    if (offset === 0) {
      const start = minutesOf(entry.start);
      if (start !== null && current >= start) continue;
    }
    return {
      day: entry.day,
      start: entry.start,
      tomorrow: offset > 0,
    };
  }
  return null;
}

function nextScheduledOpening(
  schedule: ScheduleDay[],
  today: string,
  current: number
): { day: string; start: string } | null {
  const todayIndex = WEEK_DAYS.indexOf(today);
  for (let offset = 0; offset < 7; offset += 1) {
    const index = (todayIndex + offset) % 7;
    const entry = schedule.find((day) => day.day === WEEK_DAYS[index]);
    if (!entry || !entry.open) continue;
    const start = minutesOf(entry.start);
    if (start === null || (offset === 0 && current >= start)) continue;
    return { day: entry.day, start: entry.start };
  }
  return null;
}

export const SettingsModel = {
  async get(key: string): Promise<string | undefined> {
    const row = await getDb()
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value;
  },

  async set(key: string, value: string): Promise<void> {
    await getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  },

  async getAll(): Promise<Setting[]> {
    return (await getDb()
      .prepare("SELECT key, value FROM settings ORDER BY key")
      .all()) as unknown as Setting[];
  },

  async object(): Promise<Record<string, string>> {
    return Object.fromEntries(
      (await SettingsModel.getAll()).map((s) => [s.key, s.value])
    );
  },

  async paymentBusinessDate(at: Date = new Date()): Promise<string> {
    const savedDate = await SettingsModel.get("payments_business_date");
    const scheduledDate = await scheduledBusinessDate(at);
    if ((await SettingsModel.get("ordering_closed")) === "true") {
      return savedDate || scheduledDate || dateKeyInOrderingZone(at);
    }
    const businessDate = scheduledDate || savedDate || dateKeyInOrderingZone(at);
    if (businessDate !== savedDate) {
      await SettingsModel.set("payments_business_date", businessDate);
    }
    return businessDate;
  },

  /**
   * Whether the cafe is taking orders right now, based on the manual pause,
   * the weekly schedule and the last-order cut-off.
   */
  async isOrderingOpen(at: Date = new Date()): Promise<boolean> {
    return (await SettingsModel.orderingWindow(at)).open;
  },

  async isWithinOperatingHours(at: Date = new Date()): Promise<boolean> {
    const schedule = await scheduleOf();
    const { day, minutes } = orderingTimeOf(at);
    const todayIndex = WEEK_DAYS.indexOf(day);
    const today = schedule.find((entry) => entry.day === day);
    if (today?.open) {
      const start = minutesOf(today.start);
      const end = minutesOf(today.end);
      if (start !== null && end !== null) {
        const openNow =
          end <= start
            ? minutes >= start
            : minutes >= start && minutes < end;
        if (openNow) return true;
      }
    }

    const previousDay = WEEK_DAYS[(todayIndex + WEEK_DAYS.length - 1) % WEEK_DAYS.length];
    const previous = schedule.find((entry) => entry.day === previousDay);
    if (!previous?.open) return false;
    const previousStart = minutesOf(previous.start);
    const previousEnd = minutesOf(previous.end);
    return Boolean(
      previousStart !== null &&
        previousEnd !== null &&
        previousEnd <= previousStart &&
        previousEnd > 0 &&
        minutes < previousEnd
    );
  },

  localDateTime(at: Date): string {
    return localDateTime(at);
  },

  async scheduledCloseAfter(
    since: Date,
    until: Date = new Date()
  ): Promise<string | null> {
    if (!Number.isFinite(since.getTime()) || until <= since) return null;
    const schedule = await scheduleOf();
    const startParts = dateKeyInOrderingZone(since).split("-").map(Number);
    const endParts = dateKeyInOrderingZone(until).split("-").map(Number);
    const firstDate = Date.UTC(startParts[0], startParts[1] - 1, startParts[2] - 1);
    const lastDate = Math.min(
      Date.UTC(endParts[0], endParts[1] - 1, endParts[2]),
      firstDate + 8 * 24 * 60 * 60 * 1000
    );
    const manilaOffset = 8 * 60 * 60 * 1000;
    let earliestClose: { timestamp: number; local: string } | null = null;

    for (let date = firstDate; date <= lastDate; date += 24 * 60 * 60 * 1000) {
      const calendarDate = new Date(date);
      const weekday = WEEK_DAYS[calendarDate.getUTCDay()];
      const entry = schedule.find((item) => item.day === weekday);
      if (!entry?.open) continue;
      const start = minutesOf(entry.start);
      const end = minutesOf(entry.end);
      if (start === null || end === null) continue;
      const nextDay = end === 0 || end <= start;
      const closeDate = new Date(date + (nextDay ? 24 * 60 * 60 * 1000 : 0));
      const closeHour = end === 0 ? 0 : Math.floor(end / 60);
      const closeMinute = end % 60;
      const timestamp =
        Date.UTC(
          closeDate.getUTCFullYear(),
          closeDate.getUTCMonth(),
          closeDate.getUTCDate(),
          closeHour,
          closeMinute
        ) - manilaOffset;
      if (
        timestamp > since.getTime() &&
        timestamp <= until.getTime() &&
        (!earliestClose || timestamp < earliestClose.timestamp)
      ) {
        earliestClose = {
          timestamp,
          local: localDateTime(new Date(timestamp)),
        };
      }
    }

    return earliestClose?.local || null;
  },

  /** Full picture of the ordering window, for customer-facing copy. */
  async orderingWindow(at: Date = new Date()): Promise<OrderingWindow> {
    const schedule = await scheduleOf();
    const { day: today, minutes: current } = orderingTimeOf(at);
    const entry = schedule.find((day) => day.day === today);
    const upcoming = nextOpening(schedule, today, current);
    const base = {
      today,
      schedule,
      last_order_at: entry?.open ? entry.last_order : null,
      last_order_warning: false,
      closes_at: entry?.open ? entry.end : null,
      opens_day: upcoming?.day ?? today,
      opens_at: upcoming?.start ?? null,
      opens_tomorrow: upcoming?.tomorrow ?? false,
      next_opening: nextScheduledOpening(schedule, today, current),
    };

    if ((await SettingsModel.get("ordering_closed")) === "true") {
      return { ...base, open: false, reason: "manual" };
    }

    const previousDay = WEEK_DAYS[(WEEK_DAYS.indexOf(today) + 6) % 7];
    const previousEntry = schedule.find((day) => day.day === previousDay);
    const previousStart = previousEntry ? minutesOf(previousEntry.start) : null;
    const previousEnd = previousEntry ? minutesOf(previousEntry.end) : null;
    const continuesFromPreviousDay = Boolean(
      previousEntry?.open &&
        previousStart !== null &&
        previousEnd !== null &&
        previousEnd > 0 &&
        previousEnd <= previousStart &&
        current < previousEnd
    );
    const inWindow = Boolean(
      (entry?.open && isWithinSchedule(entry, current)) ||
        continuesFromPreviousDay
    );
    const activeSchedule = continuesFromPreviousDay
      ? previousEntry
      : entry?.open && isWithinSchedule(entry, current)
        ? entry
        : null;
    const activeStart = activeSchedule ? minutesOf(activeSchedule.start) : null;
    const activeEnd = activeSchedule ? minutesOf(activeSchedule.end) : null;
    const activeCutoff = activeSchedule
      ? minutesOf(activeSchedule.last_order)
      : null;
    const activeOvernight =
      activeStart !== null &&
      activeEnd !== null &&
      activeEnd !== 0 &&
      activeEnd <= activeStart;
    let activeCutoffAt = activeCutoff;
    if (
      activeCutoffAt !== null &&
      activeOvernight &&
      activeStart !== null &&
      activeCutoffAt < activeStart
    ) {
      activeCutoffAt += 24 * 60;
    }
    if (activeCutoffAt === 0 && activeEnd === 0) {
      activeCutoffAt = 24 * 60;
    }
    if (activeCutoffAt !== null && activeEnd !== null) {
      const activeEndAt =
        activeEnd === 0
          ? 24 * 60
          : activeOvernight
            ? activeEnd + 24 * 60
            : activeEnd;
      activeCutoffAt = Math.min(
        activeCutoffAt,
        activeEndAt
      );
    }
    const activeTime =
      (continuesFromPreviousDay && activeSchedule === previousEntry) ||
      (activeOvernight && activeStart !== null && current < activeStart)
        ? current + 24 * 60
        : current;

    if (!inWindow) {
      const start = entry?.open ? minutesOf(entry.start) : null;
      if (entry?.open && start !== null && current < start) {
        return {
          ...base,
          open: false,
          reason: "before-open",
          opens_day: today,
          opens_at: entry.start,
          opens_tomorrow: false,
        };
      }
      if (!entry?.open) {
        return { ...base, open: false, reason: "closed-day" };
      }
      return { ...base, open: false, reason: "after-close" };
    }

    if (activeCutoffAt !== null && activeTime >= activeCutoffAt) {
      return {
        ...base,
        last_order_at: activeSchedule?.last_order ?? base.last_order_at,
        open: false,
        reason: "after-cutoff",
      };
    }

    return {
      ...base,
      last_order_at: activeSchedule?.last_order ?? base.last_order_at,
      last_order_warning:
        activeCutoffAt !== null &&
        activeCutoffAt > activeTime &&
        activeCutoffAt - activeTime <= 30,
      open: true,
      reason: "open",
    };
  },
};

// ============================================================
// Sales & reports
// ============================================================
export const SalesModel = {
  async overview() {
    const db = getDb();
    const row = await db
      .prepare(
        `SELECT
           COALESCE(SUM(total), 0) AS total_revenue,
           COUNT(*) AS total_orders,
           COALESCE(ROUND(AVG(
             CASE WHEN ready_at IS NOT NULL AND confirmed_at IS NOT NULL
             THEN (julianday(ready_at) - julianday(confirmed_at)) * 1440 END
           ), 0), 0) AS avg_prep_time
         FROM orders
           WHERE status IN ('ready', 'completed')
             AND ready_at IS NOT NULL
             AND payment_status = 'verified'`
      )
      .get() as any;
    return {
      total_revenue: Number(row?.total_revenue || 0),
      total_orders: Number(row?.total_orders || 0),
      avg_prep_time: Number(row?.avg_prep_time || 0),
    };
  },

  async bestSellingItems(limit = 10) {
    return (await getDb()
      .prepare(
        `SELECT oi.name,
                SUM(oi.quantity) AS total_quantity,
                SUM(oi.price_at_time * oi.quantity) AS total_revenue
         FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         WHERE o.status IN ('ready','completed')
           AND o.ready_at IS NOT NULL
           AND o.payment_status = 'verified'
         GROUP BY oi.name
         ORDER BY total_quantity DESC, total_revenue DESC
         LIMIT ?`
      )
      .all(limit)) as unknown as {
      name: string;
      total_quantity: number;
      total_revenue: number;
    }[];
  },

  async bestSellingItemsBetween(startDate: string, endDate: string, limit = 6) {
    return (await getDb()
      .prepare(
        `SELECT oi.menu_item_id,
                oi.name,
                SUM(oi.quantity) AS total_quantity,
                SUM(oi.price_at_time * oi.quantity) AS total_revenue,
                mi.is_best_seller,
                mi.is_active,
                mi.stock_status,
                mi.stock_count
         FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
         WHERE o.status IN ('ready','completed')
           AND o.ready_at IS NOT NULL
           AND o.payment_status = 'verified'
           AND DATE(o.created_at) >= ?
           AND DATE(o.created_at) < ?
         GROUP BY oi.menu_item_id, oi.name, mi.is_best_seller, mi.is_active,
                  mi.stock_status, mi.stock_count
         ORDER BY total_quantity DESC, total_revenue DESC
         LIMIT ?`
      )
      .all(startDate, endDate, limit)) as unknown as {
      menu_item_id: number | null;
      name: string;
      total_quantity: number;
      total_revenue: number;
      is_best_seller: number | null;
      is_active: number | null;
      stock_status: "available" | "low" | "out" | null;
      stock_count: number | null;
    }[];
  },

  async peakHours() {
    return (await getDb()
      .prepare(
        `SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour,
                COUNT(*) AS order_count,
                COALESCE(SUM(total), 0) AS revenue
         FROM orders
         WHERE status IN ('ready','completed')
           AND ready_at IS NOT NULL
           AND payment_status = 'verified'
         GROUP BY hour
         ORDER BY hour`
      )
      .all()) as unknown as { hour: number; order_count: number; revenue: number }[];
  },

  async dailySales(days = 14, endDate?: string) {
    const dateFilter = endDate
      ? "DATE(created_at) >= DATE(?, ?) AND DATE(created_at) <= DATE(?)"
      : "DATE(created_at) >= DATE('now','localtime', ?)";
    const dateParams = endDate
      ? [endDate, `-${days} days`, endDate]
      : [`-${days} days`];
    const rows = await getDb()
      .prepare(
        `SELECT DATE(created_at) AS date,
                COUNT(*) AS total_orders,
                COALESCE(SUM(total), 0) AS revenue
         FROM orders
         WHERE status IN ('ready','completed')
           AND ready_at IS NOT NULL
           AND payment_status = 'verified'
           AND ${dateFilter}
         GROUP BY DATE(created_at)
         ORDER BY date`
      )
      .all(...dateParams) as unknown as {
      date: string;
      total_orders: number;
      revenue: number;
    }[];
    return rows;
  },

  async recentOrders(limit = 8) {
    return OrderModel.list(undefined, limit);
  },
};

// ============================================================
// Forecasting
// ============================================================
export const ForecastModel = {
  /**
   * Lightweight point-to-point forecasting service.
   * Uses a 3-day moving average + weekday uplift to project the next week.
   */
  async nextSevenDays() {
    const sales = await SalesModel.dailySales(28);
    const revenue = sales.map((s) => Number(s.revenue));
    const recent = revenue.slice(-7);
    const base = recent.length
      ? recent.reduce((a, b) => a + b, 0) / recent.length
      : 0;
    const trend =
      recent.length > 3
        ? (recent.slice(-3).reduce((a, b) => a + b, 0) / 3 -
            recent.slice(0, 3).reduce((a, b) => a + b, 0) / 3) /
          Math.max(recent.length, 1)
        : 0;

    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const points: { date: string; label: string; actual: number | null; forecast: number }[] = [];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const date = d.toISOString().slice(0, 10);
      const actualRow = sales.find((s) => s.date === date);
      const weekday = d.getDay();
      const uplift = weekday === 0 || weekday === 6 ? 1.08 : 1;
      const projected = Math.max(0, Math.round((base + trend * i) * uplift));
      points.push({
        date,
        label: labels[weekday],
        actual: actualRow ? Number(actualRow.revenue) : null,
        forecast: projected,
      });
    }
    return {
      points,
      average_daily: Math.round(base),
      projected_week: points.reduce((sum, p) => sum + p.forecast, 0),
      confidence: recent.length >= 5 ? "medium" : "low",
    };
  },
};

// ============================================================
// Activity log
// ============================================================
export type ActivityArea =
  | "Payments"
  | "Orders"
  | "Stock"
  | "Menu"
  | "Add-ons"
  | "Settings"
  | "Requests"
  | "Accounts"
  | "Access";

export interface ActivityLog {
  id: number;
  user_id: number | null;
  actor_name: string;
  actor_role: "admin" | "staff" | "system";
  area: string;
  action: string;
  summary: string;
  entity_type: string | null;
  entity_id: number | null;
  created_at: string;
}

export interface ActivityActor {
  id?: number | null;
  name: string;
  role: "admin" | "staff" | "system";
}

export interface ActivityEntry {
  area: ActivityArea;
  action: string;
  summary: string;
  entity_type?: string | null;
  entity_id?: number | null;
}

const ACTIVITY_TABLE = `
  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
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
  CREATE INDEX IF NOT EXISTS idx_activity_created
    ON activity_logs(created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_area
    ON activity_logs(area, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_user_action_created
    ON activity_logs(user_id, action, created_at);
`;

let activityTableReady: Promise<void> | null = null;
let activityBackfillChecked = false;

async function ensureActivityTable(): Promise<void> {
  if (activityTableReady) return activityTableReady;
  activityTableReady = (async () => {
    await getDb().exec(ACTIVITY_TABLE);
  })();
  return activityTableReady;
}

export const ActivityModel = {
  /** Records an administrative or staff action. Never breaks the action itself. */
  async log(actor: ActivityActor | null, entry: ActivityEntry): Promise<void> {
    try {
      await ensureActivityTable();
      await getDb()
        .prepare(
          `INSERT INTO activity_logs
             (user_id, actor_name, actor_role, area, action, summary, entity_type, entity_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          actor?.id ?? null,
          actor?.name || "Merrylane staff",
          actor?.role || "system",
          entry.area,
          entry.action,
          entry.summary,
          entry.entity_type ?? null,
          entry.entity_id ?? null
        );
    } catch {
      // Logging must never block the action the user asked for.
    }
  },

  async list(options: {
    limit?: number;
    offset?: number;
    date?: string;
    area?: string;
  } = {}): Promise<{ logs: ActivityLog[]; total: number }> {
    await ensureActivityTable();
    await ActivityModel.backfillFromHistory();
    const limit = Math.min(Math.max(Number(options.limit) || 40, 1), 100);
    const offset = Math.max(Number(options.offset) || 0, 0);
    const filters: string[] = [];
    const params: (string | number)[] = [];
    if (options.date) {
      filters.push("date(created_at) = date(?)");
      params.push(options.date);
    }
    if (options.area) {
      filters.push("area = ?");
      params.push(options.area);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const db = getDb();
    const logs = (await db
      .prepare(
        `SELECT * FROM activity_logs ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset)) as unknown as ActivityLog[];
    const row = (await db
      .prepare(`SELECT COUNT(*) AS total FROM activity_logs ${where}`)
      .get(...params)) as { total: number };
    return { logs, total: Number(row.total) };
  },

  async salesForStaffDate(
    userId: number,
    date: string
  ): Promise<{
    amount: number;
    transactions: number;
  }> {
    await ensureActivityTable();
    await ensureOrderColumns();
    await ensureStaffDutySessionsTable();
    const row = (await getDb()
      .prepare(
        `WITH verified_orders AS (
           SELECT DISTINCT logs.entity_id AS order_id
           FROM activity_logs AS logs
           JOIN staff_duty_sessions AS sessions
             ON sessions.user_id = logs.user_id
            AND logs.created_at >= sessions.login_at
             AND logs.created_at <= COALESCE(
               sessions.logout_at,
               CASE WHEN date(sessions.login_at) < date('now', 'localtime')
                 THEN date(sessions.login_at, '+1 day')
                 ELSE datetime('now', 'localtime')
               END
             )
           WHERE logs.user_id = ?
             AND logs.actor_role = 'staff'
             AND logs.action = 'payment.verified'
             AND logs.entity_type = 'order'
             AND logs.entity_id IS NOT NULL
             AND logs.created_at >= date(?)
             AND logs.created_at < date(?, '+1 day')
         ),
         order_sales AS (
           SELECT COALESCE(o.payment_amount, o.total, 0) AS amount
           FROM verified_orders AS verified
           JOIN orders AS o ON o.id = verified.order_id
         ),
         balance_sales AS (
           SELECT payments.amount
           FROM order_balance_payments AS payments
           JOIN staff_duty_sessions AS sessions
             ON sessions.user_id = payments.received_by
            AND payments.verified_at >= sessions.login_at
             AND payments.verified_at <= COALESCE(
               sessions.logout_at,
               CASE WHEN date(sessions.login_at) < date('now', 'localtime')
                 THEN date(sessions.login_at, '+1 day')
                 ELSE datetime('now', 'localtime')
               END
             )
           WHERE payments.received_by = ?
             AND payments.status = 'verified'
             AND payments.verified_at IS NOT NULL
             AND payments.verified_at >= date(?)
             AND payments.verified_at < date(?, '+1 day')
         )
         SELECT
           COALESCE((SELECT SUM(amount) FROM order_sales), 0) +
             COALESCE((SELECT SUM(amount) FROM balance_sales), 0) AS amount,
           (SELECT COUNT(*) FROM order_sales) +
             (SELECT COUNT(*) FROM balance_sales) AS transactions`
      )
      .get(userId, date, date, userId, date, date)) as {
      amount: number;
      transactions: number;
    };
    return {
      amount: Number(row.amount || 0),
      transactions: Number(row.transactions || 0),
    };
  },

  async salesForStaffRange(
    userId: number,
    startDate: string,
    endDateExclusive: string
  ): Promise<{ amount: number; transactions: number }> {
    await ensureActivityTable();
    await ensureOrderColumns();
    await ensureStaffDutySessionsTable();
    const row = (await getDb()
      .prepare(
        `WITH verified_orders AS (
           SELECT DISTINCT logs.entity_id AS order_id
           FROM activity_logs AS logs
           JOIN staff_duty_sessions AS sessions
             ON sessions.user_id = logs.user_id
            AND logs.created_at >= sessions.login_at
             AND logs.created_at <= COALESCE(
               sessions.logout_at,
               CASE WHEN date(sessions.login_at) < date('now', 'localtime')
                 THEN date(sessions.login_at, '+1 day')
                 ELSE datetime('now', 'localtime')
               END
             )
           WHERE logs.user_id = ?
             AND logs.actor_role = 'staff'
             AND logs.action = 'payment.verified'
             AND logs.entity_type = 'order'
             AND logs.entity_id IS NOT NULL
             AND logs.created_at >= ?
             AND logs.created_at < ?
         ),
         order_sales AS (
           SELECT COALESCE(o.payment_amount, o.total, 0) AS amount
           FROM verified_orders AS verified
           JOIN orders AS o ON o.id = verified.order_id
         ),
         balance_sales AS (
           SELECT payments.amount
           FROM order_balance_payments AS payments
           JOIN staff_duty_sessions AS sessions
             ON sessions.user_id = payments.received_by
            AND payments.verified_at >= sessions.login_at
             AND payments.verified_at <= COALESCE(
               sessions.logout_at,
               CASE WHEN date(sessions.login_at) < date('now', 'localtime')
                 THEN date(sessions.login_at, '+1 day')
                 ELSE datetime('now', 'localtime')
               END
             )
           WHERE payments.received_by = ?
             AND payments.status = 'verified'
             AND payments.verified_at IS NOT NULL
             AND payments.verified_at >= ?
             AND payments.verified_at < ?
         )
         SELECT
           COALESCE((SELECT SUM(amount) FROM order_sales), 0) +
             COALESCE((SELECT SUM(amount) FROM balance_sales), 0) AS amount,
           (SELECT COUNT(*) FROM order_sales) +
             (SELECT COUNT(*) FROM balance_sales) AS transactions`
      )
      .get(userId, startDate, endDateExclusive, userId, startDate, endDateExclusive)) as {
      amount: number;
      transactions: number;
    };
    return {
      amount: Number(row.amount || 0),
      transactions: Number(row.transactions || 0),
    };
  },

  async forStaffDate(userId: number, date: string, limit = 30): Promise<ActivityLog[]> {
    await ensureActivityTable();
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
    return (await getDb()
      .prepare(
        `SELECT * FROM activity_logs
         WHERE user_id = ?
           AND created_at >= date(?)
           AND created_at < date(?, '+1 day')
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(userId, date, date, safeLimit)) as unknown as ActivityLog[];
  },

  async loginDatesForStaffRange(
    userId: number,
    startDate: string,
    endDateExclusive: string
  ): Promise<string[]> {
    await ensureActivityTable();
    const rows = (await getDb()
      .prepare(
        `SELECT DISTINCT date(created_at) AS date
         FROM activity_logs
         WHERE user_id = ?
           AND action = 'auth.login'
           AND created_at >= date(?)
           AND created_at < date(?)
         ORDER BY date`
      )
      .all(userId, startDate, endDateExclusive)) as { date: string }[];
    return rows.map((row) => row.date);
  },

  async recent(limit = 6): Promise<ActivityLog[]> {
    return (await ActivityModel.list({ limit })).logs;
  },

  /**
   * The first time the log is opened, rebuild a truthful history from the
   * orders and stock records that already exist, so past days are visible.
   */
  async backfillFromHistory(): Promise<void> {
    if (activityBackfillChecked) return;
    try {
      await ensureActivityTable();
      const db = getDb();
      const marker = (await db
        .prepare("SELECT value FROM settings WHERE key = 'activity_backfilled'")
        .get()) as { value: string } | undefined;
      if (marker?.value === "1") {
        activityBackfillChecked = true;
        return;
      }

      const insert = db.prepare(
        `INSERT INTO activity_logs
           (user_id, actor_name, actor_role, area, action, summary, entity_type, entity_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      await db.transaction(async () => {
        const orders = (await db
          .prepare(
            `SELECT id, table_number, payment_method, payment_amount, total,
                    (SELECT COUNT(*) + 1
                     FROM orders earlier
                     WHERE earlier.created_at >= date(orders.created_at)
                       AND earlier.created_at < date(orders.created_at, '+1 day')
                       AND (earlier.created_at < orders.created_at
                         OR (earlier.created_at = orders.created_at AND earlier.id < orders.id))
                    ) AS order_number,
                    status, confirmed_at, ready_at, completed_at, cancelled_at
             FROM orders
             WHERE confirmed_at IS NOT NULL OR cancelled_at IS NOT NULL
             ORDER BY COALESCE(cancelled_at, confirmed_at, completed_at) ASC, id ASC`
          )
          .all()) as unknown as {
          id: number;
          table_number: number;
          order_number: number;
          payment_method: string;
          payment_amount: number | null;
          total: number;
          status: string;
          confirmed_at: string | null;
          ready_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
        }[];

        for (const order of orders) {
          const ref = `order #${String(order.order_number ?? order.id).padStart(3, "0")} · Table ${String(
            order.table_number
          ).padStart(2, "0")}`;
          if (order.cancelled_at) {
            await insert.run(
              null,
              "Merrylane staff",
              "staff",
              "Orders",
              "order.cancelled",
              `Cancelled ${ref}`,
              "order",
              order.id,
              order.cancelled_at
            );
            continue;
          }
          if (order.confirmed_at) {
            const method =
              order.payment_method === "gcash" ? "GCash" : "counter";
            const amount = Number(order.payment_amount ?? order.total ?? 0);
            await insert.run(
              null,
              "Merrylane staff",
              "staff",
              "Payments",
              "payment.verified",
              `Verified ${method} payment for ${ref} · ₱${amount.toLocaleString(
                "en-PH"
              )}`,
              "order",
              order.id,
              order.confirmed_at
            );
          }
          if (order.ready_at) {
            await insert.run(
              null,
              "Merrylane staff",
              "staff",
              "Orders",
              "order.ready",
              `Marked ${ref} ready`,
              "order",
              order.id,
              order.ready_at
            );
          }
          if (order.completed_at) {
            await insert.run(
              null,
              "Merrylane staff",
              "staff",
              "Orders",
              "order.completed",
              `Completed ${ref}`,
              "order",
              order.id,
              order.completed_at
            );
          }
        }

        const stock = (await db
          .prepare(
            `SELECT sl.id, sl.action, sl.quantity, sl.note, sl.created_at,
                    mi.name AS item_name, u.name AS user_name
             FROM stock_logs sl
             LEFT JOIN menu_items mi ON mi.id = sl.menu_item_id
             LEFT JOIN users u ON u.id = sl.created_by
             ORDER BY sl.created_at ASC, sl.id ASC`
          )
          .all()) as unknown as {
          id: number;
          action: string;
          quantity: number | null;
          note: string | null;
          created_at: string;
          item_name: string | null;
          user_name: string | null;
        }[];

        for (const entry of stock) {
          const item = entry.item_name || "a menu item";
          const summary =
            entry.action === "out_of_stock"
              ? `Marked ${item} sold out`
              : entry.action === "restock"
                ? `Restocked ${item}${
                    entry.quantity != null ? ` · ${entry.quantity} on hand` : ""
                  }`
                : entry.action === "quantity"
                  ? `Counted ${item} · ${entry.quantity ?? "unknown"} on hand`
                : entry.note
                  ? `Updated ${item} stock · ${entry.note}`
                  : `Updated ${item} stock`;
          await insert.run(
            null,
            entry.user_name || "Merrylane staff",
            "staff",
            "Stock",
            `stock.${entry.action}`,
            summary,
            "menu_item",
            null,
            entry.created_at
          );
        }

        await db
          .prepare(
            `INSERT INTO settings (key, value) VALUES ('activity_backfilled', '1')
             ON CONFLICT(key) DO UPDATE SET value = '1'`
          )
          .run();
      });
      activityBackfillChecked = true;
    } catch {
      // A failed backfill is not fatal; the live log still works.
    }
  },
};
