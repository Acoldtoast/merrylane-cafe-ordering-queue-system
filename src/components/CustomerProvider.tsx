"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { CartExtra, CartItem } from "@/lib/types";
import { limitSavedCart, remainingCustomerQuantity } from "@/lib/customerQuantity";

const CART_KEY = "merrylane.cart.v2";
const TABLE_KEY = "merrylane.table";
const ORDER_TYPE_KEY = "merrylane.order-type";
const LAST_ORDER_KEY = "merrylane.last-order";
const LEGACY_ORDER_KEY = "merrylane.legacy-order";

const DEFAULT_TABLE = 7;
const DEFAULT_ORDER_TYPE = "dine_in" as const;

interface AddItemInput {
  menuItemId: number;
  name: string;
  category: string;
  basePrice: number;
  variant?: { id: number; name: string; priceModifier: number } | null;
  variantIds?: number[];
  extras: CartExtra[];
  sugarLevel?: string | null;
  note?: string | null;
  quantity: number;
  stockLimit?: number | null;
}

interface CustomerContextValue {
  table: number;
  setTable: (table: number) => void;
  orderType: "dine_in" | "take_out";
  setOrderType: (type: "dine_in" | "take_out") => void;
  items: CartItem[];
  addItem: (item: AddItemInput) => void;
  updateCartItem: (key: string, item: AddItemInput) => void;
  setQuantity: (key: string, quantity: number) => void;
  removeItem: (key: string) => void;
  clearCart: () => void;
  setStockLimits: (limits: Record<number, number | null>) => void;
  count: number;
  subtotal: number;
  lastOrderId: number | null;
  legacyOrderId: number | null;
  setLastOrderId: (id: number | null) => void;
  ready: boolean;
}

interface RestoredState {
  table: number;
  orderType: "dine_in" | "take_out";
  items: CartItem[];
  lastOrderId: number | null;
  legacyOrderId: number | null;
}

/** What the server renders, and what the first client render must match. */
const EMPTY_RESTORED: RestoredState = {
  table: DEFAULT_TABLE,
  orderType: DEFAULT_ORDER_TYPE,
  items: [],
  lastOrderId: null,
  legacyOrderId: null,
};

const CustomerContext = createContext<CustomerContextValue | null>(null);

function itemKey(input: AddItemInput) {
  return [
    input.menuItemId,
    ...(input.variantIds?.length
      ? [...input.variantIds].sort((a, b) => a - b)
      : [input.variant?.id || 0]),
    input.sugarLevel || "-",
    (input.note || "").trim().toLowerCase(),
    ...input.extras.map((extra) => extra.id).sort((a, b) => a - b),
  ].join(":");
}

function quantityElsewhere(items: CartItem[], menuItemId: number, key?: string) {
  return items.reduce((sum, item) =>
    item.menuItemId === menuItemId && item.key !== key ? sum + item.quantity : sum, 0);
}

