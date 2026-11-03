"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CoffeeArt, artKindForCategory } from "@/components/CoffeeArt";
import { Icon } from "@/components/Icons";
import { useFeedback } from "@/components/Feedback";
import { useCustomer } from "@/components/CustomerProvider";
import type { MenuExtra, MenuItem, MenuVariant } from "@/lib/types";
import { peso } from "@/lib/format";

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
  const { setTable, addItem, updateCartItem, items, ready, orderType } = useCustomer();

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

  const [selectedVariants, setSelectedVariants] = useState<Record<string, number>>(
    () => {
      const initial: Record<string, number> = {};
      for (const [type, variants] of groups) {
        if (variants[0]) initial[type] = variants[0].id;
      }
      return initial;
    }
  );
  const [selectedExtras, setSelectedExtras] = useState<number[]>([]);
  const [sugarLevel, setSugarLevel] = useState("50%");
  const [note, setNote] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [editLoaded, setEditLoaded] = useState(!editKey);
  const [editMissing, setEditMissing] = useState(false);

  useEffect(() => {
    if (!editKey || !ready) return;
    const cartItem = items.find((entry) => entry.key === editKey);
    if (!cartItem || cartItem.menuItemId !== item.id) {
      setEditMissing(true);
      setEditLoaded(true);
      return;
    }
    const selected: Record<string, number> = {};
    for (const [type, variants] of groups) {
      const selectedVariant = variants.find((variant) =>
        (cartItem.variantIds || [cartItem.variant?.id || 0]).includes(variant.id)
      );
      if (selectedVariant) selected[type] = selectedVariant.id;
    }
    setSelectedVariants(selected);
    setSelectedExtras(cartItem.extras.map((extra) => extra.id));
    setSugarLevel(cartItem.sugarLevel || "50%");
    setNote(cartItem.note || "");
    setQuantity(cartItem.quantity);
    setEditMissing(false);
    setEditLoaded(true);
  }, [editKey, groups, item.id, items, ready]);

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
  const maxQuantity =
    stockLimit === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, stockLimit - cartQuantityElsewhere);
  const outOfStock = item.stock_status === "out";
  const allInCart = !outOfStock && Number.isFinite(maxQuantity) && maxQuantity <= 0;
  const soldOut = outOfStock || allInCart;

  useEffect(() => {
    if (maxQuantity === Number.POSITIVE_INFINITY) return;
    setQuantity((current) => Math.min(current, Math.max(1, maxQuantity)));
  }, [maxQuantity]);

  const unitPrice =
    Number(item.price) +
    activeVariants.reduce((sum, variant) => sum + Number(variant.price_modifier), 0) +
    activeExtras.reduce((sum, extra) => sum + Number(extra.price_modifier), 0);

  const toggleExtra = (extra: MenuExtra) => {
    setSelectedExtras((current) =>
      current.includes(extra.id)
        ? current.filter((id) => id !== extra.id)
        : [...current, extra.id]
    );
  };

  const addToOrder = () => {
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
      setQuantity(Math.max(1, maxQuantity));
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
        <div className="loading-block">
          <span className="spinner" /> Loading your item options…
        </div>
      ) : (
      <div className="item-layout">
        <div className="item-visual">
          <span className="badge badge-dark item-visual-tag">
            {item.is_best_seller ? "Best seller" : item.category_name}
          </span>
          <CoffeeArt kind={artKindForCategory(item.category_name, item.name)} />
        </div>

        <section className="item-panel">
          <span className="eyebrow">
            {item.category_name} · {orderType === "take_out" ? "Take out" : "Dine in"}
          </span>
          <h1 className="item-title">{item.name}</h1>
          <p className="item-desc">{item.description}</p>
          <div className="item-price-line">
            <strong key={unitPrice}>{peso(unitPrice)}</strong>
            <span>VAT inclusive · made to order</span>
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
                        setSelectedVariants((current) => ({
                          ...current,
                          [type]: variant.id,
                        }))
                      }
                    />
                    <span>
                      {variant.name}
                      {Number(variant.price_modifier) > 0 && (
                        <small>+{peso(variant.price_modifier)}</small>
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
                      onChange={() => setSugarLevel(level)}
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
                      <em>+{peso(extra.price_modifier)}</em>
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
                onChange={(event) => setNote(event.target.value)}
                placeholder="Less ice, extra hot, no straw — anything we should know?"
                maxLength={180}
              />
            </div>
          )}

          <div className="item-submit">
            <div className="qty-control">
              <button
                type="button"
                onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                aria-label="Decrease quantity"
              >
                <Icon name="minus" size={13} />
              </button>
              <span>{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity((current) => current + 1)}
                disabled={quantity >= maxQuantity}
                aria-label="Increase quantity"
              >
                <Icon name="plus" size={13} />
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={addToOrder}
              disabled={Boolean(editKey && !editLoaded) || soldOut}
            >
              {outOfStock
                ? "Sold out today"
                : allInCart
                  ? "All left in your cart"
                  : editKey
                    ? "Save changes"
                    : "Add to cart"}
              {!soldOut && <span>{peso(unitPrice * quantity)}</span>}
            </button>
          </div>
        </section>
      </div>
      )}
    </div>
  );
}
