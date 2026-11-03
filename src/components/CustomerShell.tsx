"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "./Brand";
import { Icon } from "./Icons";
import { useCustomer } from "./CustomerProvider";
import { useIdleRoutePrefetch } from "@/lib/useIdleRoutePrefetch";
import { useFeedback } from "./Feedback";

const LAST_ORDER_WARNING_ACKNOWLEDGED_KEY =
  "merrylane.last-order-warning-acknowledged";

function manilaDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find(
    (part) => part.type === "month"
  )?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

export function CustomerShell({
  children,
  initialOrderingOpen,
}: {
  children: React.ReactNode;
  initialOrderingOpen: boolean | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { table, count } = useCustomer();
  const feedback = useFeedback();
  const warnedTodayRef = useRef<string | null>(null);
  const orderingOpenRef = useRef(initialOrderingOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const statusHref = "/customer/orders";
  const prefetchPaths = useMemo(
    () => [
      `/customer/menu?table=${table}`,
      statusHref,
      `/customer/waiter?table=${table}`,
    ],
    [table]
  );
  useIdleRoutePrefetch(prefetchPaths);

  useEffect(() => {
    let active = true;
    let checking = false;

    const checkLastOrderWarning = async () => {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to check ordering hours.");
        }
        if (!active) return;
        const orderingOpen = Boolean(data.ordering_open);
        if (
          orderingOpenRef.current !== null &&
          orderingOpenRef.current !== orderingOpen
        ) {
          router.refresh();
        }
        orderingOpenRef.current = orderingOpen;
        if (!data.last_order_warning) return;

        const today = manilaDateKey(new Date());
        if (warnedTodayRef.current === today) return;
        try {
          if (
            localStorage.getItem(LAST_ORDER_WARNING_ACKNOWLEDGED_KEY) === today
          ) {
            warnedTodayRef.current = today;
            return;
          }
        } catch {
          console.warn("Could not check the last-order warning acknowledgement.");
        }
        warnedTodayRef.current = today;
        feedback.warning("Last call for today", {
          eyebrow: "Ordering closes soon",
          message:
            "There are 30 minutes or less left to place an order. Please finish your order before ordering closes.",
          duration: 0,
          onDismiss: () => {
            try {
              localStorage.setItem(
                LAST_ORDER_WARNING_ACKNOWLEDGED_KEY,
                today
              );
            } catch {
              console.warn(
                "Could not save the last-order warning acknowledgement."
              );
            }
          },
        });
      } catch (error) {
        console.error("Could not check the last-order warning.", error);
      } finally {
        checking = false;
      }
    };

    void checkLastOrderWarning();
    const timer = window.setInterval(() => {
      void checkLastOrderWarning();
    }, 30_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkLastOrderWarning();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [feedback, router]);

  const isMenu = pathname.startsWith("/customer/menu") || pathname.includes("/customer/item");
  const isOrder =
    pathname.startsWith("/customer/status") ||
    pathname.startsWith("/customer/orders") ||
    pathname.startsWith("/customer/payment") ||
    pathname.startsWith("/customer/cart") ||
    pathname.startsWith("/customer/confirm");
  const isWaiter = pathname.startsWith("/customer/waiter");
  const isHours = pathname.startsWith("/customer/hours");

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("customer-menu-open");
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.classList.remove("customer-menu-open");
    };
  }, [menuOpen]);

  return (
    <div className="customer-app">
      <header className="customer-topbar">
        <div className="customer-topbar-inner">
          <Brand href={`/customer/menu?table=${table}`} />
          <nav className="customer-nav" aria-label="Customer navigation">
            <Link
              href={`/customer/menu?table=${table}`}
              className={isMenu ? "active" : ""}
            >
              Menu
            </Link>
            <Link href={statusHref} className={isOrder ? "active" : ""}>
              Your orders
            </Link>
            <Link
              href={`/customer/waiter?table=${table}`}
              className={isWaiter ? "active" : ""}
            >
              Call waiter
            </Link>
            <Link href="/customer/hours" className={isHours ? "active" : ""}>
              View hours
            </Link>
          </nav>
          <div className="customer-top-actions">
            <span className="table-pill">
              <Icon name="table" /> Table {String(table).padStart(2, "0")}
            </span>
            <Link
              href={`/customer/cart?table=${table}`}
              className="cart-icon-button"
              aria-label={`View cart, ${count} items`}
            >
              <Icon name="bag" />
              {count > 0 && <span className="cart-icon-count">{count}</span>}
            </Link>
            <button
              type="button"
              className="customer-menu-toggle"
              aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={menuOpen}
              aria-controls="customer-mobile-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name={menuOpen ? "x" : "menu"} />
            </button>
          </div>
        </div>
      </header>
      {menuOpen && (
        <div className="customer-menu-layer">
          <button
            type="button"
            className="customer-menu-backdrop"
            aria-label="Close navigation menu"
            onClick={() => setMenuOpen(false)}
          />
          <aside
            id="customer-mobile-menu"
            className="customer-menu-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Customer navigation"
          >
            <div className="customer-menu-drawer-head">
              <div>
                <span className="eyebrow">Merrylane Cafe</span>
                <strong>Where to next?</strong>
              </div>
              <button
                type="button"
                className="customer-menu-close"
                aria-label="Close navigation menu"
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="x" />
              </button>
            </div>
            <nav className="customer-menu-links" aria-label="Customer navigation">
              <Link
                href={`/customer/menu?table=${table}`}
                className={isMenu ? "active" : ""}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="coffee" />
                <span>Menu</span>
                <Icon name="chevron-right" className="customer-menu-arrow" />
              </Link>
              <Link
                href={statusHref}
                className={isOrder ? "active" : ""}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="receipt" />
                <span>Your orders</span>
                <Icon name="chevron-right" className="customer-menu-arrow" />
              </Link>
              <Link
                href={`/customer/waiter?table=${table}`}
                className={isWaiter ? "active" : ""}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="waiter" />
                <span>Call waiter</span>
                <Icon name="chevron-right" className="customer-menu-arrow" />
              </Link>
              <Link
                href="/customer/hours"
                className={isHours ? "active" : ""}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="clock" />
                <span>View hours</span>
                <Icon name="chevron-right" className="customer-menu-arrow" />
              </Link>
              <Link
                href={`/customer/cart?table=${table}`}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="bag" />
                <span>Your cart{count ? ` · ${count} items` : ""}</span>
                <Icon name="chevron-right" className="customer-menu-arrow" />
              </Link>
            </nav>
            <div className="customer-menu-table">
              <Icon name="table" />
              Ordering for table {String(table).padStart(2, "0")}
            </div>
          </aside>
        </div>
      )}
      <main className="customer-main">{children}</main>
      <footer className="customer-footer">
        <div className="customer-footer-inner">
          <span>
            Merrylane Cafe · Lipa City, Batangas · Ordering with care since 2021
          </span>
          <span>
            Need a hand? <Link href={`/customer/waiter?table=${table}`}>Call a waiter</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