function storedPositiveNumber(key: string): number {
  const value = Number(localStorage.getItem(key) || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Read the visitor's saved state once per mount. A table number in the URL wins
 * because it comes from that table's QR code, so a previously visited table can
 * never override it.
 */
function readRestoredState(): RestoredState {
  try {
    const urlTable = Number(
      new URLSearchParams(window.location.search).get("table") || 0
    );
    const storedTable = storedPositiveNumber(TABLE_KEY);
    let table = DEFAULT_TABLE;
    if (urlTable > 0) {
      table = Math.max(1, Math.floor(urlTable));
      localStorage.setItem(TABLE_KEY, String(table));
    } else if (storedTable > 0) {
      table = storedTable;
    }

    const storedType = localStorage.getItem(ORDER_TYPE_KEY);
    const orderType =
      storedType === "take_out" || storedType === "dine_in"
        ? storedType
        : DEFAULT_ORDER_TYPE;

    let items: CartItem[] = [];
    const storedCart = localStorage.getItem(CART_KEY);
    if (storedCart) {
      const parsed = JSON.parse(storedCart);
      if (Array.isArray(parsed)) items = limitSavedCart<CartItem>(parsed);
    }

    const lastOrderId = storedPositiveNumber(LAST_ORDER_KEY) || null;
    const storedLegacyOrder = storedPositiveNumber(LEGACY_ORDER_KEY);
    if (!storedLegacyOrder && lastOrderId) {
      localStorage.setItem(LEGACY_ORDER_KEY, String(lastOrderId));
    }

    return {
      table,
      orderType,
      items,
      lastOrderId,
      legacyOrderId: storedLegacyOrder || lastOrderId,
    };
  } catch {
    // Ignore malformed or unavailable local storage.
    return EMPTY_RESTORED;
  }
}

const subscribeToHydration = () => () => {};

/**
 * False while the server HTML is still hydrating, true afterwards. Keeping the
 * server snapshot false makes the first client render identical to the server
 * markup; the saved cart arrives on the render right after hydration, so no
 * effect has to copy it into state.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  );
}

export function CustomerProvider({ children }: { children: React.ReactNode }) {
  /*
   * Storage is only read once the server markup has hydrated. The server
   * snapshot stays false so the first client render still matches it; the saved
   * state arrives on the render right after, without an effect copying it in.
   */
  const ready = useHydrated();
  const restored = useMemo(
    () => (ready ? readRestoredState() : EMPTY_RESTORED),
    [ready]
  );

  /* What the visitor changed since then, layered over the saved state. */
  const [changes, setChanges] = useState<Partial<RestoredState>>({});
  const { table, orderType, items, lastOrderId, legacyOrderId } = {
    ...restored,
    ...changes,
  };

  const setCart = useCallback(
    (update: (current: CartItem[]) => CartItem[]) => {
      setChanges((current) => ({
        ...current,
        items: update(current.items ?? restored.items),
      }));
    },
    [restored.items]
  );

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(items));
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, [items, ready]);

  const setTable = useCallback((next: number) => {
    const normalized = Math.max(1, Math.floor(next) || 1);
    setChanges((current) => ({ ...current, table: normalized }));
    try {
      localStorage.setItem(TABLE_KEY, String(normalized));
    } catch {}
  }, []);

  const setOrderType = useCallback((next: "dine_in" | "take_out") => {
    setChanges((current) => ({ ...current, orderType: next }));
    try {
      localStorage.setItem(ORDER_TYPE_KEY, next);
    } catch {}
  }, []);

  const setLastOrderId = useCallback((id: number | null) => {
    setChanges((current) => ({ ...current, lastOrderId: id }));
    try {
      if (id) localStorage.setItem(LAST_ORDER_KEY, String(id));
      else localStorage.removeItem(LAST_ORDER_KEY);
    } catch {}
  }, []);

  const addItem = useCallback((input: AddItemInput) => {
    const key = itemKey(input);
    const limit = input.stockLimit ?? null;
    if (limit !== null && limit <= 0) return;
    const unitPrice =
      Number(input.basePrice) +
      Number(input.variant?.priceModifier || 0) +
      input.extras.reduce((sum, extra) => sum + Number(extra.price_modifier), 0);

    setCart((current) => {
      const existing = current.find((item) => item.key === key);
      const stockLimit = input.stockLimit === undefined ? existing?.stockLimit : limit;
      const quantity = Math.min(
        Math.max(1, input.quantity),
        remainingCustomerQuantity(stockLimit, quantityElsewhere(current, input.menuItemId))
      );
      if (!quantity) return current;
      if (existing) {
        return current.map((item) =>
          item.key === key
            ? {
                ...item,
                quantity: existing.quantity + quantity,
                stockLimit: stockLimit ?? null,
              }
            : item
        );
      }
      return [
        ...current,
        {
          key,
          menuItemId: input.menuItemId,
          name: input.name,
          category: input.category,
          basePrice: Number(input.basePrice),
          variant: input.variant || null,
          variantIds: input.variantIds || (input.variant ? [input.variant.id] : []),
          extras: input.extras,
          sugarLevel: input.sugarLevel || null,
          note: input.note?.trim() || null,
          quantity,
          unitPrice,
          stockLimit: limit,
        },
      ];
    });
  }, [setCart]);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setCart((current) =>
      quantity <= 0
        ? current.filter((item) => item.key !== key)
        : current.map((item) => {
            if (item.key !== key) return item;
            return {
              ...item,
              quantity: quantity <= item.quantity ? quantity : Math.max(item.quantity, Math.min(
                quantity, remainingCustomerQuantity(item.stockLimit, quantityElsewhere(current, item.menuItemId, key))
              )),
            };
          })
    );
  }, [setCart]);

  const setStockLimits = useCallback((limits: Record<number, number | null>) => {
    setCart((current) =>
      current.map((item) =>
        Object.prototype.hasOwnProperty.call(limits, item.menuItemId)
          ? { ...item, stockLimit: limits[item.menuItemId] }
          : item
      )
    );
  }, [setCart]);

  const updateCartItem = useCallback(
    (key: string, input: AddItemInput) => {
      setCart((current) => {
        const item = current.find((entry) => entry.key === key);
        if (!item) return current;

        const nextKey = itemKey(input);
        const variantModifier = Number(input.variant?.priceModifier || 0);
        const unitPrice =
          Number(input.basePrice) +
          variantModifier +
          input.extras.reduce(
            (sum, extra) => sum + Number(extra.price_modifier),
            0
          );
        const stockLimit =
          input.stockLimit === undefined
            ? item.stockLimit ?? null
            : input.stockLimit;
        const quantity = Math.min(
          Math.max(1, input.quantity),
          remainingCustomerQuantity(stockLimit, quantityElsewhere(current, input.menuItemId, key))
        );
        if (!quantity) return current;
        const updatedItem: CartItem = {
          ...item,
          key: nextKey,
          menuItemId: input.menuItemId,
          name: input.name,
          category: input.category,
          basePrice: Number(input.basePrice),
          variant: input.variant || null,
          variantIds: input.variantIds || (input.variant ? [input.variant.id] : []),
          extras: input.extras,
          sugarLevel: input.sugarLevel || null,
          note: input.note?.trim() || null,
          quantity,
          unitPrice,
          stockLimit,
        };
        const matchingItem = current.find(
          (entry) => entry.key === nextKey && entry.key !== key
        );
        if (matchingItem) {
          return current
            .filter((entry) => entry.key !== key)
            .map((entry) => {
              if (entry.key !== nextKey) return entry;
              const merged = entry.quantity + updatedItem.quantity;
              return {
                ...entry,
                quantity: merged,
                stockLimit,
              };
            });
        }
        return current.map((entry) =>
          entry.key === key ? updatedItem : entry
        );
      });
    },
    [setCart]
  );

  const removeItem = useCallback((key: string) => {
    setCart((current) => current.filter((item) => item.key !== key));
  }, [setCart]);

  const clearCart = useCallback(() => {
    setCart(() => []);
    setOrderType("dine_in");
  }, [setCart, setOrderType]);

  const count = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items]
  );
  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [items]
  );

  const value = useMemo(
    () => ({
      table,
      setTable,
      orderType,
      setOrderType,
      items,
      addItem,
      updateCartItem,
      setQuantity,
      removeItem,
      clearCart,
      setStockLimits,
      count,
      subtotal,
      lastOrderId,
      legacyOrderId,
      setLastOrderId,
      ready,
    }),
    [
      table,
      setTable,
      orderType,
      setOrderType,
      items,
      addItem,
      updateCartItem,
      setQuantity,
      removeItem,
      clearCart,
      setStockLimits,
      count,
      subtotal,
      lastOrderId,
      legacyOrderId,
      setLastOrderId,
      ready,
    ]
  );

  return (
    <CustomerContext.Provider value={value}>{children}</CustomerContext.Provider>
  );
}

export function useCustomer() {
  const context = useContext(CustomerContext);
  if (!context) {
    throw new Error("useCustomer must be used inside CustomerProvider");
  }
  return context;
}
