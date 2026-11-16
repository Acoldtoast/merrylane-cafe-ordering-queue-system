type PortalArea = "admin" | "staff" | "customer";

type RouteModuleLoader = () => Promise<unknown>;

const routeModules: Record<PortalArea, Record<string, RouteModuleLoader>> = {
  admin: {
    "/admin": () => import("@/app/admin/AdminDashboardClient"),
    "/admin/analytics": () => import("@/app/admin/AdminDashboardClient"),
    "/admin/analysis": () => import("@/app/admin/AdminDashboardClient"),
    "/admin/menu": () => import("@/app/admin/menu/AdminMenuClient"),
    "/admin/staff": () => import("@/app/admin/staff/AdminStaffClient"),
    "/admin/cafesetup": () => import("@/app/admin/cafesetup/AdminHoursClient"),
    "/admin/reviews": () => import("@/app/admin/reviews/AdminReviewsClient"),
    "/admin/activity": () => import("@/app/admin/activity/AdminActivityClient"),
    "/admin/settings": () => import("@/app/admin/settings/AdminSettingsClient"),
  },
  staff: {
    "/staff": () => import("@/app/staff/StaffBoardClient"),
    "/staff/payments": () => import("@/app/staff/payments/StaffPaymentsClient"),
    "/staff/receipt": () => import("@/app/staff/receipt/StaffReceiptsClient"),
    "/staff/requests": () => import("@/app/staff/requests/StaffRequestsClient"),
    "/staff/sales": () => import("@/app/staff/sales/StaffSalesClient"),
    "/staff/stock": () => import("@/app/staff/stock/StaffStockClient"),
  },
  customer: {
    "/customer/welcome": () => import("@/app/customer/welcome/WelcomeClient"),
    "/customer/menu": () => import("@/app/customer/menu/MenuClient"),
    "/customer/item/[id]": () => import("@/app/customer/item/[id]/ItemClient"),
    "/customer/orders": () => import("@/app/customer/orders/OrderHistoryClient"),
    "/customer/status": () => import("@/app/customer/status/StatusClient"),
    "/customer/payment": () => import("@/app/customer/payment/PaymentClient"),
    "/customer/confirm": () => import("@/app/customer/confirm/ConfirmClient"),
    "/customer/waiter": () => import("@/app/customer/waiter/WaiterClient"),
    "/customer/hours": () => import("@/app/customer/hours/CustomerHoursClient"),
    "/customer/cart": () => import("@/app/customer/cart/CartClient"),
    "/customer/feedback": () => import("@/app/customer/feedback/FeedbackClient"),
  },
};

const pendingModules = new Map<string, Promise<void>>();

export function preloadPortalRouteCode(area: PortalArea, href: string) {
  if (typeof window === "undefined") return;
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (
    connection?.saveData ||
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g"
  ) {
    return;
  }

  const pathname = new URL(href, window.location.origin).pathname;
  const modulePath =
    area === "customer" && /^\/customer\/item\/\d+$/.test(pathname)
      ? "/customer/item/[id]"
      : pathname;
  const loadModule = routeModules[area][modulePath];
  if (!loadModule) return;

  const key = `${area}:${modulePath}`;
  if (pendingModules.has(key)) return pendingModules.get(key);

  const pending = loadModule()
    .then(() => undefined)
    .catch((error: unknown) => {
      pendingModules.delete(key);
      console.warn(`Could not preload client code for "${pathname}".`, error);
    });
  pendingModules.set(key, pending);
  return pending;
}
