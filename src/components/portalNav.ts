import type { PortalNavItem } from "./PortalShell";

export const staffNav: PortalNavItem[] = [
  { href: "/staff/payments", label: "Payment checks", icon: "card" },
  { href: "/staff", label: "Order board", icon: "receipt" },
  { href: "/staff/receipt", label: "Receipt", icon: "check-circle" },
  { href: "/staff/stock", label: "Portions left", icon: "coffee" },
  { href: "/staff/sales", label: "Sales", icon: "chart" },
  { href: "/staff/requests", label: "Waiter requests", icon: "waiter" },
];

export const adminNav: PortalNavItem[] = [
  { href: "/admin", label: "Overview", icon: "grid" },
  { href: "/admin/analytics", label: "Analytics", icon: "chart" },
  { href: "/admin/menu", label: "Menu", icon: "coffee" },
  { href: "/admin/staff", label: "Staff management", icon: "users" },
  { href: "/admin/cafesetup", label: "Cafe setup", icon: "table" },
  { href: "/admin/reviews", label: "Reviews", icon: "reviews" },
  { href: "/admin/activity", label: "Activity log", icon: "shield" },
  { href: "/admin/settings", label: "Settings", icon: "settings" },
];
