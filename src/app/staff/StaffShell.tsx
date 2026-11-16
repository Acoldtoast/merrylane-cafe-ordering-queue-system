"use client";

import { usePathname } from "next/navigation";
import { Suspense, lazy, useEffect } from "react";
import { PortalShell } from "@/components/PortalShell";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import { staffNav } from "@/components/portalNav";

const StaffBoardRoute = lazy(() =>
  import("./StaffBoardClient").then(({ StaffBoardClient }) => ({
    default: StaffBoardClient,
  }))
);
const StaffPaymentsRoute = lazy(() =>
  import("./payments/StaffPaymentsClient").then(({ StaffPaymentsClient }) => ({
    default: StaffPaymentsClient,
  }))
);
const StaffReceiptsRoute = lazy(() =>
  import("./receipt/StaffReceiptsClient").then(({ StaffReceiptsClient }) => ({
    default: StaffReceiptsClient,
  }))
);
const StaffStockRoute = lazy(() =>
  import("./stock/StaffStockClient").then(({ StaffStockClient }) => ({
    default: StaffStockClient,
  }))
);
const StaffSalesRoute = lazy(() =>
  import("./sales/StaffSalesClient").then(({ StaffSalesClient }) => ({
    default: () => <StaffSalesClient initialDate={manilaDate()} />,
  }))
);
const StaffRequestsRoute = lazy(() =>
  import("./requests/StaffRequestsClient").then(({ StaffRequestsClient }) => ({
    default: StaffRequestsClient,
  }))
);

function manilaDate() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function metaFor(pathname: string) {
  if (pathname === "/staff") {
    return {
      title: "Every order, in its place.",
      contextLabel: "Service · Order board",
      contextTitle: "Live order queue",
    };
  }
  if (pathname.startsWith("/staff/payments")) {
    return {
      title: "Payment checks.",
      contextLabel: "Service · Payments",
      contextTitle: "Payment review",
    };
  }
  if (pathname.startsWith("/staff/receipt")) {
    return {
      title: "Receipt.",
      contextLabel: "Service · Receipt",
      contextTitle: "Verified payments",
    };
  }
  if (pathname.startsWith("/staff/requests")) {
    return {
      title: "Waiter requests.",
      contextLabel: "Service · Requests",
      contextTitle: "Waiter calls",
    };
  }
  if (pathname.startsWith("/staff/sales")) {
    return {
      title: "Sales.",
      contextLabel: "Service · Sales",
      contextTitle: "Sales",
    };
  }
  if (pathname.startsWith("/staff/stock")) {
    return {
      title: "Portions left.",
      contextLabel: "Service · Stock",
      contextTitle: "Inventory",
    };
  }
  return {
    title: "Service console.",
    contextLabel: "Service",
    contextTitle: "Service",
  };
}

export function StaffShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const meta = metaFor(pathname);
  useEffect(() => {
    const title = pathname === "/staff"
      ? "Order board"
      : pathname.startsWith("/staff/payments")
        ? "Payment checks"
        : pathname.startsWith("/staff/receipt")
          ? "Receipt"
        : pathname.startsWith("/staff/requests")
          ? "Waiter requests"
          : pathname.startsWith("/staff/sales")
            ? "Sales"
            : pathname.startsWith("/staff/stock")
              ? "Portions left"
              : "Service console";
    document.title = `${title} · Merrylane Cafe`;
  }, [pathname]);

  let routeContent = children;
  if (pathname === "/staff") {
    routeContent = <StaffBoardRoute />;
  } else if (pathname.startsWith("/staff/payments")) {
    routeContent = <StaffPaymentsRoute />;
  } else if (pathname.startsWith("/staff/receipt")) {
    routeContent = <StaffReceiptsRoute />;
  } else if (pathname.startsWith("/staff/requests")) {
    routeContent = <StaffRequestsRoute />;
  } else if (pathname.startsWith("/staff/sales")) {
    routeContent = <StaffSalesRoute />;
  } else if (pathname.startsWith("/staff/stock")) {
    routeContent = <StaffStockRoute />;
  }

  return (
    <PortalShell
      area="staff"
      title={meta.title}
      contextLabel={meta.contextLabel}
      contextTitle={meta.contextTitle}
      nav={staffNav}
    >
      <Suspense fallback={<PortalPageSkeleton area="staff" />}>
        {routeContent}
      </Suspense>
    </PortalShell>
  );
}
