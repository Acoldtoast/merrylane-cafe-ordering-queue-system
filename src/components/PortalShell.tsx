"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
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
import {
  fetchPortalApi,
  notifyPortalDataChanged,
  prefetchPortalRouteData,
} from "@/lib/portalPrefetch";
import { preloadPortalRouteCode } from "@/lib/preloadPortalRouteCode";
import { useIdleRoutePrefetch } from "@/lib/useIdleRoutePrefetch";
import { usePolling } from "@/lib/usePolling";
import {
  getBrowserStorageItem,
  removeBrowserStorageItem,
  setBrowserStorageItem,
} from "@/lib/browserStorage";

export const portalSessionCache = new Map<
  string,
  { name: string; username: string; email: string; role: string }
>();

export function clearPortalSessionCache() {
  portalSessionCache.clear();
}

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
  if (base === "/staff/receipt") return "/staff/receipt";
  if (base === "/staff/requests") return "/staff/requests";
  if (base === "/staff") return "/staff";
  return null;
}

const ADMIN_IDLE_TIMEOUT_KEY = "merrylane:admin:idle-timeout-minutes";
const STAFF_IDLE_TIMEOUT_KEY = "merrylane:staff:idle-timeout-minutes";

function storedIdleTimeoutMinutes(
  storageKey: string,
  fallback: number,
  allowNever = false
): number {
  if (typeof window === "undefined") return fallback;
  const storedValue = getBrowserStorageItem(storageKey);
  if (storedValue === null || !storedValue.trim()) return fallback;
  const minutes = Number(storedValue);
  const options = allowNever ? [0, 5, 10, 15, 30, 60] : [5, 10, 15, 30, 60];
  return options.includes(minutes) ? minutes : fallback;
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
  contextLabel: string;
  contextTitle: string;
  nav: PortalNavItem[];
  children: React.ReactNode;
}

