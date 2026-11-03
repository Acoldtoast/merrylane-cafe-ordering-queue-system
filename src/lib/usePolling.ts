"use client";

import { useEffect, useRef } from "react";

interface PollingOptions {
  /** Run once as soon as the component mounts. Defaults to true. */
  immediate?: boolean;
}

export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options: PollingOptions = {}
) {
  const callbackRef = useRef(callback);
  const immediate = options.immediate !== false;

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    let running = false;
    const run = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        await callbackRef.current();
      } finally {
        running = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void run();
    };

    if (immediate) void run();
    const timer = window.setInterval(() => void run(), intervalMs);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [immediate, intervalMs]);
}
