"use client";

import { usePathname } from "next/navigation";
import { Suspense, lazy, useEffect } from "react";
import { PortalShell } from "@/components/PortalShell";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import { adminNav } from "@/components/portalNav";

const AdminOverviewRoute = lazy(() =>
  import("./AdminDashboardClient").then(({ AdminDashboardClient }) => ({
    default: () => <AdminDashboardClient />,
  }))
);
const AdminAnalyticsRoute = lazy(() =>
  import("./AdminDashboardClient").then(({ AdminDashboardClient }) => ({
    default: () => <AdminDashboardClient mode="analysis" />,
  }))
);
const AdminMenuRoute = lazy(() =>
  import("./menu/AdminMenuClient").then(({ AdminMenuClient }) => ({
    default: AdminMenuClient,
  }))
);
const AdminStaffRoute = lazy(() =>
  import("./staff/AdminStaffClient").then(({ AdminStaffClient }) => ({
    default: AdminStaffClient,
  }))
);
const AdminHoursRoute = lazy(() =>
  import("./cafesetup/AdminHoursClient").then(({ AdminHoursClient }) => ({
    default: AdminHoursClient,
  }))
);
const AdminReviewsRoute = lazy(() =>
  import("./reviews/AdminReviewsClient").then(({ AdminReviewsClient }) => ({
    default: AdminReviewsClient,
  }))
);
const AdminActivityRoute = lazy(() =>
  import("./activity/AdminActivityClient").then(({ AdminActivityClient }) => ({
    default: AdminActivityClient,
  }))
);
const AdminSettingsRoute = lazy(() =>
  import("./settings/AdminSettingsClient").then(({ AdminSettingsClient }) => ({
    default: AdminSettingsClient,
  }))
);

function metaFor(pathname: string) {
  const dateLabel = new Date().toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  if (pathname === "/admin") {
    return {
      documentTitle: "Overview",
      title: "The cafe, in numbers.",
      contextLabel: "Admin · Overview",
      contextTitle: dateLabel,
    };
  }
  if (
    pathname.startsWith("/admin/analytics") ||
    pathname.startsWith("/admin/analysis")
  ) {
    return {
      documentTitle: pathname.startsWith("/admin/analysis")
        ? "Business Analysis"
        : "Analytics",
      title: "Business analysis.",
      contextLabel: "Admin · Analysis",
      contextTitle: dateLabel,
    };
  }
  if (pathname.startsWith("/admin/menu")) {
    return {
      documentTitle: "Menu & accounts",
      title: "Menu.",
      contextLabel: "Admin · Menu",
      contextTitle: "Menu management",
    };
  }
  if (pathname.startsWith("/admin/staff")) {
    return {
      documentTitle: "Staff management",
      title: "Staff management.",
      contextLabel: "Admin · Staff management",
      contextTitle: "Team accounts",
    };
  }
  if (pathname.startsWith("/admin/cafesetup")) {
    return {
      documentTitle: "Cafe setup",
      title: "Cafe setup.",
      contextLabel: "Admin · Cafe setup",
      contextTitle: "Cafe details",
    };
  }
  if (pathname.startsWith("/admin/reviews")) {
    return {
      documentTitle: "Reviews",
      title: "Customer reviews.",
      contextLabel: "Admin · Reviews",
      contextTitle: "Reviews",
    };
  }
  if (pathname.startsWith("/admin/activity")) {
    return {
      documentTitle: "Activity log",
      title: "Activity log.",
      contextLabel: "Admin · Activity",
      contextTitle: "Recent activity",
    };
  }
  if (pathname.startsWith("/admin/settings")) {
    return {
      documentTitle: "Settings",
      title: "Admin settings.",
      contextLabel: "Admin · Settings",
      contextTitle: "Account preferences",
    };
  }
  return {
    documentTitle: "Admin console",
    title: "Admin console.",
    contextLabel: "Admin",
    contextTitle: dateLabel,
  };
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const meta = metaFor(pathname);
  useEffect(() => {
    document.title = `${meta.documentTitle} · Merrylane Cafe`;
  }, [meta.documentTitle]);

  let routeContent = children;
  if (pathname === "/admin") {
    routeContent = <AdminOverviewRoute />;
  } else if (pathname.startsWith("/admin/analytics") || pathname.startsWith("/admin/analysis")) {
    routeContent = <AdminAnalyticsRoute />;
  } else if (pathname.startsWith("/admin/menu")) {
    routeContent = <AdminMenuRoute />;
  } else if (pathname.startsWith("/admin/staff")) {
    routeContent = <AdminStaffRoute />;
  } else if (pathname.startsWith("/admin/cafesetup")) {
    routeContent = <AdminHoursRoute />;
  } else if (pathname.startsWith("/admin/reviews")) {
    routeContent = <AdminReviewsRoute />;
  } else if (pathname.startsWith("/admin/activity")) {
    routeContent = <AdminActivityRoute />;
  } else if (pathname.startsWith("/admin/settings")) {
    routeContent = <AdminSettingsRoute />;
  }

  return (
    <PortalShell
      area="admin"
      title={meta.title}
      contextLabel={meta.contextLabel}
      contextTitle={meta.contextTitle}
      nav={adminNav}
    >
      <Suspense fallback={<PortalPageSkeleton area="admin" />}>
        {routeContent}
      </Suspense>
    </PortalShell>
  );
}
