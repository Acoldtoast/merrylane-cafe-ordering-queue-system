"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CartExtra, CartItem } from "@/lib/types";

const CART_KEY = "merrylane.cart.v2";
const TABLE_KEY = "merrylane.table";
const ORDER_TYPE_KEY = "merrylane.order-type";
const LAST_ORDER_KEY = "merrylane.last-order";
const LEGACY_ORDER_KEY = "merrylane.legacy-order";

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

export function CustomerProvider({ children }: { children: React.ReactNode }) {
  const [table, setTableState] = useState(7);
  const [orderType, setOrderTypeState] = useState<"dine_in" | "take_out">("dine_in");
  const [items, setItems] = useState<CartItem[]>([]);
  const [lastOrderId, setLastOrderIdState] = useState<number | null>(null);
  const [legacyOrderId, setLegacyOrderId] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      // A table number in the URL always wins — it comes from the table's QR
      // code, so it must never be overridden by a previously visited table.
      const urlTable = Number(
        new URLSearchParams(window.location.search).get("table") || 0
      );
      const storedTable = Number(localStorage.getItem(TABLE_KEY) || 0);
      if (urlTable > 0) {
        const normalized = Math.max(1, Math.floor(urlTable));
        setTableState(normalized);
        localStorage.setItem(TABLE_KEY, String(normalized));
      } else if (storedTable > 0) {
        setTableState(storedTable);
      }

      const storedType = localStorage.getItem(ORDER_TYPE_KEY);
      if (storedType === "take_out" || storedType === "dine_in") {
        setOrderTypeState(storedType);
      }

      const storedCart = localStorage.getItem(CART_KEY);
      if (storedCart) {
        const parsed = JSON.parse(storedCart);
        if (Array.isArray(parsed)) setItems(parsed);
      }

      const storedOrder = Number(localStorage.getItem(LAST_ORDER_KEY) || 0);
      if (storedOrder > 0) setLastOrderIdState(storedOrder);

      const storedLegacyOrder = Number(
        localStorage.getItem(LEGACY_ORDER_KEY) || 0
      );
      if (storedLegacyOrder > 0) {
        setLegacyOrderId(storedLegacyOrder);
      } else if (storedOrder > 0) {
        setLegacyOrderId(storedOrder);
        localStorage.setItem(LEGACY_ORDER_KEY, String(storedOrder));
      }
    } catch {
      // Ignore malformed local storage.
    }
    setReady(true);
  }, []);

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
    setTableState(normalized);
    try {
      localStorage.setItem(TABLE_KEY, String(normalized));
    } catch {}
  }, []);

  const setOrderType = useCallback((next: "dine_in" | "take_out") => {
    setOrderTypeState(next);
    try {
      localStorage.setItem(ORDER_TYPE_KEY, next);
    } catch {}
  }, []);

  const setLastOrderId = useCallback((id: number | null) => {
    setLastOrderIdState(id);
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

    setItems((current) => {
      const existing = current.find((item) => item.key === key);
      if (existing) {
        const merged = existing.quantity + Math.max(1, input.quantity);
        const nextQuantity =
          limit === null ? merged : Math.min(merged, Math.max(1, limit));
        return current.map((item) =>
          item.key === key
            ? {
                ...item,
                quantity: nextQuantity,
                stockLimit: limit ?? item.stockLimit ?? null,
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
          quantity: Math.max(1, input.quantity),
          unitPrice,
          stockLimit: limit,
        },
      ];
    });
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setItems((current) =>
      quantity <= 0
        ? current.filter((item) => item.key !== key)
        : current.map((item) => {
            if (item.key !== key) return item;
            const requested = Math.max(1, quantity);
            return {
              ...item,
              quantity:
                item.stockLimit === null || item.stockLimit === undefined
                  ? requested
                  : Math.min(requested, Math.max(1, item.stockLimit)),
            };
          })
    );
  }, []);

  const setStockLimits = useCallback((limits: Record<number, number | null>) => {
    setItems((current) =>
      current.map((item) =>
        Object.prototype.hasOwnProperty.call(limits, item.menuItemId)
          ? { ...item, stockLimit: limits[item.menuItemId] }
          : item
      )
    );
  }, []);

  const updateCartItem = useCallback(
    (key: string, input: AddItemInput) => {
      setItems((current) => {
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
          quantity:
            stockLimit === null
              ? Math.max(1, input.quantity)
              : Math.min(Math.max(1, input.quantity), Math.max(1, stockLimit)),
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
                quantity:
                  stockLimit === null
                    ? merged
                    : Math.min(merged, Math.max(1, stockLimit)),
                stockLimit,
              };
            });
        }
        return current.map((entry) =>
          entry.key === key ? updatedItem : entry
        );
      });
    },
    []
  );

  const removeItem = useCallback((key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

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
