"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icons";
import { LoadingDots } from "@/components/LoadingDots";
import { useCustomer } from "@/components/CustomerProvider";
import type { OrderingWindow } from "@/lib/models";

export function WelcomeClient({
  initialTable,
  initialConnected,
  wifiSsid,
  initialOpening,
  initialClosing,
  initialLastOrder,
  initialOpen,
  initialOrdering,
}: {
  initialTable: number;
  initialConnected: boolean;
  wifiSsid: string;
  initialOpening: string;
  initialClosing: string;
  initialLastOrder: string;
  initialOpen: boolean;
  initialOrdering?: OrderingWindow | null;
}) {
  const router = useRouter();
  const { setTable } = useCustomer();
  const [connected, setConnected] = useState(initialConnected);
  const [checking, setChecking] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [hint, setHint] = useState("");
  const opening = formatTime(initialOpening);
  const closing = formatTime(initialClosing);
  const lastOrder = formatTime(initialLastOrder);
  const open = initialOpen;
  const opensAt = initialOrdering?.opens_at
    ? formatTime(initialOrdering.opens_at)
    : opening;
  const nextOpening = initialOrdering?.next_opening ?? null;
  const nextOpeningAt = nextOpening ? formatTime(nextOpening.start) : null;
  const menuPath = `/customer/menu?table=${initialTable}`;
  const hoursPath = `/customer/hours?table=${initialTable}`;
  const reopenText =
    nextOpening && nextOpeningAt
      ? `${nextOpening.day} at ${nextOpeningAt}`
      : initialOrdering
        ? `${
            initialOrdering.opens_tomorrow
              ? "tomorrow"
              : initialOrdering.opens_day !== initialOrdering.today
                ? `on ${initialOrdering.opens_day}`
                : "today"
          } at ${opensAt}`
        : `at ${opensAt}`;

  useEffect(() => {
    setTable(initialTable);
  }, [initialTable, setTable]);

  // On the cafe network there is nothing to confirm — open the menu for the
  // guest automatically. When we're closed, stay on this screen so the closed
  // notice and reopening time are not skipped.
  useEffect(() => {
    if (!connected || !open) return;
    const timer = window.setTimeout(() => router.replace(menuPath), 1100);
    return () => window.clearTimeout(timer);
  }, [connected, menuPath, open, router]);

  // If the phone joins the cafe Wi-Fi while this screen is open, detect it and
  // continue without a tap.
  useEffect(() => {
    if (connected) return;
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch("/api/network", { cache: "no-store" });
        const data = await response.json();
        if (!cancelled && data.connected) setConnected(true);
      } catch {
        // Try again on the next poll.
      }
    };
    const timer = window.setInterval(check, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connected]);

  const checkConnection = async () => {
    setChecking(true);
    setHint("");
    try {
      const response = await fetch("/api/network", { cache: "no-store" });
      const data = await response.json();
      if (data.connected) {
        setConnected(true);
      } else {
        setHint(
          `We can't see ${wifiSsid} yet. Join it and try again, or skip for now.`
        );
      }
    } catch {
      setHint("Could not check the network. Please try again.");
    } finally {
      setChecking(false);
    }
  };

  const skip = async () => {
    setSkipping(true);
    setHint("");
    try {
      const response = await fetch("/api/network", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "skip" }),
      });
      if (!response.ok) throw new Error("Could not skip the network check.");
      router.push(menuPath);
    } catch (err: unknown) {
      setHint(err instanceof Error ? err.message : "Could not open the menu.");
      setSkipping(false);
    }
  };

  return (
    <div className="welcome-shell">
      <section className="welcome-desktop-side">
        <span className="eyebrow">Table {String(initialTable).padStart(2, "0")} · Merrylane Cafe</span>
        <h1>
          A warm welcome,
          <br />
          <em>just for you.</em>
        </h1>
        <p>
          Settle in. Your table is ready, the espresso is pulling, and the pastry
          case is full. Browse the menu and order without leaving your seat.
        </p>
        <div className="welcome-side-rule" />
        <div className="welcome-side-meta">
          <span>
            <b>{open ? "Open now" : "Sorry, we're closed"}</b>
            {open
              ? "Kitchen is taking orders"
              : `Reopens ${reopenText}`}
          </span>
          {open ? (
            <>
              <span>
                <b>{opening}</b>
                Doors open
              </span>
              <span>
                <b>{lastOrder}</b>
                Last order
              </span>
            </>
          ) : (
            <span>
              <b>
                {nextOpening
                  ? `${nextOpening.day} · ${formatTime(
                      nextOpening.start
                    )}`
                  : opensAt}
              </b>
              Next opening
            </span>
          )}
        </div>
      </section>

      <section className="welcome-wrap">
        {!open && (
          <div className="welcome-closed" role="status">
            <span className="welcome-closed-icon">
              <Icon name="sad" size={22} />
            </span>
            <div>
              <strong>Sorry, the shop is closed.</strong>
              <span>
                We reopen {reopenText}. Ordering isn&apos;t available right now.
              </span>
            </div>
          </div>
        )}
        <div className="welcome-card">
          <div className="signal-orbit">
            <Icon name="wifi" />
          </div>
          <h1 className="welcome-title">
            {connected ? "You're on the cafe network." : "Connect to Merrylane Wi-Fi"}
          </h1>
          <p className="welcome-copy">
            {connected ? (
              open ? (
                <>
                  We can see <strong>{wifiSsid}</strong>. Opening the menu for table{" "}
                  {String(initialTable).padStart(2, "0")}…
                </>
              ) : (
                <>
                  We can see <strong>{wifiSsid}</strong>. Ordering reopens{" "}
                  {reopenText} — you&apos;re welcome to browse the menu until then.
                </>
              )
            ) : (
              <>
                This table menu is available on the cafe network. Join{" "}
                <strong>{wifiSsid}</strong>, and this page will continue
                automatically.
              </>
            )}
          </p>

          <div className="wifi-box">
            <div className="wifi-row">
              <div>
                <div className="wifi-label">Cafe network</div>
                <div className="wifi-value">{wifiSsid}</div>
              </div>
              <span className={`badge ${connected ? "badge-green" : "badge-red"}`}>
                {connected ? "Connected" : "Not connected"}
              </span>
            </div>
            <div className="wifi-row">
              <span className="wifi-state">
                <Icon name="lock" size={11} /> Ask a barista for the password
              </span>
              <span className="wifi-state good">
                <span className="dot" /> Table {String(initialTable).padStart(2, "0")}
              </span>
            </div>
          </div>

          {hint && <div className="error-strip welcome-network-hint">{hint}</div>}

          <div className="welcome-help">
            <span className="welcome-help-note">
              {connected ? "Detected automatically" : "Already on the cafe Wi-Fi?"}
            </span>
            <Link href="/network-required">Connection help</Link>
          </div>

          <div className="welcome-actions">
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={
                open
                  ? connected
                    ? () => router.push(menuPath)
                    : checkConnection
                  : () => router.push(hoursPath)
              }
              disabled={checking}
            >
              {!open ? (
                <>
                  <Icon name="clock" /> See when we open
                </>
              ) : connected ? (
                <>
                  Open the menu <Icon name="arrow-right" className="icon-sm" />
                </>
              ) : checking ? (
                <>
                  <span className="spinner spinner-light" style={{ width: 15, height: 15 }} />
                  Checking the network…
                </>
              ) : (
                <>
                  <Icon name="wifi" /> I&apos;m connected
                </>
              )}
            </button>
            {!connected && (
              <button
                type="button"
                className="btn btn-ghost btn-block btn-sm"
                style={{ marginTop: 4 }}
                onClick={skip}
                disabled={skipping}
              >
                {skipping ? <LoadingDots label="Opening the menu" /> : "Skip for now"}
              </button>
            )}
          </div>

          <div className="welcome-meta">
            Merrylane Cafe · Lipa City, Batangas
            <br />
            {open ? (
              <>Open today until {closing} · Last order {lastOrder}</>
            ) : (
              <>Sorry, the shop is closed · Reopens {reopenText}</>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function formatTime(value?: string) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  });
}
