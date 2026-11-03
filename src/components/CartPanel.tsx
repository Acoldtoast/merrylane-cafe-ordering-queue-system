"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CoffeeArt, artKindForCategory } from "./CoffeeArt";
import { Icon } from "./Icons";
import { useCustomer } from "./CustomerProvider";
import { peso } from "@/lib/format";

export function CartPanel({
  variant = "rail",
  showContinue = true,
}: {
  variant?: "rail" | "page";
  showContinue?: boolean;
}) {
  const router = useRouter();
  const {
    items,
    count,
    subtotal,
    setQuantity,
    removeItem,
    table,
  } = useCustomer();

  return (
    <aside className={`cart-rail ${variant === "page" ? "cart-rail-page" : ""}`}>
      <div className="cart-panel">
        <div className="cart-panel-head">
          <h2>Your order</h2>
          <span className="badge badge-cream">
            {count === 0 ? "Empty" : `${count} item${count === 1 ? "" : "s"}`}
          </span>
        </div>

        <div className="cart-panel-body">
          {items.length === 0 ? (
            <div className="cart-empty">
              <div className="cart-empty-icon">
                <Icon name="bag" size={20} />
              </div>
              <h3>Nothing here yet</h3>
              <p>
                Your favourites are a tap away. Add something cozy from the menu.
              </p>
            </div>
          ) : (
            <>
              {items.map((item) => (
                <div className="cart-line" key={item.key}>
                  <div className="cart-line-art">
                    <CoffeeArt kind={artKindForCategory(item.category, item.name)} />
                  </div>
                  <div className="cart-line-body">
                    <div className="cart-line-top">
                      <div>
                        <div className="cart-line-name">{item.name}</div>
                        <div className="cart-line-meta">
                          {[
                            item.variant?.name,
                            item.sugarLevel ? `Sugar ${item.sugarLevel}` : null,
                            ...item.extras.map((e) => e.name),
                            item.note ? `Note: ${item.note}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Prepared just for you"}
                        </div>
                      </div>
                      <div className="cart-line-price-actions">
                        <div className="cart-line-price">
                          {peso(item.unitPrice * item.quantity)}
                        </div>
                        <button
                          type="button"
                          className="cart-line-icon-action cart-line-remove"
                          aria-label={`Remove ${item.name} from order`}
                          title="Remove item"
                          onClick={() => removeItem(item.key)}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </div>
                    </div>
                    <Link
                      href={`/customer/item/${item.menuItemId}?table=${table}&edit=${encodeURIComponent(item.key)}`}
                      className="summary-item-edit cart-line-edit"
                    >
                      <Icon name="edit" size={12} /> Edit options
                    </Link>
                    <div className="cart-line-actions">
                      <div className="qty-control">
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          onClick={() => setQuantity(item.key, item.quantity - 1)}
                        >
                          <Icon name="minus" size={11} />
                        </button>
                        <span>{item.quantity}</span>
                        <button
                          type="button"
                          aria-label="Increase quantity"
                          disabled={
                            item.stockLimit !== null &&
                            item.stockLimit !== undefined &&
                            item.quantity >= item.stockLimit
                          }
                          onClick={() => setQuantity(item.key, item.quantity + 1)}
                        >
                          <Icon name="plus" size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <div className="cart-totals">
                <div className="totals-row">
                  <span>Subtotal</span>
                  <span className="price">{peso(subtotal)}</span>
                </div>
                <div className="totals-row">
                  <span>Service charge</span>
                  <span>Included</span>
                </div>
                <div className="totals-row total">
                  <span>Total</span>
                  <span className="price">{peso(subtotal)}</span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="cart-panel-foot">
          {items.length > 0 && showContinue ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => router.push(`/customer/cart?table=${table}`)}
              >
                Continue <Icon name="arrow-right" className="icon-sm" />
              </button>
              <div className="cart-panel-note">
                <Icon name="info" />
                <span>
                  You can review your order, add a note, and choose a payment
                  method before sending it to the counter.
                </span>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

export function MobileCartBar() {
  const { count, subtotal, table } = useCustomer();
  if (count === 0) return null;
  return (
    <div className="mobile-cart-bar">
      <Link href={`/customer/cart?table=${table}`} className="btn btn-primary">
        <span className="mobile-cart-count">
          <Icon name="bag" className="icon-sm" />
          View order <b>{count}</b>
        </span>
        <span>{peso(subtotal)}</span>
      </Link>
    </div>
  );
}
