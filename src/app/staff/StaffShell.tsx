"use client";

import { usePathname } from "next/navigation";
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
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
const StaffProfileRoute = lazy(() =>
  import("./profile/StaffProfileClient").then(({ StaffProfileClient }) => ({ default: StaffProfileClient }))
);
const StaffFaceCheck = lazy(() =>
  import("./StaffFaceCheck").then(({ StaffFaceCheck }) => ({ default: StaffFaceCheck }))
);
const StaffPasswordChange = lazy(() =>
  import("./StaffPasswordChange").then(({ StaffPasswordChange }) => ({ default: StaffPasswordChange }))
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
  if (pathname.startsWith("/staff/profile")) return { title: "My profile.", contextLabel: "Service · Account", contextTitle: "My profile" };
  if (pathname === "/staff") {
    return {
      title: "Order queue.",
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
      title: "",
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
  const [faceStatus, setFaceStatus] = useState<"loading" | "allowed" | "required" | "unenrolled" | "password" | "error">("loading");
  const refreshFaceStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/face-check", { cache: "no-store" });
      const data = await response.json();
      if (response.status === 401) { window.location.assign(`/login?next=/staff${data.reason === "face_reset" ? "&reason=face_reset" : ""}`); return; }
      if (!response.ok || !data.success) throw new Error("Could not check verification status.");
      setFaceStatus(data.password_change_required ? "password" : data.required ? data.enrolled ? "required" : "unenrolled" : "allowed");
    } catch {
      setFaceStatus("error");
    }
  }, []);
  useEffect(() => {
    void refreshFaceStatus();
    const onRequired = () => { void refreshFaceStatus(); };
    window.addEventListener("staff-face-required", onRequired);
    const timer = window.setInterval(() => { void refreshFaceStatus(); }, 10000);
    return () => { window.removeEventListener("staff-face-required", onRequired); window.clearInterval(timer); };
  }, [refreshFaceStatus]);
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
  } else if (pathname.startsWith("/staff/profile")) {
    routeContent = <StaffProfileRoute />;
  }

  if (faceStatus === "loading") return <PortalPageSkeleton area="staff" />;
  if (faceStatus === "error") return <main className="card"><p role="alert">Could not check face verification status.</p><button type="button" className="btn btn-primary" onClick={() => { void refreshFaceStatus(); }}>Try again</button></main>;
  if (faceStatus === "password") return <main className="card" style={{ maxWidth: 560, margin: "3rem auto", padding: "1.5rem" }}><Suspense fallback={<PortalPageSkeleton area="staff" />}><StaffPasswordChange onChanged={refreshFaceStatus} /></Suspense></main>;
  if (faceStatus === "required" || faceStatus === "unenrolled") {
    return <Suspense fallback={<PortalPageSkeleton area="staff" />}><StaffFaceCheck enrolled={faceStatus === "required"} onVerified={refreshFaceStatus} /></Suspense>;
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