export function PortalShell({
  area,
  className,
  title,
  contextLabel,
  contextTitle,
  nav,
  children,
}: PortalShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [routeSnapshots, setRouteSnapshots] = useState(
    () => new Map<string, React.ReactNode>([[pathname, children]])
  );
  if (
    area === "staff" &&
    (routeSnapshots.size !== 1 || routeSnapshots.get(pathname) !== children)
  ) {
    setRouteSnapshots(new Map([[pathname, children]]));
  } else if (area === "admin" && routeSnapshots.get(pathname) !== children) {
    const nextSnapshots = new Map(routeSnapshots);
    nextSnapshots.set(pathname, children);
    setRouteSnapshots(nextSnapshots);
  }
  const [routeViewState, setRouteViewState] = useState({
    pathname,
    restored: false,
  });
  if (routeViewState.pathname !== pathname) {
    setRouteViewState({
      pathname,
      restored: area === "admin" && routeSnapshots.has(pathname),
    });
  }
  const visibleRouteSnapshots =
    area === "admin"
      ? new Map(routeSnapshots)
      : new Map([[pathname, children]]);
  visibleRouteSnapshots.set(pathname, children);
  const [open, setOpen] = useState(false);
  // Track the destination the user just clicked so the sidebar highlight and
  // the active state update instantly, instead of waiting for the next route
  // to finish rendering.
  const [pendingNavigation, setPendingNavigation] = useState<{
    fromPath: string;
    toPath: string;
  } | null>(null);
  const activePath =
    pendingNavigation?.fromPath === pathname
      ? pendingNavigation.toPath
      : pathname;
  // Remember the verified session per portal area so navigating between menu
  // items (which remounts this shell) does not blank the whole screen while
  // the session is re-checked.
  const cachedUser = portalSessionCache.get(area) ?? null;
  const [user, setUser] = useState<{ name: string; username: string; email: string; role: string } | null>(
    cachedUser
  );
  const [sessionReady, setSessionReady] = useState(Boolean(cachedUser));
  const [adminIdleTimeoutMinutes, setAdminIdleTimeoutMinutes] = useState(
    () => storedIdleTimeoutMinutes(ADMIN_IDLE_TIMEOUT_KEY, 5)
  );
  const [staffIdleTimeoutMinutes, setStaffIdleTimeoutMinutes] = useState(
    () => storedIdleTimeoutMinutes(STAFF_IDLE_TIMEOUT_KEY, 15, true)
  );
  const [clock, setClock] = useState("");
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [sessionConflict, setSessionConflict] = useState(false);
  const [authCheckError, setAuthCheckError] = useState(false);
  const [authRetryKey, setAuthRetryKey] = useState(0);
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
  const authRedirectingRef = useRef(false);
  const [idleWarning, setIdleWarning] = useState<{
    secondsRemaining: number;
  } | null>(null);
  const idleWarningTimerRef = useRef<number | undefined>(undefined);

  const startIdleWarningCountdown = (seconds: number) => {
    if (idleWarningTimerRef.current) {
      window.clearInterval(idleWarningTimerRef.current);
    }
    let remaining = seconds;
    idleWarningTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      setIdleWarning({ secondsRemaining: remaining });
      if (remaining <= 0) {
        window.clearInterval(idleWarningTimerRef.current);
        idleWarningTimerRef.current = undefined;
        setIdleWarning(null);
        if (user?.username) {
          removeBrowserStorageItem(
            `merrylane:staff:last-activity:${user.username}`
          );
        }
        notifyPortalDataChanged("/api/auth/staff-idle");
        portalSessionCache.delete("staff");
        authRedirectingRef.current = true;
        void fetch("/api/auth/login?area=staff", { method: "DELETE" }).finally(
          () => {
            router.replace("/login?next=/staff&reason=session_expired");
          }
        );
      }
    }, 1000);
  };

  const dismissIdleWarning = () => {
    if (idleWarningTimerRef.current) {
      window.clearInterval(idleWarningTimerRef.current);
      idleWarningTimerRef.current = undefined;
    }
    setIdleWarning(null);
    if (user?.username) {
      setBrowserStorageItem(
        `merrylane:staff:last-activity:${user.username}`,
        String(Date.now())
      );
    }
  };

  useEffect(() => {
    let active = true;
    const verifySession = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!active) return;
        try {
          const response = await fetch(`/api/auth/verify?area=${area}`, {
            cache: "no-store",
            credentials: "same-origin",
          });
          const data = await response.json();
          if (!response.ok && response.status >= 500) {
            throw new Error("Session verification is temporarily unavailable.");
          }
          if (!response.ok || !data.authenticated) {
            portalSessionCache.delete(area);
            if (!active) return;
            if (data.reason === "session_conflict") {
              authRedirectingRef.current = true;
              setSessionConflict(true);
              setSessionReady(true);
              return;
            }
            const reason = data.reason
              ? `&reason=${encodeURIComponent(data.reason)}`
              : "";
            void fetch(`/api/auth/login?area=${area}`, { method: "DELETE" }).finally(
              () => {
                router.replace(`/login?next=/${area}${reason}`);
              }
            );
            return;
          }
          if (!active) return;
          setAuthCheckError(false);
          const sessionUser = data.user as {
            name: string;
            username: string;
            email: string;
            role: string;
          };
          const configuredIdleTimeout = Number(data.idle_timeout_minutes);
          const idleTimeoutMinutes = Number.isFinite(configuredIdleTimeout)
            ? configuredIdleTimeout
            : area === "admin"
              ? 5
              : 15;
          if (area === "admin") {
            setBrowserStorageItem(
              ADMIN_IDLE_TIMEOUT_KEY,
              String(idleTimeoutMinutes)
            );
            setAdminIdleTimeoutMinutes(idleTimeoutMinutes);
          } else {
            setBrowserStorageItem(
              STAFF_IDLE_TIMEOUT_KEY,
              String(idleTimeoutMinutes)
            );
            setStaffIdleTimeoutMinutes(idleTimeoutMinutes);
            if (idleTimeoutMinutes === 0) {
              staffLockedRef.current = false;
              setStaffLocked(false);
              setUnlockPassword("");
            }
          }
          const lastActivityKey = `merrylane:${area}:last-activity:${sessionUser.username}`;
          const lastActivity = Number(getBrowserStorageItem(lastActivityKey));
          const idleLimit = idleTimeoutMinutes * 60 * 1000;
          if (idleTimeoutMinutes === 0 && !lastActivity) {
            setBrowserStorageItem(lastActivityKey, String(Date.now()));
          }
          if (
            idleTimeoutMinutes > 0 &&
            lastActivity &&
            Date.now() - lastActivity >= idleLimit
          ) {
            if (area === "admin") {
              await fetch("/api/auth/login?area=admin", { method: "DELETE" });
              router.replace("/login?next=/admin");
              return;
            }
            try {
              const idleResponse = await fetch("/api/auth/staff-idle", {
                method: "POST",
                cache: "no-store",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ last_activity_at: lastActivity }),
              });
              const idleData = await idleResponse.json();
              if (!idleResponse.ok || !idleData.success) {
                throw new Error(idleData.error || "Could not check the staff session.");
              }
              if (idleData.action === "signed_out") {
                portalSessionCache.delete(area);
                removeBrowserStorageItem(lastActivityKey);
                void fetch("/api/auth/login?area=staff", { method: "DELETE" }).finally(
                  () => {
                    router.replace("/login?next=/staff&reason=session_expired");
                  }
                );
                return;
              }
              staffLockedRef.current = true;
              setStaffLocked(true);
            } catch (error: unknown) {
              console.error("Could not check the idle staff session.", error);
              staffLockedRef.current = true;
              setStaffLocked(true);
            }
          }
          portalSessionCache.set(area, sessionUser);
          setUser(sessionUser);
          setSessionReady(true);
          return;
        } catch (error: unknown) {
          if (!active) return;
          if (attempt < 2) {
            await new Promise((resolve) =>
              window.setTimeout(resolve, 300 * (attempt + 1))
            );
            continue;
          }
          console.error("Could not verify the portal session.", error);
          setAuthCheckError(true);
          setSessionReady(true);
        }
      }
    };
    void verifySession();
    return () => {
      active = false;
    };
  }, [area, authRetryKey, router]);

  useEffect(() => {
    const handleProfileUpdate = (event: Event) => {
      const detail = (
        event as CustomEvent<{ name?: string; email?: string }>
      ).detail;
      if (!detail || !user) return;
      const updatedUser = {
        ...user,
        name: detail.name ?? user.name,
        email: detail.email ?? user.email,
      };
      if (updatedUser.username !== user.username) {
        const activityKey = `merrylane:${area}:last-activity:${user.username}`;
        const lastActivity = getBrowserStorageItem(activityKey);
        if (lastActivity) {
          setBrowserStorageItem(
            `merrylane:${area}:last-activity:${updatedUser.username}`,
            lastActivity
          );
          removeBrowserStorageItem(activityKey);
        }
      }
      portalSessionCache.set(area, updatedUser);
      setUser(updatedUser);
    };
    const handleIdleTimeoutUpdate = (event: Event) => {
      const detail = (
        event as CustomEvent<{ minutes?: number }>
      ).detail;
      const validTimeouts =
        area === "admin" ? [5, 10, 15, 30, 60] : [0, 5, 10, 15, 30, 60];
      if (
        typeof detail?.minutes === "number" &&
        validTimeouts.includes(detail.minutes)
      ) {
        if (area === "admin" && event.type === "admin-idle-timeout-updated") {
          setBrowserStorageItem(ADMIN_IDLE_TIMEOUT_KEY, String(detail.minutes));
          setAdminIdleTimeoutMinutes(detail.minutes);
        } else if (
          area === "staff" &&
          event.type === "staff-idle-timeout-updated"
        ) {
          setBrowserStorageItem(STAFF_IDLE_TIMEOUT_KEY, String(detail.minutes));
          setStaffIdleTimeoutMinutes(detail.minutes);
          if (detail.minutes === 0) {
            if (user) {
              setBrowserStorageItem(
                `merrylane:staff:last-activity:${user.username}`,
                String(Date.now())
              );
            }
            staffLockedRef.current = false;
            setStaffLocked(false);
            setUnlockPassword("");
          }
        }
      }
    };
    window.addEventListener("portal-profile-updated", handleProfileUpdate);
    window.addEventListener(
      "admin-idle-timeout-updated",
      handleIdleTimeoutUpdate
    );
    window.addEventListener(
      "staff-idle-timeout-updated",
      handleIdleTimeoutUpdate
    );
    return () => {
      window.removeEventListener("portal-profile-updated", handleProfileUpdate);
      window.removeEventListener(
        "admin-idle-timeout-updated",
        handleIdleTimeoutUpdate
      );
      window.removeEventListener(
        "staff-idle-timeout-updated",
        handleIdleTimeoutUpdate
      );
    };
  }, [area, user]);

  useEffect(() => {
    const handleAuthExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ area?: string }>).detail;
      if (detail?.area !== area || authRedirectingRef.current) return;
      void fetch(`/api/auth/verify?area=${area}`, { cache: "no-store" })
        .then(async (response) => {
          const data = await response.json();
          if (data.authenticated) return;
          portalSessionCache.delete(area);
          if (data.reason === "session_conflict") {
            authRedirectingRef.current = true;
            setSessionConflict(true);
            return;
          }
          authRedirectingRef.current = true;
          const nextPath = pathname.startsWith(`/${area}`)
            ? pathname
            : `/${area}`;
          void fetch(`/api/auth/login?area=${area}`, { method: "DELETE" }).finally(
            () => {
              router.replace(
                `/login?next=${encodeURIComponent(nextPath)}&reason=session_expired`
              );
            }
          );
        })
        .catch(() => {
          // The regular session check retries when the page becomes visible.
        });
    };
    window.addEventListener("portal-auth-expired", handleAuthExpired);
    return () => {
      window.removeEventListener("portal-auth-expired", handleAuthExpired);
    };
  }, [area, pathname, router]);

  useEffect(() => {
    if (!user || user.role !== area || sessionConflict) return;
    let checking = false;
    let active = true;

    const checkSession = async () => {
      if (
        checking ||
        !active ||
        document.visibilityState === "hidden"
      ) {
        return;
      }
      checking = true;
      try {
        const response = await fetch(`/api/auth/verify?area=${area}`, {
          cache: "no-store",
        });
        const data = await response.json();
        if (!active || data.authenticated) return;
        portalSessionCache.delete(area);
        if (data.reason === "session_conflict") {
          authRedirectingRef.current = true;
          setSessionConflict(true);
          return;
        }
        authRedirectingRef.current = true;
        void fetch(`/api/auth/login?area=${area}`, { method: "DELETE" }).finally(
          () => {
            router.replace(
              `/login?next=${encodeURIComponent(pathname)}&reason=session_expired`
            );
          }
        );
      } catch {
        // A temporary network error does not invalidate the current session.
      } finally {
        checking = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkSession();
    };
    const timer = window.setInterval(() => void checkSession(), 10_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [area, pathname, router, sessionConflict, user]);

  useEffect(() => {
    const idleTimeoutMinutes =
      area === "admin" ? adminIdleTimeoutMinutes : staffIdleTimeoutMinutes;
    if (
      !user ||
      user.role !== area ||
      idleTimeoutMinutes === 0 ||
      (area === "staff" && staffLocked)
    ) {
      return;
    }

    const idleLimit = idleTimeoutMinutes * 60 * 1000;
    const activityKey = `merrylane:${area}:last-activity:${user.username}`;
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
      removeBrowserStorageItem(activityKey);
      void fetch("/api/auth/login?area=admin", { method: "DELETE" })
        .finally(() => router.replace("/login?next=/admin"));
    };

    const signOutStaff = () => {
      authRedirectingRef.current = true;
      removeBrowserStorageItem(activityKey);
      portalSessionCache.delete(area);
      void fetch("/api/auth/login?area=staff", { method: "DELETE" })
        .finally(() => router.replace("/login?next=/staff"));
    };

    const handleStaffIdle = async () => {
      if (staffLockedRef.current) return;
      try {
        const response = await fetch("/api/auth/staff-idle", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            last_activity_at:
              Number(getBrowserStorageItem(activityKey)) || Date.now(),
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not check the staff session.");
        }
        if (data.action === "idle_warning") {
          const seconds = Number(data.seconds_until_signout) || 60;
          setIdleWarning({ secondsRemaining: seconds });
          startIdleWarningCountdown(seconds);
          return;
        }
        if (data.action === "signed_out") {
          notifyPortalDataChanged("/api/auth/staff-idle");
          signOutStaff();
          return;
        }
        if (data.action === "active") {
          if (data.idle_timeout_minutes === 0) {
            setBrowserStorageItem(STAFF_IDLE_TIMEOUT_KEY, "0");
            setStaffIdleTimeoutMinutes(0);
            setBrowserStorageItem(activityKey, String(Date.now()));
            staffLockedRef.current = false;
            setStaffLocked(false);
            setUnlockPassword("");
          }
          return;
        }
        if (data.action === "locked") {
          lockStaff();
          return;
        }
      } catch (error: unknown) {
        console.error("Could not check the idle staff session.", error);
        lockStaff();
      }
    };

    const expireIfIdle = () => {
      const lastActivity =
        Number(getBrowserStorageItem(activityKey)) || Date.now();
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
          const verification = await fetch(`/api/auth/verify?area=${area}`, {
            cache: "no-store",
          });
          const status = await verification.json();
          if (!status.authenticated && status.reason === "session_conflict") {
            authRedirectingRef.current = true;
            portalSessionCache.delete(area);
            setSessionConflict(true);
            return;
          }
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
      setBrowserStorageItem(activityKey, String(now));
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(expireIfIdle, idleLimit);
      void refreshAdminSession();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        expireIfIdle();
        void refreshAdminSession();
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (area === "admin" && event.key === ADMIN_IDLE_TIMEOUT_KEY) {
        const minutes =
          event.newValue === null ? Number.NaN : Number(event.newValue);
        if ([5, 10, 15, 30, 60].includes(minutes)) {
          setAdminIdleTimeoutMinutes(minutes);
        }
        return;
      }
      if (area === "staff" && event.key === STAFF_IDLE_TIMEOUT_KEY) {
        const minutes =
          event.newValue === null ? Number.NaN : Number(event.newValue);
        if ([0, 5, 10, 15, 30, 60].includes(minutes)) {
          setStaffIdleTimeoutMinutes(minutes);
          if (minutes === 0) {
            setBrowserStorageItem(activityKey, String(Date.now()));
            staffLockedRef.current = false;
            setStaffLocked(false);
            setUnlockPassword("");
          }
        }
        return;
      }
      if (event.key !== activityKey || staffLockedRef.current) return;
      window.clearTimeout(idleTimer);
      expireIfIdle();
    };

    const storedActivity = Number(getBrowserStorageItem(activityKey));
    if (storedActivity && Date.now() - storedActivity >= idleLimit) {
      if (area === "admin") {
        signOutAdmin();
        return;
      }
      handleStaffIdle();
    } else {
      if (!storedActivity) {
        setBrowserStorageItem(activityKey, String(Date.now()));
      }
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
  }, [
    adminIdleTimeoutMinutes,
    area,
    router,
    staffIdleTimeoutMinutes,
    staffLocked,
    user,
  ]);

  useEffect(() => {
    if (
      area !== "staff" ||
      staffIdleTimeoutMinutes !== 0 ||
      staffLocked ||
      !user
    ) {
      return;
    }

    const activityKey = `merrylane:staff:last-activity:${user.username}`;
    const markActivity = () => {
      if (document.visibilityState === "hidden") return;
      setBrowserStorageItem(activityKey, String(Date.now()));
    };

    window.addEventListener("pointerdown", markActivity, { passive: true });
    window.addEventListener("keydown", markActivity);
    window.addEventListener("touchstart", markActivity, { passive: true });
    window.addEventListener("scroll", markActivity, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("touchstart", markActivity);
      window.removeEventListener("scroll", markActivity);
    };
  }, [area, staffIdleTimeoutMinutes, staffLocked, user]);

  useEffect(() => {
    const monitoringNeverTimeout =
      !staffLocked && staffIdleTimeoutMinutes === 0;
    if (
      area !== "staff" ||
      !user ||
      (!staffLocked && !monitoringNeverTimeout)
    ) {
      return;
    }
    let checking = false;
    let active = true;
    const checkForClosing = async () => {
      if (checking || !active) return;
      checking = true;
      try {
        const response = await fetch("/api/auth/staff-idle", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            last_activity_at:
              Number(
                getBrowserStorageItem(
                  `merrylane:staff:last-activity:${user.username}`
                )
              ) || Date.now(),
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not check the staff session.");
        }
        if (data.action === "idle_warning") {
          const seconds = Number(data.seconds_until_signout) || 60;
          setIdleWarning({ secondsRemaining: seconds });
          startIdleWarningCountdown(seconds);
          return;
        }
        if (data.action === "signed_out") {
          notifyPortalDataChanged("/api/auth/staff-idle");
          authRedirectingRef.current = true;
          portalSessionCache.delete("staff");
          removeBrowserStorageItem(
            `merrylane:staff:last-activity:${user.username}`
          );
          router.replace("/login?next=/staff&reason=session_expired");
          return;
        }
        if (data.action === "active" && data.idle_timeout_minutes === 0) {
          setBrowserStorageItem(STAFF_IDLE_TIMEOUT_KEY, "0");
          setStaffIdleTimeoutMinutes(0);
          staffLockedRef.current = false;
          setStaffLocked(false);
          setUnlockPassword("");
          return;
        }
        if (data.action === "locked") {
          staffLockedRef.current = true;
          setStaffLocked(true);
          setUnlockPassword("");
          setUnlockError("");
        }
      } catch (error: unknown) {
        console.error("Could not check the locked staff session.", error);
      } finally {
        checking = false;
      }
    };
    void checkForClosing();
    const timer = window.setInterval(
      () => void checkForClosing(),
      staffLocked ? 30_000 : 5 * 60_000
    );
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForClosing();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [area, router, staffIdleTimeoutMinutes, staffLocked, user]);

  useEffect(() => {
    staffLockedRef.current = staffLocked;
    if (staffLocked) unlockPasswordRef.current?.focus();
  }, [staffLocked]);

  useEffect(() => {
    return () => {
      if (idleWarningTimerRef.current) {
        window.clearInterval(idleWarningTimerRef.current);
        idleWarningTimerRef.current = undefined;
      }
    };
  }, []);

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
      const response = await fetchPortalApi("/api/staff/notifications", {
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
      const response = await fetchPortalApi("/api/staff/notifications", {
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
          : pathname.startsWith("/staff/receipt")
            ? "/staff/receipt"
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
        const response = await fetchPortalApi("/api/staff/notifications", {
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
      if (area === "staff") {
        notifyPortalDataChanged("/api/auth/login");
      }
      removeBrowserStorageItem(
        `merrylane:${area}:last-activity:${user?.username}`
      );
      portalSessionCache.delete(area);
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

      setBrowserStorageItem(
        `merrylane:staff:last-activity:${user?.username}`,
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
      notifyPortalDataChanged("/api/auth/login");
      if (user?.username) {
        removeBrowserStorageItem(
          `merrylane:staff:last-activity:${user.username}`
        );
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
    ? nav.map((item) => item.href)
    : [];
  const prefetchPathsKey = prefetchPaths.join("\n");
  useIdleRoutePrefetch(
    prefetchPaths,
    canPrefetchPortalRoutes && area !== "admin" && area !== "staff",
    true
  );

  useEffect(() => {
    if (!canPrefetchPortalRoutes) return;
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
    const dataPaths = prefetchPathsKey.split("\n").filter(Boolean);
    const prefetchSidebarData = () => {
      if (disposed || document.visibilityState !== "visible") return;
      for (const href of dataPaths) {
        if (href === pathname) continue;
        void preloadPortalRouteCode(area, href);
        prefetchPortalRouteData(area, href);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") prefetchSidebarData();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    onVisibilityChange();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [area, canPrefetchPortalRoutes, pathname, prefetchPathsKey]);

  if (!sessionReady || authCheckError) {
    return (
      <div className="portal portal-loading" aria-busy="true" aria-live="polite">
        <div className="loading-block portal-loading-block">
          {authCheckError ? (
            <div role="alert">
              <p>We couldn’t verify your session. Check your connection and try again.</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setAuthCheckError(false);
                  setSessionReady(false);
                  setAuthRetryKey((key) => key + 1);
                }}
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              <span className="spinner" /> Loading your workspace…
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="portal">
      {sessionConflict && (
        <div className="feedback-layer tone-warning session-conflict-layer">
          <section
            className="feedback-card logout-confirm-card"
            data-tone="warning"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="session-conflict-title"
            aria-describedby="session-conflict-message"
          >
            <div className="feedback-medallion" aria-hidden="true">
              <Icon name="alert" size={22} />
            </div>
            <span className="feedback-eyebrow">Session conflict</span>
            <h2 id="session-conflict-title" className="feedback-title">
              This account was signed in elsewhere.
            </h2>
            <p id="session-conflict-message" className="feedback-message">
              Your session ended because this account was used on another device.
              Sign in again here if you want to continue on this device.
            </p>
            <div className="logout-confirm-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  router.replace(
                    `/login?next=${encodeURIComponent(pathname)}&reason=session_conflict`
                  )
                }
              >
                Go to sign in
              </button>
            </div>
          </section>
        </div>
      )}
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
                ? activePath === item.href
                : activePath.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                onClick={(event) => {
                  setOpen(false);
                  if (
                    (area === "admin" || area === "staff") &&
                    event.button === 0 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    if (pathname !== item.href) {
                      window.history.pushState(null, "", item.href);
                    }
                    return;
                  }
                  if (
                    area !== "admin" &&
                    event.button === 0 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    setPendingNavigation({ fromPath: pathname, toPath: item.href });
                  }
                }}
                onMouseEnter={() => {
                  if (area !== "admin" && area !== "staff") {
                    router.prefetch(item.href);
                  }
                  void preloadPortalRouteCode(area, item.href);
                  prefetchPortalRouteData(area, item.href);
                }}
                onFocus={() => {
                  if (area !== "admin" && area !== "staff") {
                    router.prefetch(item.href);
                  }
                  void preloadPortalRouteCode(area, item.href);
                  prefetchPortalRouteData(area, item.href);
                }}
                className={`sidebar-link ${active ? "active" : ""}`}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.badge ? (
                  <span
                    className={`nav-count ${area === "staff" ? "nav-count-alert" : ""}`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}

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
            <h1>{title}</h1>
          </div>
          {area === "staff" ? (
            <div key={pathname}>{children}</div>
          ) : (
            [...visibleRouteSnapshots].map(([route, snapshot]) => (
              <Activity key={route} mode={route === pathname ? "visible" : "hidden"}>
                {snapshot}
              </Activity>
            ))
          )}
        </main>
      </div>
      {area === "staff" && idleWarning && (
        <div className="feedback-layer tone-warning idle-warning-layer">
          <section
            className="feedback-card idle-warning-card"
            data-tone="warning"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="idle-warning-title"
            aria-describedby="idle-warning-message"
          >
            <div className="feedback-medallion" aria-hidden="true">
              <Icon name="alert" size={22} />
            </div>
            <span className="feedback-eyebrow">Shop is closed — you are idle</span>
            <h2 id="idle-warning-title" className="feedback-title">
              Auto sign-out in {idleWarning.secondsRemaining}s
            </h2>
            <p id="idle-warning-message" className="feedback-message">
              You have been idle past shop closing. Your account will be signed
              out automatically. Tap “Still using” to keep the session active.
            </p>
            <div className="logout-confirm-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => void dismissIdleWarning()}
              >
                Still using
              </button>
            </div>
          </section>
        </div>
      )}
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
              This screen was locked after {staffIdleTimeoutMinutes} minutes away.
              Enter your password to continue. Active sessions remain signed in
              across midnight. After shop closing, idle sessions are warned and
              signed out after the closing idle threshold.
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
        <div className="feedback-layer tone-warning">
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
