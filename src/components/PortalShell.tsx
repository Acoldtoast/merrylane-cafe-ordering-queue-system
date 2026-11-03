"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { Brand } from "./Brand";
import { Icon, type IconName } from "./Icons";
import { LoadingDots } from "./LoadingDots";
import { useIdleRoutePrefetch } from "@/lib/useIdleRoutePrefetch";
import { usePolling } from "@/lib/usePolling";

interface PortalNotification {
  id: string;
  kind: "payment" | "preparing" | "stock" | "review" | "waiter";
  title: string;
  message: string;
  href: string;
  read: boolean;
}

/** Which sidebar link a notification belongs to, so its badge can clear when seen. */
function notificationPageKey(notification: PortalNotification): string | null {
  const base = notification.href.split("?")[0].split("#")[0];
  if (base === "/staff/payments") return "/staff/payments";
  if (base === "/staff/requests") return "/staff/requests";
  if (base === "/staff") return "/staff";
  return null;
}

export interface PortalNavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
}

interface PortalShellProps {
  area: "staff" | "admin";
  className?: string;
  title: string;
  subtitle: string;
  contextLabel: string;
  contextTitle: string;
  nav: PortalNavItem[];
  children: React.ReactNode;
}

export function PortalShell({
  area,
  className,
  title,
  subtitle,
  contextLabel,
  contextTitle,
  nav,
  children,
}: PortalShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setOpen(false);
  }
  const [user, setUser] = useState<{ name: string; email: string; role: string } | null>(
    null
  );
  const [sessionReady, setSessionReady] = useState(false);
  const [clock, setClock] = useState("");
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [staffLocked, setStaffLocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [notificationError, setNotificationError] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [markingNotificationId, setMarkingNotificationId] = useState<string | null>(null);
  const cancelLogoutRef = useRef<HTMLButtonElement>(null);
  const staffLockedRef = useRef(false);
  const unlockPasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/auth/verify?area=${area}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.authenticated) {
          throw new Error(data.error || "Your session has ended. Please sign in again.");
        }
        if (!active) return;
        const sessionUser = data.user as { name: string; email: string; role: string };
        const lastActivityKey = `merrylane:${area}:last-activity:${sessionUser.email}`;
        const lastActivity = Number(localStorage.getItem(lastActivityKey));
        const idleLimit = area === "admin" ? 5 * 60 * 1000 : 15 * 60 * 1000;
        if (lastActivity && Date.now() - lastActivity >= idleLimit) {
          if (area === "admin") {
            await fetch("/api/auth/login?area=admin", { method: "DELETE" });
            router.replace("/login?next=/admin");
            return;
          }
          const rememberKey = `merrylane:staff:remember:${sessionUser.email}`;
          if (localStorage.getItem(rememberKey) !== "true") {
            localStorage.removeItem(rememberKey);
            localStorage.removeItem(lastActivityKey);
            await fetch("/api/auth/login?area=staff", { method: "DELETE" });
            router.replace("/login?next=/staff");
            return;
          }
          staffLockedRef.current = true;
          setStaffLocked(true);
        }
        setUser(sessionUser);
        setSessionReady(true);
      })
      .catch(() => {
        if (active) router.replace(`/login?next=/${area}`);
      });
    return () => {
      active = false;
    };
  }, [area, router]);

  useEffect(() => {
    if (!user || user.role !== area) return;

    const idleLimit = area === "admin" ? 5 * 60 * 1000 : 15 * 60 * 1000;
    const activityKey = `merrylane:${area}:last-activity:${user.email}`;
    const rememberKey = `merrylane:staff:remember:${user.email}`;
    let idleTimer = 0;
    let lastHeartbeatAt = 0;
    let heartbeatInFlight = false;

    const lockStaff = () => {
      staffLockedRef.current = true;
      setStaffLocked(true);
      setUnlockPassword("");
      setUnlockError("");
    };

    const signOutAdmin = () => {
      localStorage.removeItem(activityKey);
      void fetch("/api/auth/login?area=admin", { method: "DELETE" })
        .finally(() => router.replace("/login?next=/admin"));
    };

    const signOutStaff = () => {
      localStorage.removeItem(rememberKey);
      localStorage.removeItem(activityKey);
      void fetch("/api/auth/login?area=staff", { method: "DELETE" })
        .finally(() => router.replace("/login?next=/staff"));
    };

    const handleStaffIdle = () => {
      if (localStorage.getItem(rememberKey) === "true") lockStaff();
      else signOutStaff();
    };

    const expireIfIdle = () => {
      const lastActivity = Number(localStorage.getItem(activityKey)) || Date.now();
      const remaining = idleLimit - (Date.now() - lastActivity);
      if (remaining <= 0) {
        if (area === "admin") signOutAdmin();
        else handleStaffIdle();
        return;
      }
      idleTimer = window.setTimeout(expireIfIdle, remaining);
    };

    const refreshAdminSession = async () => {
      if (
        area !== "admin" ||
        heartbeatInFlight ||
        Date.now() - lastHeartbeatAt < 60_000
      ) {
        return;
      }
      heartbeatInFlight = true;
      lastHeartbeatAt = Date.now();
      try {
        const response = await fetch("/api/auth/heartbeat", {
          method: "POST",
          cache: "no-store",
        });
        if (response.status === 401 || response.status === 403) {
          signOutAdmin();
        } else if (!response.ok) {
          lastHeartbeatAt = 0;
        }
      } catch {
        lastHeartbeatAt = 0;
      } finally {
        heartbeatInFlight = false;
      }
    };

    const markActivity = () => {
      if (document.visibilityState === "hidden" || staffLockedRef.current) return;
      const now = Date.now();
      localStorage.setItem(activityKey, String(now));
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(expireIfIdle, idleLimit);
      void refreshAdminSession();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") expireIfIdle();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== activityKey || staffLockedRef.current) return;
      window.clearTimeout(idleTimer);
      expireIfIdle();
    };

    const storedActivity = Number(localStorage.getItem(activityKey));
    if (storedActivity && Date.now() - storedActivity >= idleLimit) {
      if (area === "admin") {
        signOutAdmin();
        return;
      }
      handleStaffIdle();
    } else {
      if (!storedActivity) localStorage.setItem(activityKey, String(Date.now()));
      expireIfIdle();
      void refreshAdminSession();
    }

    window.addEventListener("pointerdown", markActivity, { passive: true });
    window.addEventListener("keydown", markActivity);
    window.addEventListener("touchstart", markActivity, { passive: true });
    window.addEventListener("scroll", markActivity, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.clearTimeout(idleTimer);
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("touchstart", markActivity);
      window.removeEventListener("scroll", markActivity);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("storage", handleStorage);
    };
  }, [area, router, staffLocked, user]);

  useEffect(() => {
    staffLockedRef.current = staffLocked;
    if (staffLocked) unlockPasswordRef.current?.focus();
  }, [staffLocked]);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-PH", {
          hour: "numeric",
          minute: "2-digit",
        })
      );
    tick();
    const timer = window.setInterval(tick, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/staff/notifications", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not refresh alerts.");
      }
      setNotifications(data.notifications || []);
      setNotificationError("");
    } catch {
      setNotificationError("Alerts could not be refreshed.");
    }
  }, []);

  usePolling(refreshNotifications, area === "staff" ? 15000 : 30000);

  const markNotificationsSeen = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const unique = Array.from(new Set(ids));
    setNotifications((current) =>
      current.map((item) =>
        unique.includes(item.id) ? { ...item, read: true } : item
      )
    );
    try {
      const response = await fetch("/api/staff/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: unique }),
      });
      if (!response.ok) throw new Error("Could not save seen alerts.");
      setNotificationError("");
    } catch {
      // The next poll reconciles this if the write did not land.
    }
  }, []);

  // Alerts for the page the user is already looking at count as seen, so the
  // sidebar badges clear once the work has been viewed.
  useEffect(() => {
    if (area !== "staff") return;
    const pageKey =
      pathname === "/staff"
        ? "/staff"
        : pathname.startsWith("/staff/payments")
          ? "/staff/payments"
          : pathname.startsWith("/staff/requests")
            ? "/staff/requests"
            : null;
    if (!pageKey) return;
    const unseen = notifications
      .filter(
        (notification) =>
          !notification.read && notificationPageKey(notification) === pageKey
      )
      .map((notification) => notification.id);
    if (unseen.length === 0) return;
    const timer = window.setTimeout(() => {
      void markNotificationsSeen(unseen);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [area, pathname, notifications, markNotificationsSeen]);

  const unreadNotificationCount = notifications.filter(
    (notification) => !notification.read
  ).length;

  const badgeCounts: Record<string, number> = {};
  if (area === "staff") {
    for (const notification of notifications) {
      if (notification.read) continue;
      if (notification.id.startsWith("unpaid-cancelled-")) continue;
      const pageKey = notificationPageKey(notification);
      if (!pageKey) continue;
      if (pageKey === "/staff" && notification.kind !== "preparing") continue;
      if (pageKey === "/staff/payments" && notification.kind !== "payment") continue;
      if (pageKey === "/staff/requests" && notification.kind !== "waiter") continue;
      badgeCounts[pageKey] = (badgeCounts[pageKey] || 0) + 1;
    }
  }
  const navWithBadges = nav.map((item) =>
    badgeCounts[item.href]
      ? { ...item, badge: badgeCounts[item.href] }
      : item
  );

  const openNotification = async (
    event: MouseEvent<HTMLAnchorElement>,
    notification: PortalNotification
  ) => {
    event.preventDefault();
    if (markingNotificationId) return;
    setMarkingNotificationId(notification.id);
    try {
      if (!notification.read) {
        const response = await fetch("/api/staff/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: notification.id }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not mark this alert as seen.");
        }
        setNotifications((current) =>
          current.map((item) =>
            item.id === notification.id ? { ...item, read: true } : item
          )
        );
      }
      setNotificationError("");
      setNotificationsOpen(false);
      if (
        area === "staff" &&
        notification.href.startsWith("/staff/payments?tab=verified") &&
        pathname === "/staff/payments"
      ) {
        const url = new URL(notification.href, window.location.origin);
        window.dispatchEvent(
          new CustomEvent("staff-payment-history", {
            detail: { date: url.searchParams.get("date") || "" },
          })
        );
      }
      router.push(notification.href);
    } catch (error) {
      setNotificationError(
        error instanceof Error ? error.message : "Could not mark this alert as seen."
      );
    } finally {
      setMarkingNotificationId(null);
    }
  };

  useEffect(() => {
    if (!notificationsOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [notificationsOpen]);

  useEffect(() => {
    if (!logoutConfirmOpen) return;
    cancelLogoutRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loggingOut) {
        setLogoutConfirmOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [logoutConfirmOpen, loggingOut]);

  const logout = async () => {
    setLoggingOut(true);
    setLogoutError("");
    try {
      const response = await fetch(`/api/auth/login?area=${area}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Could not sign out. Please try again.");
      }
      localStorage.removeItem(`merrylane:${area}:last-activity:${user?.email}`);
      if (area === "staff" && user?.email) {
        localStorage.removeItem(`merrylane:staff:remember:${user.email}`);
      }
      router.push(`/login?next=/${area}`);
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : "Could not sign out. Please try again."
      );
    } finally {
      setLoggingOut(false);
    }
  };

  const unlockStaffSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!unlockPassword) {
      setUnlockError("Enter your password to continue.");
      return;
    }

    setUnlocking(true);
    setUnlockError("");
    try {
      const response = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: unlockPassword }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not unlock this staff session.");
      }

      localStorage.setItem(
        `merrylane:staff:last-activity:${user?.email}`,
        String(Date.now())
      );
      staffLockedRef.current = false;
      setStaffLocked(false);
      setUnlockPassword("");
    } catch (error: unknown) {
      setUnlockError(
        error instanceof Error ? error.message : "Could not unlock this staff session."
      );
    } finally {
      setUnlocking(false);
    }
  };

  const switchStaffAccount = async () => {
    setUnlocking(true);
    setUnlockError("");
    try {
      const response = await fetch("/api/auth/login?area=staff", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Could not switch accounts. Please try again.");
      if (user?.email) {
        localStorage.removeItem(`merrylane:staff:remember:${user.email}`);
        localStorage.removeItem(`merrylane:staff:last-activity:${user.email}`);
      }
      router.replace("/login?next=/staff");
    } catch (error: unknown) {
      setUnlockError(
        error instanceof Error ? error.message : "Could not switch accounts. Please try again."
      );
    } finally {
      setUnlocking(false);
    }
  };

  const initials = (user?.name || "Merrylane Staff")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const canPrefetchPortalRoutes = Boolean(user && user.role === area);
  const prefetchPaths = canPrefetchPortalRoutes
    ? navWithBadges.map((item) => item.href)
    : [];
  useIdleRoutePrefetch(prefetchPaths, canPrefetchPortalRoutes);

  if (!sessionReady) return null;

  return (
    <div className="portal">
      {open && <div className="portal-scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${area === "admin" ? "admin-sidebar" : ""} ${open ? "open" : ""}`}>
        <div className="sidebar-brand">
          <Brand href={area === "admin" ? "/admin" : "/staff"} onDark />
        </div>

        <nav className="sidebar-nav" aria-label={`${area} navigation`}>
          <div className="sidebar-label">{area === "admin" ? "Insights" : "Service"}</div>
          {navWithBadges.map((item) => {
            const active =
              item.href === (area === "admin" ? "/admin" : "/staff")
                ? pathname === item.href
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${active ? "active" : ""}`}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.badge ? <span className="nav-count">{item.badge}</span> : null}
              </Link>
            );
          })}

          <div className="sidebar-label">Quick links</div>
          <Link href="/" className="sidebar-link">
            <Icon name="home" />
            <span>Cafe home</span>
          </Link>
          <Link href="/customer/welcome?table=7" className="sidebar-link">
            <Icon name="qr" />
            <span>Customer view</span>
          </Link>
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-profile">
            <span className="avatar">{initials}</span>
            <div className="sidebar-profile-text">
              <strong>{user?.name || <LoadingDots label="Loading" />}</strong>
              <span>{user?.role === "admin" ? "Administrator" : "Staff member"}</span>
            </div>
            <button
              type="button"
              className="logout-icon"
              onClick={() => {
                setLogoutError("");
                setLogoutConfirmOpen(true);
              }}
              aria-label="Sign out"
              title="Sign out"
            >
              <Icon name="logout" size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div className={`portal-main ${className || ""}`}>
        <header className="portal-topbar">
          <div className="portal-context">
            <button
              type="button"
              className="portal-burger"
              onClick={() => setOpen((current) => !current)}
              aria-label="Toggle navigation"
            >
              <Icon name="menu" />
            </button>
            <Icon name={area === "admin" ? "chart" : "receipt"} />
            <div>
              <div className="portal-context-label">{contextLabel}</div>
              <div className="portal-context-title">{contextTitle}</div>
            </div>
          </div>
          <div className="portal-topbar-right">
            <span className="live-pill">
              <span className="live-dot" /> Live
            </span>
            <span className="topbar-time">{clock}</span>
            <div className="portal-notifications">
              <button
                type="button"
                className="topbar-button"
                aria-label={`Notifications${unreadNotificationCount ? `, ${unreadNotificationCount} unread` : ""}`}
                aria-expanded={notificationsOpen}
                aria-controls="portal-notification-menu"
                onClick={() => setNotificationsOpen((current) => !current)}
              >
                <Icon name="bell" size={15} />
                {unreadNotificationCount > 0 && (
                  <span className="notif-count">
                    {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <div
                  className="portal-notification-menu"
                  id="portal-notification-menu"
                  role="region"
                  aria-label={area === "admin" ? "Admin alerts" : "Staff alerts"}
                >
                  <div className="portal-notification-heading">
                    <strong>{area === "admin" ? "Admin alerts" : "Staff alerts"}</strong>
                    <span>
                      {unreadNotificationCount} unread · {notifications.length} active
                    </span>
                  </div>
                  {notificationError ? (
                    <p className="portal-notification-empty" role="status">
                      {notificationError}
                    </p>
                  ) : notifications.length === 0 ? (
                    <p className="portal-notification-empty">
                      {area === "admin"
                        ? "No low-stock items or recent customer reviews."
                        : "No pending payment reviews, overdue orders, or waiter calls."}
                    </p>
                  ) : (
                    <div className="portal-notification-list">
                      {notifications.map((notification) => (
                        <Link
                          key={notification.id}
                          href={notification.href}
                          className={`portal-notification-item${notification.read ? " seen" : ""}`}
                          aria-disabled={markingNotificationId === notification.id}
                          onClick={(event) => void openNotification(event, notification)}
                        >
                          <span className={`portal-notification-icon ${notification.kind}`}>
                            <Icon
                              name={
                                notification.kind === "payment"
                                  ? "card"
                                  : notification.kind === "stock"
                                    ? "menu"
                                    : notification.kind === "review"
                                      ? "reviews"
                                      : notification.kind === "waiter"
                                        ? "waiter"
                                        : "alert"
                              }
                              size={14}
                            />
                          </span>
                          <span className="portal-notification-copy">
                            <strong>{notification.title}</strong>
                            <span>{notification.message}</span>
                          </span>
                          <span className="portal-notification-state">
                            {markingNotificationId === notification.id
                              ? <LoadingDots label="Marking seen" />
                              : notification.read
                                ? "Seen"
                                : "New"}
                          </span>
                          {!notification.read && (
                            <span className="portal-notification-unread-dot" />
                          )}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="portal-content">
          <div className="content-heading">
            <div>
              {area === "admin" && <span className="eyebrow">Merrylane admin</span>}
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
          </div>
          {children}
        </main>
      </div>
      {area === "staff" && staffLocked && (
        <div className="feedback-layer tone-warning session-lock-layer">
          <section
            className="feedback-card session-lock-card"
            data-tone="warning"
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-lock-title"
            aria-describedby="staff-lock-message"
          >
            <div className="feedback-medallion" aria-hidden="true">
              <Icon name="alert" size={22} />
            </div>
            <span className="feedback-eyebrow">Staff session paused</span>
            <h2 id="staff-lock-title" className="feedback-title">
              Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""}.
            </h2>
            <p id="staff-lock-message" className="feedback-message">
              This screen was locked after 15 minutes away. Enter your password to
              continue, or switch accounts.
            </p>
            <form className="session-lock-form" onSubmit={unlockStaffSession}>
              <label className="label" htmlFor="staff-session-password">
                Password
              </label>
              <input
                ref={unlockPasswordRef}
                id="staff-session-password"
                className="input"
                type="password"
                value={unlockPassword}
                onChange={(event) => setUnlockPassword(event.target.value)}
                autoComplete="current-password"
                required
                disabled={unlocking}
              />
              {unlockError && <p className="logout-confirm-error" role="alert">{unlockError}</p>}
              <div className="logout-confirm-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={unlocking}
                  onClick={() => void switchStaffAccount()}
                >
                  Switch account
                </button>
                <button type="submit" className="btn btn-primary" disabled={unlocking}>
                  {unlocking ? <LoadingDots label="Checking password" /> : "Continue"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {logoutConfirmOpen && (
        <div
          className="feedback-layer tone-warning"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loggingOut) {
              setLogoutConfirmOpen(false);
            }
          }}
        >
          <section
            className="feedback-card logout-confirm-card"
            data-tone="warning"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="logout-confirm-title"
            aria-describedby="logout-confirm-message"
          >
            <div className="feedback-medallion" aria-hidden="true">
              <Icon name="alert" size={22} />
            </div>
            <span className="feedback-eyebrow">Confirm sign out</span>
            <h2 id="logout-confirm-title" className="feedback-title">
              Log out of your account?
            </h2>
            <p id="logout-confirm-message" className="feedback-message">
              You will need to sign in again to continue.
            </p>
            {logoutError && (
              <p className="logout-confirm-error" role="alert">
                {logoutError}
              </p>
            )}
            <div className="logout-confirm-actions">
              <button
                ref={cancelLogoutRef}
                type="button"
                className="btn btn-outline"
                disabled={loggingOut}
                onClick={() => setLogoutConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={loggingOut}
                onClick={logout}
              >
                {loggingOut ? <LoadingDots label="Logging out" /> : "Log out"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
