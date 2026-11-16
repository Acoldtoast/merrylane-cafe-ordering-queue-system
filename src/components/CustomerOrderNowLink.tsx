"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { prefetchPortalRouteData } from "@/lib/portalPrefetch";
import { preloadPortalRouteCode } from "@/lib/preloadPortalRouteCode";

export function CustomerOrderNowLink({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const href = "/customer/menu?table=7";
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
