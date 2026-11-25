"use client";

import { useEffect, useRef, useState } from "react";

export function useQuantityLimitWarning<Key extends string | number>() {
  const [warningKey, setWarningKey] = useState<Key | null>(null);
  const timeout = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timeout.current), []);

  function warn(key: Key) {
    window.clearTimeout(timeout.current);
    setWarningKey(key);
    timeout.current = window.setTimeout(() => setWarningKey(null), 2500);
  }

  return { warningKey, warn };
}
