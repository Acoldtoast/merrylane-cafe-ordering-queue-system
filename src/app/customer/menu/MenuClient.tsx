"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CoffeeArt, artKindForCategory } from "@/components/CoffeeArt";
import { Icon } from "@/components/Icons";
import { useFeedback } from "@/components/Feedback";
import { CartPanel, MobileCartBar } from "@/components/CartPanel";
import { useCustomer } from "@/components/CustomerProvider";
import type { Category, MenuItem } from "@/lib/types";
import type { OrderingWindow } from "@/lib/models";
import { peso, timeLabel, timeOfDay } from "@/lib/format";
import { preloadPortalRouteCode } from "@/lib/preloadPortalRouteCode";
import { CUSTOMER_ITEM_LIMIT, CUSTOMER_ITEM_LIMIT_MESSAGE, remainingCustomerQuantity } from "@/lib/customerQuantity";
import {
  reconcileCartStock,
  stockWarningCopy,
  stockWarningDetails,
} from "@/lib/cartStock";
import { useQuantityLimitWarning } from "@/lib/useQuantityLimitWarning";
import { priceWithVat } from "@/lib/vat";

type AddButtonFeedback = {
  itemId: number;
  status: "adding" | "added" | "opening";
};

export function MenuClient({
  initialTable,
  initialCategories,
  initialItems,
  initialOpen,
  initialClosingTime,
  initialOrdering,
}: {
  initialTable: number;
  initialCategories: Category[];
  initialItems: MenuItem[];
  initialOpen: boolean;
  initialClosingTime: string;
  initialOrdering?: OrderingWindow | null;
}) {
  const router = useRouter();
  const { setTable, addItem, setStockLimits, setQuantity, removeItem, items: cartItems, ready, vatRatePct } =
    useCustomer();
  const feedback = useFeedback();
  const { warningKey, warn } = useQuantityLimitWarning<number>();
  const categories = initialCategories;
  const items = initialItems;
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<number | "all">("all");
  const [addButtonFeedback, setAddButtonFeedback] =
    useState<AddButtonFeedback | null>(null);
  const open = initialOpen;
  const closingTime = initialClosingTime;
  const reopenLabel = initialOrdering?.next_opening
    ? `${initialOrdering.next_opening.day} at ${timeLabel(
        initialOrdering.next_opening.start
      )}`
    : initialOrdering?.opens_at
      ? timeLabel(initialOrdering.opens_at)
      : null;

  useEffect(() => {
    setTable(initialTable);
  }, [initialTable, setTable]);

  useEffect(() => {
    if (!addButtonFeedback) return;
    const timer = window.setTimeout(
      () => {
        setAddButtonFeedback((current) => {
          if (current?.itemId !== addButtonFeedback.itemId) return current;
          if (current.status === "adding") {
            return { itemId: current.itemId, status: "added" };
          }
          return null;
        });
      },
      addButtonFeedback.status === "adding"
        ? 180
        : addButtonFeedback.status === "added"
          ? 900
          : 15000
    );
    return () => window.clearTimeout(timer);
  }, [addButtonFeedback]);

  // Keep the cart rail honest about how many portions are actually left.
  const cartItemsRef = useRef(cartItems);
  useEffect(() => {
    cartItemsRef.current = cartItems;
  }, [cartItems]);

  useEffect(() => {
    if (!ready) return;
    const adjusted = reconcileCartStock(initialItems, cartItemsRef.current, {
      setQuantity,
      removeItem,
      setStockLimits,
    });
    if (adjusted.length > 0) {
      const copy = stockWarningCopy(adjusted, "browse");
      feedback.warning(copy.title, {
        eyebrow: "Stock changed",
        duration: 0,
        message: copy.message,
        details: stockWarningDetails(adjusted),
      });
    }
  }, [initialItems, ready, feedback, setQuantity, removeItem, setStockLimits]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (!item.is_active) return false;
      const matchesCategory =
        activeCategory === "all" || item.category_id === activeCategory;
      const matchesQuery =
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.category_name?.toLowerCase().includes(query);
      return matchesCategory && matchesQuery;
    });
  }, [items, search, activeCategory]);

  const grouped = useMemo(() => {
    const groups: { category: string; items: MenuItem[] }[] = [];
    for (const cat of categories) {
      const groupItems = filtered.filter((item) => item.category_id === cat.id);
      if (groupItems.length) groups.push({ category: cat.name, items: groupItems });
    }
    return groups;
  }, [categories, filtered]);
  const normalizedSearch = search.trim();
  const activeCategoryName =
    activeCategory === "all"
      ? null
      : categories.find((category) => category.id === activeCategory)?.name || null;

  const openItem = (item: MenuItem) => {
    if (item.stock_status === "out") return;
    setAddButtonFeedback({ itemId: item.id, status: "opening" });
    router.push(`/customer/item/${item.id}?table=${initialTable}`);
  };

  const warmItemRoute = (item: MenuItem) => {
    if (item.stock_status === "out") return;
    const href = `/customer/item/${item.id}?table=${initialTable}`;
    router.prefetch(href);
    void preloadPortalRouteCode("customer", href);
  };

  const stockLimitFor = (item: MenuItem) =>
    item.stock_tracking_enabled ? Math.max(0, item.stock_count) : null;

  const inCartQuantity = (menuItemId: number) =>
    cartItems
      .filter((entry) => entry.menuItemId === menuItemId)
      .reduce((sum, entry) => sum + entry.quantity, 0);

  const quickAdd = (item: MenuItem) => {
    if (!ready) return;
    if (item.stock_status === "out") {
      feedback.warning(`${item.name} is sold out`, {
        eyebrow: "Sold out today",
        message:
          "This one has run out. Ask our team about a similar drink or pastry.",
      });
      return;
    }
    const inCart = inCartQuantity(item.id);
    if (inCart >= CUSTOMER_ITEM_LIMIT) {
      warn(item.id);
      return;
    }
    if (item.variants.length || item.extras.length) {
      openItem(item);
      return;
    }
    if (remainingCustomerQuantity(stockLimitFor(item), inCart) <= 0) {
      const limit = stockLimitFor(item) ?? 0;
      feedback.warning(
        limit > 0 ? `Only ${limit} ${item.name} today` : `${item.name} is sold out`,
        {
          eyebrow: "That's all we have",
          message:
            limit > 0
              ? "Your cart already has every portion we have left. Adjust the quantity in your cart if you need fewer."
              : "This one has run out. Ask our team about a similar drink or pastry.",
        }
      );
      return;
    }
    setAddButtonFeedback({ itemId: item.id, status: "adding" });
    addItem({
      menuItemId: item.id,
      name: item.name,
      category: item.category_name || "",
      basePrice: Number(item.price),
      variant: null,
      extras: [],
      quantity: 1,
      stockLimit: stockLimitFor(item),
    });
    feedback.success(item.name, {
      eyebrow: "In the bag",
      message: "1 added. Open your cart when you're ready to check out.",
      duration: 1400,
      details: [
        { label: "Item", value: item.name },
        { label: "Price", value: peso(priceWithVat(Number(item.price), vatRatePct)) },
        { label: "Quantity", value: "1" },
      ],
    });
  };

  return (
    <div className="menu-page">
      {!open && (
        <div className="order-closed-banner">
          <Icon name="clock" />
          <div>
            {!initialOrdering ? (
              <>
                <strong>The menu is temporarily unavailable.</strong>
                <span>Please <button type="button" className="text-link" onClick={() => router.refresh()}>try again</button> in a moment.</span>
              </>
            ) : (
              <>
                <strong>Ordering is closed for today.</strong>
                <span>
                  You can still browse the menu. Ordering reopens{" "}
                  {reopenLabel ?? "soon"}
                  {closingTime ? ` · today until ${timeLabel(closingTime)}` : ""}.
                </span>
              </>
            )}
          </div>
        </div>
      )}

      <div className="page-heading">
        <div>
          <h1>{timeOfDay()} · Table {String(initialTable).padStart(2, "0")}</h1>
        </div>
      </div>

      <div className="menu-layout">
        <section className="menu-content">
          <div className="menu-toolbar">
            <div className="menu-toolbar-row">
              <div className="search-box">
                <Icon name="search" />
                <input
                  className="input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search coffee, pastries, favourites…"
                  aria-label="Search menu"
                />
              </div>
            </div>
            <div className="category-row">
              <button
                type="button"
                onClick={() => setActiveCategory("all")}
                className={`category-pill ${activeCategory === "all" ? "active" : ""}`}
              >
                All items
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActiveCategory(category.id)}
                  className={`category-pill ${activeCategory === category.id ? "active" : ""}`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          {grouped.length === 0 ? (
            <div className="menu-empty">
              {normalizedSearch ? (
                `No menu items${activeCategoryName ? ` in ${activeCategoryName}` : ""} match “${normalizedSearch}”. Try a different search${activeCategoryName ? " or category" : ""}.`
              ) : activeCategoryName ? (
                `No menu items are available in ${activeCategoryName} right now.`
              ) : (
                "No menu items are available right now."
              )}
            </div>
          ) : (
            grouped.map((group) => (
              <section className="menu-section" key={group.category}>
                <div className="menu-section-head">
                  <h2>{group.category}</h2>
                  <span>{group.items.length} items</span>
                </div>
                <div className="menu-grid">
                  {group.items.map((item, index) => {
                    const out = item.stock_status === "out";
                    const addState =
                      addButtonFeedback?.itemId === item.id
                        ? addButtonFeedback.status
                        : null;
                    const isAdding =
                      !ready || addState === "adding" || addState === "opening";
                    const isAdded = addState === "added";
                    const inCart = inCartQuantity(item.id);
                    const atOrderLimit = inCart >= CUSTOMER_ITEM_LIMIT;
                    const remaining = remainingCustomerQuantity(stockLimitFor(item), inCart);
                    const addButtonLabel = !ready
                      ? `Loading cart for ${item.name}`
                      : addState === "opening"
                        ? `Opening ${item.name} options`
                        : addState === "adding"
                          ? `Adding ${item.name}`
                          : isAdded
                            ? `${item.name} added`
                            : out
                              ? "Sold out"
                              : !atOrderLimit && remaining <= 0
                                ? `No more ${item.name} left`
                                : `Add ${item.name}`;
                    return (
                      <div
                        key={item.id}
                        className={`menu-card ${out ? "is-out" : ""}`}
                        role="button"
                        tabIndex={0}
                        onMouseEnter={() => warmItemRoute(item)}
                        onFocus={() => warmItemRoute(item)}
                        onClick={() => openItem(item)}
                        onKeyDown={(event) => {
                          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                            openItem(item);
                          }
                        }}
                      >
                        <div className={`menu-art tone-${(index % 4) + 1}`}>
                          {item.is_best_seller ? (
                            <span className="badge badge-dark menu-category-tag">
                              Best seller
                            </span>
                          ) : (
                            <span className="badge badge-cream menu-category-tag">
                              {item.category_name}
                            </span>
                          )}
                          {item.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="menu-product-image"
                              src={item.image_url}
                              alt={item.name}
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <CoffeeArt kind={artKindForCategory(item.category_name, item.name)} />
                          )}
                          {out && <div className="out-stamp">Sold out today</div>}
                        </div>
                        <div className="menu-info">
                          <div className="menu-name">{item.name}</div>
                          <div className="menu-desc">{item.description}</div>
                          <div className="quantity-limit-warning" role="status">
                            {warningKey === item.id ? CUSTOMER_ITEM_LIMIT_MESSAGE : ""}
                          </div>
                          {item.stock_status === "low" && (
                            <span className="stock-note">
                              <Icon name="clock" size={9} />{" "}
                              {item.stock_tracking_enabled
                                ? `Only ${item.stock_count} left`
                                : item.stock_note || "Running low"}
                            </span>
                          )}
                          <div className="menu-bottom">
                            <div className="menu-price">
                              <sup>₱</sup>
                              {priceWithVat(Number(item.price), vatRatePct).toLocaleString("en-PH", {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0,
                              })}
                            </div>
                            <button
                              type="button"
                              className={`menu-add ${isAdded ? "is-added" : ""}`}
                              disabled={
                                out ||
                                !open ||
                                isAdding ||
                                 (!atOrderLimit && remaining <= 0)
                              }
                              aria-busy={isAdding}
                              aria-label={addButtonLabel}
                              onClick={(event) => {
                                event.stopPropagation();
                                quickAdd(item);
                              }}
                            >
                              {isAdding ? (
                                <span
                                  className="spinner menu-add-spinner"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Icon
                                  name={
                                    isAdded ? "check" : out ? "x" : "plus"
                                  }
                                />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}

        </section>

        <div className="desktop-only">
          <CartPanel />
        </div>
      </div>

      <MobileCartBar />
    </div>
  );
}
