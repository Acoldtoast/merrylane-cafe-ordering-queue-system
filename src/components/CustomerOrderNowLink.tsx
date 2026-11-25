"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { prefetchPortalRouteData } from "@/lib/portalPrefetch";
import { preloadPortalRouteCode } from "@/lib/preloadPortalRouteCode";

export function CustomerOrderNowLink({
  className,
  children,
  href = "/customer/menu?table=7",
}: {
  className: string;
  children: React.ReactNode;
  href?: string;
}) {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    router.prefetch(href);
    void preloadPortalRouteCode("customer", href);
    prefetchPortalRouteData("customer", href);
  }, [href, router]);

  return (
    <button
      type="button"
      className={className}
      disabled={navigating}
      onClick={() => {
        setNavigating(true);
        router.prefetch(href);
        void preloadPortalRouteCode("customer", href);
        prefetchPortalRouteData("customer", href);
        router.push(href);
      }}
    >
      {navigating ? (
        <>
          <span className="spinner spinner-light" style={{ width: 14, height: 14 }} />
          Loading...
        </>
      ) : (
        children
      )}
    </button>
  );
}
