type PrefetchedResponse = {
  startedAt: number;
  response: Promise<Response | null>;
};

const PREFETCH_TTL_MS = 2 * 60_000;
const MAX_PREFETCHED_REQUESTS = 12;
const PORTAL_DATA_CHANGED_EVENT = "portal-data-changed";
const PORTAL_DATA_CHANGED_STORAGE_KEY = "merrylane:portal:data-changed";
const prefetchedResponses = new Map<string, PrefetchedResponse>();

export type PortalDataResource =
  | "accounts"
  | "activity"
  | "analytics"
  | "history"
  | "hours"
  | "menu"
  | "orders"
  | "payments"
  | "requests"
  | "reviews"
  | "sales"
  | "settings"
  | "stock"
  | "waiter";

export interface PortalDataChangedDetail {
  path: string;
  resources: PortalDataResource[];
}

function resourcesForApiPath(path: string): PortalDataResource[] {
  if (/\/api\/auth\/(login|staff-idle)\b/.test(path)) {
    return ["accounts", "activity"];
  }
  if (/\/api\/admin\/settings\b/.test(path)) {
    return ["settings", "hours"];
  }
  if (/\/api\/(users|admin\/staff)\b/.test(path)) {
    return ["accounts", "activity"];
  }
  if (/\/api\/(menu|addons|categories)\b/.test(path)) {
    return ["menu", "orders", "payments", "sales"];
  }
  if (/\/api\/orders\b|\/api\/order-balance-payments\b/.test(path)) {
    return ["orders", "payments", "sales", "analytics", "history"];
  }
  if (/\/api\/stock\b/.test(path)) {
    return ["stock", "analytics"];
  }
  if (/\/api\/waiter\b/.test(path)) {
    return ["waiter", "requests", "orders"];
  }
  if (/\/api\/reviews\b/.test(path)) return ["reviews"];
  if (/\/api\/settings\b/.test(path)) return ["settings", "hours"];
  if (/\/api\/activity\b/.test(path)) return ["activity"];
  return ["orders", "payments", "sales", "analytics", "history"];
}

export function notifyPortalDataChanged(
  path = "/api",
  resources = resourcesForApiPath(path)
): void {
  if (typeof window === "undefined") return;
  prefetchedResponses.clear();
  const detail = { path, resources } satisfies PortalDataChangedDetail;
  window.dispatchEvent(
    new CustomEvent<PortalDataChangedDetail>(PORTAL_DATA_CHANGED_EVENT, {
      detail,
    })
  );
  try {
    window.localStorage.setItem(
      PORTAL_DATA_CHANGED_STORAGE_KEY,
      JSON.stringify({ ...detail, nonce: `${Date.now()}-${Math.random()}` })
    );
  } catch (error: unknown) {
    console.warn("Could not notify other tabs about updated portal data.", error);
  }
}

export function dispatchPortalDataChanged(
  detail: PortalDataChangedDetail
): void {
  if (typeof window === "undefined") return;
  prefetchedResponses.clear();
  window.dispatchEvent(
    new CustomEvent<PortalDataChangedDetail>(PORTAL_DATA_CHANGED_EVENT, {
      detail,
    })
  );
}

export function onPortalDataChanged(
  callback: (detail: PortalDataChangedDetail) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const handleLocalChange = (event: Event) => {
    callback((event as CustomEvent<PortalDataChangedDetail>).detail);
  };
  const handleOtherTabChange = (event: StorageEvent) => {
    if (event.key !== PORTAL_DATA_CHANGED_STORAGE_KEY || !event.newValue) return;
    try {
      const { path, resources } = JSON.parse(
        event.newValue
      ) as PortalDataChangedDetail;
      if (typeof path === "string" && Array.isArray(resources)) {
        dispatchPortalDataChanged({ path, resources });
      }
    } catch (error: unknown) {
      console.warn("Could not read an update from another portal tab.", error);
    }
  };
  window.addEventListener(PORTAL_DATA_CHANGED_EVENT, handleLocalChange);
  window.addEventListener("storage", handleOtherTabChange);
  return () => {
    window.removeEventListener(PORTAL_DATA_CHANGED_EVENT, handleLocalChange);
    window.removeEventListener("storage", handleOtherTabChange);
  };
}

function requestKey(url: string) {
  return new URL(url, window.location.origin).toString();
}

function notifyPortalAuthFailure(response: Response) {
  if (typeof window === "undefined") return;
  if (response.status !== 401 && response.status !== 403) return;
  const pathname = window.location.pathname;
  const area = pathname.startsWith("/admin")
    ? "admin"
    : pathname.startsWith("/staff")
      ? "staff"
      : null;
  if (!area) return;
  window.dispatchEvent(
    new CustomEvent("portal-auth-expired", { detail: { area } })
  );
}

function clearExpiredRequests() {
  const now = Date.now();
  for (const [key, request] of prefetchedResponses) {
    if (now - request.startedAt > PREFETCH_TTL_MS) {
      prefetchedResponses.delete(key);
    }
  }
}

