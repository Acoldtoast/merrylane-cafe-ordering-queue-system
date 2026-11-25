"use client";

import { useEffect, useState } from "react";

export type StaffIdDuplicateState = "idle" | "checking" | "unique" | "duplicate" | "unavailable";

/**
 * Checks whether the ID number in the form is already attached to another
 * account. Inputs that change while a request is in flight never show a stale
 * "Passed" result.
 */
export function useStaffIdDuplicateCheck(
  idType: string,
  number: string,
  enabled: boolean
): StaffIdDuplicateState {
  const key = `${idType}|${number.trim()}`;
  const [result, setResult] = useState<{ key: string; value: StaffIdDuplicateState }>({
    key: "",
    value: "idle",
  });

  useEffect(() => {
    if (!enabled || !idType || !number.trim()) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/admin/staff/id-duplicate-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_type: idType, number: number.trim() }),
        });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok || typeof data.duplicate !== "boolean") {
          setResult({ key, value: "unavailable" });
        } else {
          setResult({ key, value: data.duplicate ? "duplicate" : "unique" });
        }
      } catch {
        if (!cancelled) setResult({ key, value: "unavailable" });
      }
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, idType, key, number]);

  if (!enabled || !idType || !number.trim()) return "idle";
  return result.key === key ? result.value : "checking";
}
