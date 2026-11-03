"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { LoadingDots } from "@/components/LoadingDots";

export function NetworkHelpClient({
  ssid,
  nextPath,
}: {
  ssid: string;
  nextPath: string;
}) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const response = await fetch("/api/network", { cache: "no-store" });
        const data = await response.json();
        if (cancelled) return;
        if (data.connected) {
          router.replace(nextPath);
          return;
        }
      } catch {
        // Keep waiting; the next poll may succeed.
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    check();
    const timer = window.setInterval(check, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [nextPath, router]);

  const skip = async () => {
    setSkipping(true);
    setError("");
    try {
      const response = await fetch("/api/network", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "skip" }),
      });
      if (!response.ok) throw new Error("Could not skip the network check.");
      router.replace(nextPath);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not open the menu.");
      setSkipping(false);
    }
  };

  return (
    <div className="customer-app">
      <header className="customer-topbar">
        <div className="customer-topbar-inner">
          <Brand href="/" />
        </div>
      </header>
      <main className="customer-main">
        <div className="state-page">
          <div className="state-card">
            <div className="state-icon">
              <Icon name="wifi" />
            </div>
            <span className="eyebrow" style={{ color: "var(--brown)" }}>
              Network check
            </span>
            <h1 style={{ marginTop: 9 }}>Connect to our Wi-Fi.</h1>
            <p>
              The Merrylane table menu is available on the cafe network. Join{" "}
              <strong>{ssid}</strong> and this page will open the menu
              automatically.
            </p>
            <div className="state-hours">
              <span>Cafe network</span>
              <b>{ssid}</b>
            </div>
            <div className="network-wait" aria-live="polite">
              {checking ? <span className="spinner" /> : <span className="dot" />}
              <span>
                {checking
                  ? "Checking your connection…"
                  : `Waiting for ${ssid}. We'll open the menu as soon as you're connected.`}
              </span>
            </div>
            {error && <div className="error-strip">{error}</div>}
            <div className="network-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setChecking(true);
                  fetch("/api/network", { cache: "no-store" })
                    .then((response) => response.json())
                    .then((data) => {
                      if (data.connected) router.replace(nextPath);
                    })
                    .catch(() => {})
                    .finally(() => setChecking(false));
                }}
              >
                <Icon name="refresh" className="icon-sm" /> Check again
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={skip}
                disabled={skipping}
              >
                {skipping ? <LoadingDots label="Opening" /> : "Skip for now"}
              </button>
            </div>
            <Link href="/" className="network-home-link">
              Back to cafe home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
