"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

export function useIdleRoutePrefetch(
  paths: string[],
  enabled = true,
  eager = false
) {
  const router = useRouter();
  const pathname = usePathname();
  const pathsKey = paths.join("\n");
  const prefetchedRoutes = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;

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

    const routes = [...new Set(pathsKey.split("\n").filter(Boolean))].filter(
      (path) =>
        path.split("?")[0] !== pathname && !prefetchedRoutes.current.has(path)
    );
    if (!routes.length) return;

    const requestIdle = window.requestIdleCallback?.bind(window);
    const cancelIdle = window.cancelIdleCallback?.bind(window);
    let idleId: number | undefined;
    let timerId: number | undefined;
    let disposed = false;
    let scheduled = false;
    let prefetched = false;

    const prefetchRoutes = () => {
      scheduled = false;
      idleId = undefined;
      timerId = undefined;
      if (disposed || prefetched || document.visibilityState !== "visible") return;
      prefetched = true;

      for (const route of routes) {
        try {
          router.prefetch(route);
          prefetchedRoutes.current.add(route);
        } catch (error: unknown) {
          console.warn(`Could not prefetch route "${route}".`, error);
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        if (idleId !== undefined) cancelIdle?.(idleId);
        if (timerId !== undefined) window.clearTimeout(timerId);
        idleId = undefined;
        timerId = undefined;
        scheduled = false;
        return;
      }
      if (disposed || prefetched || scheduled) return;
      if (eager) {
        prefetchRoutes();
        return;
      }
      scheduled = true;
      if (requestIdle) {
        idleId = requestIdle(prefetchRoutes, { timeout: 600 });
      } else {
        timerId = window.setTimeout(prefetchRoutes, 150);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    onVisibilityChange();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (idleId !== undefined) cancelIdle?.(idleId);
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [eager, enabled, pathname, pathsKey, router]);
}
