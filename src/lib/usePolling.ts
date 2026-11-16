"use client";

import { useEffect, useRef } from "react";
import {
  onPortalDataChanged,
  type PortalDataResource,
} from "@/lib/portalPrefetch";

interface PollingOptions {
  /** Run once as soon as the component mounts. Defaults to true. */
  immediate?: boolean;
  /** Refresh immediately when a related mutation is made in this or another tab. */
  resources?: PortalDataResource[];
  /** Temporarily disable refreshes without unmounting the client. */
  enabled?: boolean;
}

export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options: PollingOptions = {}
) {
  const callbackRef = useRef(callback);
  const immediate = options.immediate !== false;
  const enabled = options.enabled !== false;
  const resourcesRef = useRef(options.resources);
  const enabledRef = useRef(enabled);
  const mountedRef = useRef(false);

  useEffect(() => {
    callbackRef.current = callback;
    resourcesRef.current = options.resources;
    enabledRef.current = enabled;
  }, [callback, enabled, options.resources]);

  useEffect(() => {
    let running = false;
    let rerunAfterCurrent = false;
    const run = async () => {
      if (!enabledRef.current || document.visibilityState === "hidden") return;
      if (running) {
        rerunAfterCurrent = true;
        return;
      }
      running = true;
      try {
        await callbackRef.current();
      } finally {
        running = false;
        if (rerunAfterCurrent) {
          rerunAfterCurrent = false;
          queueMicrotask(() => void run());
        }
      }
    };
    const unsubscribe = onPortalDataChanged((detail) => {
      const resources = resourcesRef.current;
      if (
        !resources ||
        detail.resources.some((resource) => resources.includes(resource))
      ) {
        void run();
      }
    });
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && enabledRef.current) {
        void run();
      }
    };

    if (enabled && (immediate || mountedRef.current)) void run();
    mountedRef.current = true;
    const timer = window.setInterval(() => {
      if (enabledRef.current) void run();
    }, intervalMs);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribe();
    };
  }, [enabled, immediate, intervalMs]);
}

export function useRealtimeRefresh(
  callback: () => void | Promise<void>,
  resources?: PortalDataResource[]
) {
  const callbackRef = useRef(callback);
  const resourcesRef = useRef(resources);

  useEffect(() => {
    callbackRef.current = callback;
    resourcesRef.current = resources;
  }, [callback, resources]);

  useEffect(() => {
    let running = false;
    let rerunAfterCurrent = false;
    const run = async () => {
      if (document.visibilityState === "hidden") return;
      if (running) {
        rerunAfterCurrent = true;
        return;
      }
      running = true;
      try {
        await callbackRef.current();
      } finally {
        running = false;
        if (rerunAfterCurrent) {
          rerunAfterCurrent = false;
          queueMicrotask(() => void run());
        }
      }
    };
    const unsubscribe = onPortalDataChanged((detail) => {
      const watchedResources = resourcesRef.current;
      if (
        !watchedResources ||
        detail.resources.some((resource) => watchedResources.includes(resource))
      ) {
        void run();
      }
    });
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void run();
    };
    window.addEventListener("focus", onVisibilityChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onVisibilityChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribe();
    };
  }, []);
}
