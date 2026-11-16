"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AdminRouteSkeleton } from "./AdminRouteSkeleton";
import { StaffRouteSkeleton } from "./StaffRouteSkeleton";

type PortalArea = "admin" | "staff";
type AdminPage =
  | "overview"
  | "analysis"
  | "menu"
  | "team"
  | "hours"
  | "reviews"
  | "activity"
  | "settings";
type StaffPage = "board" | "payments" | "receipt" | "requests" | "sales" | "stock";

function adminPageFor(pathname: string): AdminPage {
  if (
    pathname.startsWith("/admin/analysis") ||
    pathname.startsWith("/admin/analytics")
  ) {
    return "analysis";
  }
  if (pathname.startsWith("/admin/menu")) return "menu";
  if (pathname.startsWith("/admin/staff")) return "team";
  if (pathname.startsWith("/admin/cafesetup")) return "hours";
  if (pathname.startsWith("/admin/reviews")) return "reviews";
  if (pathname.startsWith("/admin/activity")) return "activity";
  if (pathname.startsWith("/admin/settings")) return "settings";
  return "overview";
}

function staffPageFor(pathname: string): StaffPage {
  if (pathname.startsWith("/staff/receipt")) return "receipt";
  if (pathname.startsWith("/staff/payments")) return "payments";
  if (pathname.startsWith("/staff/requests")) return "requests";
  if (pathname.startsWith("/staff/sales")) return "sales";
  if (pathname.startsWith("/staff/stock")) return "stock";
  return "board";
}

const pageLabels: Record<AdminPage | StaffPage, string> = {
  overview: "overview",
  analysis: "business analysis",
  menu: "menu management",
  team: "team management",
  hours: "cafe hours",
  reviews: "customer reviews",
  activity: "activity log",
  settings: "admin settings",
  board: "order queue",
  payments: "payment checks",
  receipt: "verified receipts",
  requests: "waiter requests",
  sales: "daily sales",
  stock: "stock availability",
};

function PortalSkeletonFrame({
  area,
  page,
  children,
}: {
  area: PortalArea;
  page: AdminPage | StaffPage;
  children: ReactNode;
}) {
  return (
    <section
      className={`portal-page-skeleton portal-page-skeleton-${area} portal-page-skeleton-${page}`}
      role="status"
      aria-busy="true"
      aria-label={`Loading ${pageLabels[page]}`}
    >
      <div className="portal-skeleton-content" aria-hidden="true">{children}</div>
    </section>
  );
}

export function PortalPageSkeleton({ area }: { area: PortalArea }) {
  const pathname = usePathname();

  if (area === "admin") {
    const page = adminPageFor(pathname);
    return (
      <PortalSkeletonFrame area={area} page={page}>
        <AdminRouteSkeleton page={page} />
      </PortalSkeletonFrame>
    );
  }

  const page = staffPageFor(pathname);
  return (
    <PortalSkeletonFrame area={area} page={page}>
      <StaffRouteSkeleton page={page} />
    </PortalSkeletonFrame>
  );
}
