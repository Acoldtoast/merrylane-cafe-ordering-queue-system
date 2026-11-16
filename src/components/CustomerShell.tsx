"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "./Brand";
import { SocialMediaIcons } from "./SocialMediaIcons";
import { Icon } from "./Icons";
import { useCustomer } from "./CustomerProvider";
import { useIdleRoutePrefetch } from "@/lib/useIdleRoutePrefetch";
import {
  fetchPortalApi,
  prefetchPortalRouteData,
} from "@/lib/portalPrefetch";
import { preloadPortalRouteCode } from "@/lib/preloadPortalRouteCode";
import { usePolling } from "@/lib/usePolling";
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
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>({});
  const [socialEnabled, setSocialEnabled] = useState(true);
  const refreshSocialSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/public/cafe-settings", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Cafe settings request failed (${response.status}).`);
      }
      const data = await response.json();
      setSocialLinks({
        facebook_url: data.facebook_url || "",
        twitter_url: data.twitter_url || "",
        tiktok_url: data.tiktok_url || "",
        instagram_url: data.instagram_url || "",
      });
      setSocialEnabled(Boolean(data.social_media_enabled));
    } catch (error) {
      console.error("Could not refresh cafe social links.", error);
    }
  }, []);
  const statusHref = "/customer/orders";
  const prefetchPaths = useMemo(
    () => [
      `/customer/welcome?table=${table}`,
      `/customer/menu?table=${table}`,
      statusHref,
      `/customer/status?table=${table}`,
      `/customer/payment?table=${table}`,
      `/customer/confirm?table=${table}`,
      `/customer/waiter?table=${table}`,
      "/customer/hours",
      `/customer/cart?table=${table}`,
      "/customer/feedback",
      "/customer/thanks",
    ],
    [table]
  );
  const prefetchPathsKey = prefetchPaths.join("\n");
  useIdleRoutePrefetch(prefetchPaths, true, true);
  usePolling(refreshSocialSettings, 30_000, { resources: ["settings"] });
  const warmCustomerRoute = (href: string) => {
    router.prefetch(href);
    void preloadPortalRouteCode("customer", href);
    prefetchPortalRouteData("customer", href);
  };

  useEffect(() => {
    const network = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (
      network?.saveData ||
      network?.effectiveType === "slow-2g" ||
      network?.effectiveType === "2g"
    ) {
      return;
    }

    let disposed = false;
    const prefetch = () => {
      if (disposed || document.visibilityState !== "visible") return;
      const currentPath = pathname;
      for (const href of prefetchPathsKey.split("\n").filter(Boolean)) {
        if (new URL(href, window.location.origin).pathname === currentPath) continue;
        void preloadPortalRouteCode("customer", href);
        prefetchPortalRouteData("customer", href);
      }
      if (pathname.startsWith("/customer/status")) {
        const params = new URLSearchParams(window.location.search);
        const orderId = Number(params.get("id")) || 0;
        if (orderId > 0) {
          prefetchPortalRouteData(
            "customer",
            `/customer/payment?id=${orderId}&table=${table}`
          );
        }
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") prefetch();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    onVisibilityChange();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pathname, prefetchPathsKey, table]);

  useEffect(() => {
    let active = true;
    let checking = false;

    const checkLastOrderWarning = async () => {
      if (checking) return;
      checking = true;
      try {
        const response = await fetchPortalApi("/api/settings", { cache: "no-store" });
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
          <div className="customer-brand-block">
            <Brand href={`/customer/menu?table=${table}`} />
            <SocialMediaIcons links={socialLinks} enabled={socialEnabled} />
          </div>
          <nav className="customer-nav" aria-label="Customer navigation">
            <Link
              href={`/customer/menu?table=${table}`}
              className={isMenu ? "active" : ""}
              onMouseEnter={() => warmCustomerRoute(`/customer/menu?table=${table}`)}
              onFocus={() => warmCustomerRoute(`/customer/menu?table=${table}`)}
            >
              Menu
            </Link>
            <Link
              href={statusHref}
              className={isOrder ? "active" : ""}
              onMouseEnter={() => warmCustomerRoute(statusHref)}
              onFocus={() => warmCustomerRoute(statusHref)}
            >
              Your orders
            </Link>
            <Link
              href={`/customer/waiter?table=${table}`}
              className={isWaiter ? "active" : ""}
              onMouseEnter={() => warmCustomerRoute(`/customer/waiter?table=${table}`)}
              onFocus={() => warmCustomerRoute(`/customer/waiter?table=${table}`)}
            >
              Call waiter
            </Link>
            <Link
              href="/customer/hours"
              className={isHours ? "active" : ""}
              onMouseEnter={() => warmCustomerRoute("/customer/hours")}
              onFocus={() => warmCustomerRoute("/customer/hours")}
            >
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
              onMouseEnter={() => warmCustomerRoute(`/customer/cart?table=${table}`)}
              onFocus={() => warmCustomerRoute(`/customer/cart?table=${table}`)}
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
                onMouseEnter={() => warmCustomerRoute(`/customer/menu?table=${table}`)}
                onFocus={() => warmCustomerRoute(`/customer/menu?table=${table}`)}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="coffee" />
                <span>Menu</span>
                <Icon name="chevron-right" className="customer-menu-arrow" />
              </Link>
              <Link
                href={statusHref}
                className={isOrder ? "active" : ""}
                onMouseEnter={() => warmCustomerRoute(statusHref)}
                onFocus={() => warmCustomerRoute(statusHref)}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="receipt" />
                <span>Your orders</span>
                <Icon name="chevron-right" className="customer-menu-arrow" />
              </Link>
              <Link
                href={`/customer/waiter?table=${table}`}
                className={isWaiter ? "active" : ""}
                onMouseEnter={() => warmCustomerRoute(`/customer/waiter?table=${table}`)}
                onFocus={() => warmCustomerRoute(`/customer/waiter?table=${table}`)}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="waiter" />
                <span>Call waiter</span>
                <Icon name="chevron-right" className="customer-menu-arrow" />
              </Link>
              <Link
                href="/customer/hours"
                className={isHours ? "active" : ""}
                onMouseEnter={() => warmCustomerRoute("/customer/hours")}
                onFocus={() => warmCustomerRoute("/customer/hours")}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="clock" />
                <span>View hours</span>
                <Icon name="chevron-right" className="customer-menu-arrow" />
              </Link>
              <Link
                href={`/customer/cart?table=${table}`}
                onMouseEnter={() => warmCustomerRoute(`/customer/cart?table=${table}`)}
                onFocus={() => warmCustomerRoute(`/customer/cart?table=${table}`)}
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
