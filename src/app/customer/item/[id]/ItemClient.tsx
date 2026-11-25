"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CoffeeArt, artKindForCategory } from "@/components/CoffeeArt";
import { Icon } from "@/components/Icons";
import { SkeletonLine } from "@/components/PortalSkeletonPrimitives";
import { useFeedback } from "@/components/Feedback";
import { useCustomer } from "@/components/CustomerProvider";
import type { MenuExtra, MenuItem, MenuVariant } from "@/lib/types";
import { peso } from "@/lib/format";
import { CUSTOMER_ITEM_LIMIT_MESSAGE, remainingCustomerQuantity } from "@/lib/customerQuantity";
import { useQuantityLimitWarning } from "@/lib/useQuantityLimitWarning";
import { priceWithVat } from "@/lib/vat";

type FormValues = {
  selectedVariants: Record<string, number>;
  selectedExtras: number[];
  sugarLevel: string;
  note: string;
  quantity: number;
};

export function ItemClient({
  item,
  initialTable,
  editKey = null,
}: {
  item: MenuItem;
  initialTable: number;
  editKey?: string | null;
}) {
  const router = useRouter();
  const feedback = useFeedback();
  const { warningKey, warn } = useQuantityLimitWarning<number>();
  const { setTable, addItem, updateCartItem, items, ready, orderType, vatRatePct } = useCustomer();

  useEffect(() => {
    setTable(initialTable);
  }, [initialTable, setTable]);

  const groups = useMemo(() => {
    const map = new Map<string, MenuVariant[]>();
    for (const variant of item.variants) {
      if (!map.has(variant.variant_type)) map.set(variant.variant_type, []);
      map.get(variant.variant_type)!.push(variant);
    }
    return Array.from(map.entries());
  }, [item.variants]);

  const cartItem = editKey
    ? items.find((entry) => entry.key === editKey)
    : undefined;
  const editLoaded = !editKey || ready;
  const editMissing = Boolean(
    editKey && ready && (!cartItem || cartItem.menuItemId !== item.id)
  );

  /*
   * The form's initial value is the cart line being edited, or the item's own
   * defaults. Until the visitor changes a field the values stay derived, so the
   * edit is loaded from the cart without an effect copying it into state — and
   * it picks up the cart as soon as the provider has hydrated.
   */
  const baseForm = useMemo<FormValues>(() => {
    if (cartItem && cartItem.menuItemId === item.id) {
      const fromCart: Record<string, number> = {};
      for (const [type, variants] of groups) {
        const selectedVariant = variants.find((variant) =>
          (cartItem.variantIds || [cartItem.variant?.id || 0]).includes(variant.id)
        );
        if (selectedVariant) fromCart[type] = selectedVariant.id;
      }
      return {
        selectedVariants: fromCart,
        selectedExtras: cartItem.extras.map((extra) => extra.id),
        sugarLevel: cartItem.sugarLevel || "50%",
        note: cartItem.note || "",
        quantity: cartItem.quantity,
      };
    }
    const defaults: Record<string, number> = {};
    for (const [type, variants] of groups) {
      if (variants[0]) defaults[type] = variants[0].id;
    }
    return {
      selectedVariants: defaults,
      selectedExtras: [],
      sugarLevel: "50%",
      note: "",
      quantity: 1,
    };
  }, [cartItem, groups, item.id]);

  const [form, setForm] = useState<FormValues | null>(null);
  const {
    selectedVariants,
    selectedExtras,
    sugarLevel,
    note,
    quantity: requestedQuantity,
  } = form ?? baseForm;

  const updateForm = (patch: (current: FormValues) => Partial<FormValues>) => {
    setForm((current) => {
      const next = current ?? baseForm;
      return { ...next, ...patch(next) };
    });
  };

  const editBaseline = editKey ? JSON.stringify(baseForm) : null;

  const isDrink =
    item.category_name === "Coffee" || item.category_name === "Non-Coffee";
  const sugarOptions = ["0%", "25%", "50%", "75%", "100%"];

  const activeVariants = groups
    .map(([type, variants]) =>
      variants.find((variant) => variant.id === selectedVariants[type])
    )
    .filter(Boolean) as MenuVariant[];

  const activeExtras = item.extras.filter((extra) =>
    selectedExtras.includes(extra.id)
  );

  const stockLimit = item.stock_tracking_enabled
    ? Math.max(0, item.stock_count)
    : null;
  const cartQuantityElsewhere = items
    .filter((entry) => entry.menuItemId === item.id && entry.key !== editKey)
    .reduce((sum, entry) => sum + entry.quantity, 0);
  const maxQuantity = remainingCustomerQuantity(stockLimit, cartQuantityElsewhere);
  const quantity = Math.min(requestedQuantity, Math.max(1, maxQuantity));
  const orderAllowance = remainingCustomerQuantity(null, cartQuantityElsewhere);
  const outOfStock = item.stock_status === "out";
  const allInCart = !outOfStock && maxQuantity <= 0;
  const soldOut = outOfStock || allInCart;
  const editHasChanges =
    !editKey ||
    JSON.stringify({
      selectedVariants,
      selectedExtras,
      sugarLevel,
      note,
      quantity,
    }) !== editBaseline;

  const unitPrice = priceWithVat(
    Number(item.price) +
    activeVariants.reduce((sum, variant) => sum + Number(variant.price_modifier), 0) +
    activeExtras.reduce((sum, extra) => sum + Number(extra.price_modifier), 0),
    vatRatePct
  );

  const toggleExtra = (extra: MenuExtra) => {
    updateForm((current) => ({
      selectedExtras: current.selectedExtras.includes(extra.id)
        ? current.selectedExtras.filter((id) => id !== extra.id)
        : [...current.selectedExtras, extra.id],
    }));
  };

  const addToOrder = () => {
    if (quantity > orderAllowance) {
      warn(item.id);
      return;
    }
    if (soldOut) {
      feedback.warning(
        outOfStock
          ? `${item.name} is sold out`
          : `All ${stockLimit} ${item.name} are in your cart`,
        {
          eyebrow: outOfStock ? "Sold out today" : "That's all we have",
          message: outOfStock
            ? "This one has run out. Ask our team about a similar drink or pastry, or pick something else from the menu."
            : "Lower the quantity in your cart if you need fewer, or finish checking out.",
        }
      );
      return;
    }
    if (stockLimit !== null && quantity > maxQuantity) {
      updateForm(() => ({ quantity: Math.max(1, maxQuantity) }));
      feedback.warning(`Only ${stockLimit} ${item.name} today`, {
        eyebrow: "That's all we have",
        message:
          cartQuantityElsewhere > 0
            ? `Your cart already has ${cartQuantityElsewhere}, so you can add ${maxQuantity} more.`
            : "Adjust the quantity to what we have left and try again.",
      });
      return;
    }
    const customizedItem = {
      menuItemId: item.id,
      name: item.name,
      category: item.category_name || "",
      basePrice: Number(item.price),
      variant: activeVariants.length
        ? {
            id: activeVariants[0].id,
            name: activeVariants.map((variant) => variant.name).join(" · "),
            priceModifier: activeVariants.reduce(
              (sum, variant) => sum + Number(variant.price_modifier),
              0
            ),
          }
        : null,
      variantIds: activeVariants.map((variant) => variant.id),
      extras: activeExtras.map((extra) => ({
        id: extra.id,
        name: extra.name,
        price_modifier: Number(extra.price_modifier),
      })),
      sugarLevel: isDrink ? sugarLevel : null,
      note: isDrink ? note.trim() || null : null,
      quantity,
      stockLimit,
    };
    if (editKey) {
      updateCartItem(editKey, customizedItem);
      feedback.success(item.name, {
        eyebrow: "Cart updated",
        message: "Your item options and quantity have been saved.",
        duration: 1500,
      });
      router.push(`/customer/cart?table=${initialTable}`);
      return;
    }
    addItem(customizedItem);
    feedback.success(item.name, {
      eyebrow: "In the bag",
      message: `${quantity} added${
        activeVariants.length
          ? ` · ${activeVariants.map((variant) => variant.name).join(", ")}`
          : ""
      }. Open your cart when you're ready to check out.`,
      duration: 1700,
      details: [
        { label: "Item", value: item.name },
        ...(activeVariants.length
          ? [
              {
                label: "Options",
                value: activeVariants.map((variant) => variant.name).join(", "),
              },
            ]
          : []),
        ...(activeExtras.length
          ? [
              {
                label: "Add-ons",
                value: activeExtras.map((extra) => extra.name).join(", "),
              },
            ]
          : []),
        { label: "Quantity", value: String(quantity) },
        { label: "Price", value: peso(unitPrice * quantity) },
      ],
    });
    router.push(`/customer/menu?table=${initialTable}`);
  };

  return (
    <div>
      <Link
        href={
          editKey
            ? `/customer/cart?table=${initialTable}`
            : `/customer/menu?table=${initialTable}`
        }
        className="back-link"
      >
        <Icon name="chevron-left" /> {editKey ? "Back to cart" : "Back to menu"}
      </Link>
      {editKey && editLoaded && editMissing ? (
        <div className="state-card">
          <h1>This cart item is no longer available.</h1>
          <p>Return to your cart and choose an item to edit.</p>
          <Link href={`/customer/cart?table=${initialTable}`} className="btn btn-primary">
            Return to cart <Icon name="arrow-right" className="icon-sm" />
          </Link>
        </div>
      ) : editKey && !editLoaded ? (
        <div className="item-layout" role="status" aria-busy="true" aria-label="Loading item options">
          <div
            className="item-visual customer-skeleton-item-visual skeleton"
            aria-hidden="true"
          />
          <section className="item-panel" aria-hidden="true">
            <SkeletonLine size="short" />
            <SkeletonLine size="heading" />
            <SkeletonLine size="long" />
            <SkeletonLine size="medium" />
            <div className="customer-skeleton-options">
              {[1, 2, 3].map((option) => (
                <SkeletonLine size="search" key={option} />
              ))}
            </div>
            <SkeletonLine size="button" />
          </section>
        </div>
      ) : (
      <div className="item-layout">
        <div className="item-visual">
          <span className="badge badge-dark item-visual-tag">
            {item.is_best_seller ? "Best seller" : item.category_name}
          </span>
          {item.image_url ? (
            <img
              className="item-product-image"
              src={item.image_url}
              alt={item.name}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <CoffeeArt kind={artKindForCategory(item.category_name, item.name)} />
          )}
        </div>

        <section className="item-panel">
          <span className="eyebrow">
            {item.category_name} · {orderType === "take_out" ? "Take out" : "Dine in"}
          </span>
          <h1 className="item-title">{item.name}</h1>
          <p className="item-desc">{item.description}</p>
          <div className="item-price-line">
            <strong key={unitPrice}>{peso(unitPrice)}</strong>
            <span>
              {vatRatePct > 0 ? `Includes ${vatRatePct}% VAT · made to order` : "Made to order"}
            </span>
          </div>

          {item.stock_status === "low" && (
            <div className="payment-note" style={{ marginTop: 0, marginBottom: 18 }}>
              <Icon name="clock" />
              <span>
                <strong>
                  {item.stock_tracking_enabled
                    ? `Only ${item.stock_count} left`
                    : item.stock_note || "Running low"}
                  .
                </strong>{" "}
                We recommend ordering soon.
              </span>
            </div>
          )}

          {item.stock_status === "out" && (
            <div className="payment-note" style={{ marginTop: 0, marginBottom: 18 }}>
              <Icon name="x" />
              <span>
                <strong>Sold out today.</strong> This one has run out — ask our
                team about something similar.
              </span>
            </div>
          )}

          {groups.map(([type, variants]) => (
            <div className="option-block" key={type}>
              <div className="option-head">
                <h3>{type}</h3>
                <span>Choose one</span>
              </div>
              <div className="option-pills">
                {variants.map((variant) => (
                  <label className="option-pill" key={variant.id}>
                    <input
                      type="radio"
                      name={type}
                      checked={selectedVariants[type] === variant.id}
                      onChange={() =>
                        updateForm((current) => ({
                          selectedVariants: {
                            ...current.selectedVariants,
                            [type]: variant.id,
                          },
                        }))
                      }
                    />
                    <span>
                      {variant.name}
                      {Number(variant.price_modifier) > 0 && (
                        <small>+{peso(priceWithVat(Number(variant.price_modifier), vatRatePct))}</small>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          {isDrink && (
            <div className="option-block">
              <div className="option-head">
                <h3>Sugar level</h3>
                <span>Choose one</span>
              </div>
              <div className="option-pills">
                {sugarOptions.map((level) => (
                  <label className="option-pill" key={level}>
                    <input
                      type="radio"
                      name="sugar-level"
                      checked={sugarLevel === level}
                      onChange={() => updateForm(() => ({ sugarLevel: level }))}
                    />
                    <span>{level}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {item.extras.length > 0 && (
            <div className="option-block">
              <div className="option-head">
                <h3>Add-ons</h3>
                <span>Optional</span>
              </div>
              <div className="extra-grid">
                {item.extras.map((extra) => (
                  <label className="extra-pill" key={extra.id}>
                    <input
                      type="checkbox"
                      checked={selectedExtras.includes(extra.id)}
                      onChange={() => toggleExtra(extra)}
                    />
                    <span>
                      {extra.name}
                      <em>+{peso(priceWithVat(Number(extra.price_modifier), vatRatePct))}</em>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {isDrink && (
            <div className="option-block item-note">
              <div className="option-head">
                <h3>A note for the barista</h3>
                <span>Optional</span>
              </div>
              <label className="label" htmlFor="item-note" style={{ display: "none" }}>
                Drink note
              </label>
              <textarea
                id="item-note"
                className="textarea"
                value={note}
                onChange={(event) => updateForm(() => ({ note: event.target.value }))}
                placeholder="Less ice, extra hot, no straw — anything we should know?"
                maxLength={180}
              />
            </div>
          )}

          <div className="item-submit">
            <div className="qty-control">
              <button
                type="button"
                onClick={() => updateForm(() => ({ quantity: Math.max(1, quantity - 1) }))}
                aria-label="Decrease quantity"
              >
                <Icon name="minus" size={13} />
              </button>
              <span>{quantity}</span>
              <button
                type="button"
                 onClick={() => {
                   if (quantity >= orderAllowance) warn(item.id);
                   else updateForm(() => ({ quantity: Math.min(quantity + 1, maxQuantity) }));
                 }}
                 disabled={outOfStock || (quantity >= maxQuantity && maxQuantity < orderAllowance)}
                aria-label="Increase quantity"
              >
                <Icon name="plus" size={13} />
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={addToOrder}
              disabled={
                 Boolean(editKey && (!editLoaded || !editHasChanges)) ||
                 outOfStock || (allInCart && orderAllowance > 0)
              }
            >
              {outOfStock
                ? "Sold out today"
                 : allInCart && orderAllowance > 0
                   ? "All left in your cart"
                  : editKey
                    ? "Save changes"
                    : "Add to cart"}
              {!soldOut && <span>{peso(unitPrice * quantity)}</span>}
            </button>
          </div>
          <div className="quantity-limit-warning" role="status">
            {warningKey === item.id ? CUSTOMER_ITEM_LIMIT_MESSAGE : ""}
          </div>
        </section>
      </div>
      )}
    </div>
  );
}