export function prefetchPortalApi(url: string) {
  if (typeof window === "undefined") return;
  clearExpiredRequests();
  const key = requestKey(url);
  if (prefetchedResponses.has(key)) return;

  while (prefetchedResponses.size >= MAX_PREFETCHED_REQUESTS) {
    const oldestKey = prefetchedResponses.keys().next().value;
    if (!oldestKey) break;
    prefetchedResponses.delete(oldestKey);
  }

  const request: PrefetchedResponse = {
    startedAt: Date.now(),
    response: Promise.resolve(null),
  };
  request.response = fetch(url, { cache: "no-store" })
    .then((response) => {
      if (response.ok) return response;
      if (prefetchedResponses.get(key) === request) {
        prefetchedResponses.delete(key);
      }
      return null;
    })
    .catch((error: unknown) => {
      if (prefetchedResponses.get(key) === request) {
        prefetchedResponses.delete(key);
      }
      console.warn(`Could not prefetch portal data from "${url}".`, error);
      return null;
    });
  prefetchedResponses.set(key, request);
}

export async function fetchPortalApi(
  url: string,
  init?: RequestInit
): Promise<Response> {
  if (init?.method && init.method.toUpperCase() !== "GET") {
    prefetchedResponses.clear();
    const response = await fetch(url, init);
    notifyPortalAuthFailure(response);
    if (response.ok) {
      const path = new URL(
        url,
        typeof window === "undefined" ? "http://localhost" : window.location.origin
      ).pathname;
      notifyPortalDataChanged(path);
    }
    return response;
  }
  if (typeof window === "undefined") return fetch(url, init);

  clearExpiredRequests();
  const key = requestKey(url);
  let response: Response | null = null;
  if (init?.cache === "no-store") {
    prefetchedResponses.delete(key);
    response = await fetch(url, init);
  } else {
    const request = prefetchedResponses.get(key);
    if (request) {
      prefetchedResponses.delete(key);
      response = await request.response;
    }
  }
  if (!response) response = await fetch(url, init);
  notifyPortalAuthFailure(response);
  return response;
}

function manilaDate() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

export function prefetchPortalRouteData(
  area: "staff" | "admin" | "customer",
  href: string
) {
  const url = new URL(href, window.location.origin);
  const path = url.pathname;
  let requests: string[] = [];

  if (area === "customer") {
    const orderId = Number(url.searchParams.get("id"));
    const table = Number(url.searchParams.get("table")) || 7;
    if (path === "/customer/orders" ||
        (path === "/customer/feedback" && !Number(url.searchParams.get("order")))) {
      requests = ["/api/orders/history"];
    } else if (path === "/customer/status" && orderId > 0) {
      requests = [
        `/api/orders/${orderId}`,
        `/api/waiter?table=${table}`,
      ];
    } else if (path === "/customer/status") {
      requests = [`/api/waiter?table=${table}`];
    } else if (
      (path === "/customer/payment" || path === "/customer/confirm") &&
      orderId > 0
    ) {
      requests = [`/api/orders/${orderId}`];
      if (path === "/customer/payment") requests.push("/api/settings");
    } else if (path === "/customer/payment") {
      requests = ["/api/settings"];
    } else if (path === "/customer/menu" || path === "/customer/cart") {
      requests = ["/api/menu"];
    } else if (path === "/customer/waiter") {
      requests = [`/api/waiter?table=${table}`];
    } else if (path === "/customer/hours") {
      requests = ["/api/settings"];
    }
  } else if (area === "staff") {
    if (path === "/staff") {
      requests = [
        "/api/orders?board=1",
        "/api/addons",
        "/api/menu",
        "/api/waiter",
      ];
    } else if (path === "/staff/payments") {
      requests = [
        "/api/orders?status=payment_pending,pending",
        "/api/order-balance-payments",
        "/api/menu",
      ];
    } else if (path === "/staff/receipt") {
      const date = url.searchParams.get("date");
      requests = [
        `/api/orders?recent_verified=1&${
          date ? `date=${encodeURIComponent(date)}` : "business_day=1"
        }&page=1`,
      ];
    } else if (path === "/staff/requests") {
      requests = ["/api/waiter"];
    } else if (path === "/staff/sales") {
      requests = [`/api/staff/sales?date=${manilaDate()}`];
    } else if (path === "/staff/stock") {
      requests = ["/api/stock"];
    } else if (path === "/staff/profile") {
      requests = ["/api/staff/profile"];
    }
  } else if (area === "admin") {
    if (path === "/admin" || path === "/admin/analysis") {
      requests = ["/api/analytics/overview"];
    } else if (path === "/admin/analytics") {
      requests = [
        "/api/analytics/overview",
        "/api/analytics/report?period=month&order_type=all&payment_method=all",
      ];
    } else if (path === "/admin/menu") {
      requests = ["/api/menu?all=1", "/api/addons?all=1", "/api/users"];
    } else if (path === "/admin/staff") {
      requests = ["/api/users?role=staff"];
    } else if (path === "/admin/cafesetup") {
      requests = ["/api/settings"];
    } else if (path === "/admin/reviews") {
      requests = ["/api/reviews"];
    } else if (path === "/admin/activity") {
      requests = ["/api/activity?page=1&page_size=30"];
    } else if (path === "/admin/settings") {
      requests = ["/api/admin/settings"];
    }
  }

  for (const request of requests) prefetchPortalApi(request);
}
