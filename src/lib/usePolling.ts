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

/** Spreads refresh times so many open phones do not poll in lockstep. */
function jitterFor(intervalMs: number): number {
  return Math.floor(Math.random() * Math.min(intervalMs * 0.1, 1500));
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
    let stopped = false;
    let failures = 0;
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    function schedule() {
      if (stopped) return;
      clearTimer();
      const backoff =
        failures > 0
          ? Math.min(intervalMs * 2 ** failures, 5 * 60_000)
          : intervalMs;
      timer = window.setTimeout(() => void run(), backoff + jitterFor(intervalMs));
    }

    async function run() {
      if (stopped) return;
      if (!enabledRef.current || document.visibilityState === "hidden") {
        schedule();
        return;
      }
      if (running) {
        rerunAfterCurrent = true;
        return;
      }
      clearTimer();
      running = true;
      try {
        await callbackRef.current();
        failures = 0;
      } catch (error) {
        // A failing endpoint should not be hammered at full rate.
        failures = Math.min(failures + 1, 5);
        console.warn("Portal refresh failed; retrying more slowly.", error);
      } finally {
        running = false;
        if (stopped) return;
        if (rerunAfterCurrent) {
          rerunAfterCurrent = false;
          void run();
        } else {
          schedule();
        }
      }
    }

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

    const firstRun = !mountedRef.current;
    mountedRef.current = true;
    if (enabled && (immediate || !firstRun)) void run();
    else schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimer();
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
