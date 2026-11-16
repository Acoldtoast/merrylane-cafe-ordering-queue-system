"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icons";
import type { IconName } from "@/components/Icons";
import { CustomerPageSkeleton } from "@/components/CustomerPageSkeleton";
import { useFeedback } from "@/components/Feedback";
import { useCustomer } from "@/components/CustomerProvider";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import type { WaiterRequest } from "@/lib/types";

const reasons: { label: string; icon: IconName; hint: string }[] = [
  { label: "Water refill", icon: "water", hint: "A fresh glass" },
  { label: "Question about my order", icon: "message", hint: "We'll help" },
  { label: "Something else", icon: "help", hint: "Any little thing" },
  { label: "Extra cutlery", icon: "receipt", hint: "Napkins too" },
  { label: "Ask for the bill", icon: "invoice", hint: "Ready when you are" },
];

const DEFAULT_ATTEMPTS: AttemptStatus = {
  limit: 3,
  used: 0,
  remaining: 3,
  next_attempt: 1,
  retry_after_seconds: 0,
  cooldown_active: false,
};

interface AttemptStatus {
  limit: number;
  used: number;
  remaining: number;
  next_attempt: number | null;
  retry_after_seconds: number;
  cooldown_active: boolean;
}

function countdownLabel(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function requestClock(value?: string) {
  if (!value) {
    return new Date().toLocaleTimeString("en-PH", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function WaiterClient({
  initialTable,
  orderId,
}: {
  initialTable: number;
  orderId: number;
}) {
  const { setTable } = useCustomer();
  const feedback = useFeedback();
  const [reason, setReason] = useState(reasons[0].label);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [request, setRequest] = useState<WaiterRequest | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [attempts, setAttempts] = useState<AttemptStatus>(DEFAULT_ATTEMPTS);
  const [checkedHistoryTable, setCheckedHistoryTable] = useState<number | null>(null);
  const checkingHistory = checkedHistoryTable !== initialTable;

  const atLimit = attempts.remaining <= 0;
  const attemptNote = atLimit
    ? "You've used all three waiter calls for today. Please ask a team member directly if you still need anything."
    : attempts.next_attempt === 2
      ? `You have ${attempts.remaining} of ${attempts.limit} waiter calls left today. Your next call unlocks 5 minutes after your last one.`
      : attempts.next_attempt === 3
        ? `You have ${attempts.remaining} of ${attempts.limit} waiter calls left today. Your last call unlocks 10 minutes after your previous one.`
        : `You have ${attempts.remaining} of ${attempts.limit} waiter calls left today. Calls are spaced 5 minutes apart, with 10 minutes before your third.`;

  useEffect(() => {
    setTable(initialTable);
  }, [initialTable, setTable]);

  // Returning to this page during the cooldown should still show the request
  // that was already sent, together with the live countdown.
  useEffect(() => {
    let cancelled = false;
    fetchPortalApi(`/api/waiter?table=${initialTable}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Waiter history request failed (${response.status})`);
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.attempts) {
          setAttempts({ ...DEFAULT_ATTEMPTS, ...data.attempts });
        }
        if (data.cooldown?.active && data.cooldown.request) {
          setRequest(data.cooldown.request as WaiterRequest);
          setRemaining(
            Number(data.cooldown.retry_after_seconds) || 0
          );
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to load waiter request history:", error);
      })
      .finally(() => {
        if (!cancelled) setCheckedHistoryTable(initialTable);
      });
    return () => {
      cancelled = true;
    };
  }, [initialTable]);

  useEffect(() => {
    if (!request) return;
    const timer = window.setInterval(() => {
      setRemaining((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [request]);

  const send = async () => {
    setSubmitting(true);
    feedback.loading("Calling your waiter…", `Letting the team know about table ${initialTable}.`);
    try {
      const response = await fetchPortalApi("/api/waiter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table_number: initialTable,
          order_id: orderId || undefined,
          request_type: reason,
          message,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 429 && data.daily_limit_reached) {
        setAttempts({ ...DEFAULT_ATTEMPTS, ...(data.attempts || {}) });
        setRemaining(0);
        feedback.warning("That's all for today", {
          eyebrow: "3 calls used",
          message:
            "You've used all three waiter calls for today. If you still need help, please ask a team member directly at your table.",
          details: [{ label: "Table", value: String(initialTable).padStart(2, "0") }],
        });
        return;
      }
      if (response.status === 429 && data.request) {
        setRequest(data.request as WaiterRequest);
        if (data.attempts) {
          setAttempts({ ...DEFAULT_ATTEMPTS, ...data.attempts });
        }
        const wait = Number(data.retry_after_seconds) || 0;
        setRemaining(wait);
        feedback.warning("Please wait a little longer", {
          eyebrow: "Calls are spaced out",
          message: `Please wait ${countdownLabel(
            wait
          )} before calling your waiter again. The team is on it.`,
          details: [
            { label: "Table", value: String(initialTable).padStart(2, "0") },
            { label: "Request", value: (data.request as WaiterRequest).request_type },
            { label: "Calls left today", value: String(data.attempts?.remaining ?? 0) },
          ],
        });
        return;
      }
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not send the request.");
      }

      if (data.attempts) {
        setAttempts({ ...DEFAULT_ATTEMPTS, ...data.attempts });
      }
      setRequest((data.request as WaiterRequest) || null);
      setRemaining(Number(data.retry_after_seconds) || 0);
      feedback.success("Your waiter is on the way", {
        eyebrow: "Request received",
        message: `The team knows about table ${String(initialTable).padStart(
          2,
          "0"
        )}. Someone will be with you shortly.`,
        duration: 3000,
        details: [
          { label: "Request", value: reason },
          { label: "Table", value: String(initialTable).padStart(2, "0") },
          ...(message.trim() ? [{ label: "Your note", value: message.trim() }] : []),
          {
            label: "Calls left today",
            value: String(data.attempts?.remaining ?? Math.max(0, attempts.remaining - 1)),
          },
        ],
      });
    } catch (err: unknown) {
      feedback.error("Could not send the request", {
        message:
          err instanceof Error
            ? err.message
            : "Please try again in a moment.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const startAnother = () => {
    setRequest(null);
    setRemaining(0);
    setMessage("");
    setReason(reasons[0].label);
  };

  if (checkingHistory) {
    return <CustomerPageSkeleton />;
  }

  return (
    <div className="waiter-card">
      <Link href={`/customer/menu?table=${initialTable}`} className="back-link">
        <Icon name="chevron-left" /> Back to menu
      </Link>

      {request ? (
        <div className="card waiter-success">
          <div className="heart-badge">
            <Icon name="waiter" />
          </div>
          <span className="eyebrow" style={{ color: "var(--brown)" }}>
            Request received
          </span>
          <h2 style={{ marginTop: 9 }}>Your waiter is on the way.</h2>
          <p>
            We&apos;ve let the team know. Someone will be with you at table{" "}
            {String(initialTable).padStart(2, "0")} shortly.
          </p>
          <div className="waiter-order-note">
            <Icon name="clock" />
            <span>
              <strong>Request made at {requestClock(request.created_at)}</strong>
              <br />
              {request.request_type}
              {request.message ? ` · ${request.message}` : ""}
            </span>
          </div>

          {remaining > 0 && (
            <div className="waiter-cooldown" aria-live="polite">
              <Icon name="clock" />
              <div>
                <strong>
                  Please wait{" "}
                  <span className="waiter-countdown">{countdownLabel(remaining)}</span>{" "}
                  before another request.
                </strong>
                <span>Give the team a few minutes to reach your table.</span>
              </div>
            </div>
          )}

          <div className="payment-note">
            <Icon name="info" />
            <span>{attemptNote}</span>
          </div>

          <div className="confirm-footer">
            <Link
              href={`/customer/status?id=${orderId}&table=${initialTable}`}
              className="btn btn-primary btn-block"
            >
              Back to my order
            </Link>
            <button
              type="button"
              className="btn btn-outline btn-block btn-sm"
              onClick={startAnother}
              disabled={remaining > 0 || atLimit}
            >
              {atLimit
                ? "No calls left today"
                : remaining > 0
                  ? `Send another request in ${countdownLabel(remaining)}`
                  : `Send another request · ${attempts.remaining} left`}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="waiter-intro">
            <span className="eyebrow">Table {String(initialTable).padStart(2, "0")} · At your service</span>
            <h1>A hand at your table.</h1>
            <p>Let us know what you need — no need to flag anyone down.</p>
          </div>

          <div className="card waiter-form">
            <div className="option-head">
              <h3>What can we help with?</h3>
              <span>Choose one</span>
            </div>
            <div className="reason-grid">
              {reasons.map((item) => (
                <label className="reason-option" key={item.label}>
                  <input
                    type="radio"
                    name="waiter-reason"
                    checked={reason === item.label}
                    onChange={() => setReason(item.label)}
                  />
                  <span>
                    <Icon name={item.icon} />
                    {item.label}
                  </span>
                </label>
              ))}
            </div>

            <div className="field">
              <label className="label" htmlFor="waiter-message">
                Add a note <span className="muted">(optional)</span>
              </label>
              <textarea
                id="waiter-message"
                className="textarea"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Two glasses, please. No ice."
                maxLength={200}
              />
            </div>

            <div className="payment-note">
              <Icon name="info" />
              <span>{attemptNote}</span>
            </div>

            <div className="waiter-submit">
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={submitting || atLimit}
                onClick={send}
              >
                {submitting ? (
                  <>
                    <span className="spinner spinner-light" style={{ width: 15, height: 15 }} />
                    Calling your waiter…
                  </>
                ) : atLimit ? (
                  <>No calls left today</>
                ) : (
                  <>
                    Send request
                    {attempts.remaining < attempts.limit
                      ? ` · ${attempts.remaining} left`
                      : ""}
                    <Icon name="arrow-right" className="icon-sm" />
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
