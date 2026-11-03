"use client";

import { useCallback, useState } from "react";
import { Icon } from "@/components/Icons";
import { usePolling } from "@/lib/usePolling";

interface DaySchedule {
  day: string;
  open: boolean;
  start: string;
  end: string;
  last_order: string;
}

interface HoursSettings {
  opening_time: string;
  closing_time: string;
  weekly_schedule: DaySchedule[];
}

function formatTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const date = new Date(Date.UTC(2020, 0, 1, hours, minutes));
  return date.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function CustomerHoursClient() {
  const [settings, setSettings] = useState<HoursSettings | null>(null);
  const [orderingOpen, setOrderingOpen] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success || !data.settings) {
        throw new Error(data.error || "Unable to load cafe hours.");
      }
      setSettings(data.settings as HoursSettings);
      setOrderingOpen(Boolean(data.ordering_open));
      setError("");
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load cafe hours."
      );
    }
  }, []);

  usePolling(load, 30_000);

  const today = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "Asia/Manila",
  }).format(new Date());
  const todaySchedule = settings?.weekly_schedule.find((day) => day.day === today);

  return (
    <div className="customer-hours-page">
      <header className="customer-hours-heading">
        <span className="eyebrow">Merrylane Cafe</span>
        <h1>Come by when it suits you.</h1>
        <p>Our opening hours and last-order times, kept up to date by the cafe.</p>
        {settings && (
          <span className={`customer-hours-status ${orderingOpen ? "open" : "closed"}`}>
            <span className="dot" />
            {orderingOpen ? "Open for orders" : "Not taking orders right now"}
          </span>
        )}
      </header>

      {error ? (
        <div className="error-strip" role="alert">{error}</div>
      ) : !settings ? (
        <div className="customer-hours-loading" role="status">
          <span className="spinner" />
          Loading cafe hours…
        </div>
      ) : (
        <div className="customer-hours-grid">
          <section className="customer-hours-card customer-hours-today">
            <div className="customer-hours-card-title">
              <span className="customer-hours-icon"><Icon name="clock" /></span>
              <div>
                <span className="eyebrow">Today · {today}</span>
                <h2>{todaySchedule?.open
                  ? `${formatTime(todaySchedule.start)} – ${formatTime(todaySchedule.end)}`
                  : "Closed today"}</h2>
              </div>
            </div>
            <div className="customer-hours-facts">
              <div>
                <span>Ordering status</span>
                <strong>{orderingOpen ? "Taking orders" : "Currently closed"}</strong>
              </div>
            </div>
          </section>

          <section className="customer-hours-card">
            <div className="customer-hours-week-heading">
              <div>
                <span className="eyebrow">Plan your visit</span>
                <h2>Weekly hours</h2>
              </div>
              <Icon name="calendar" className="icon-sm" />
            </div>
            <div className="customer-hours-week">
              {settings.weekly_schedule.map((day) => (
                <div
                  className={`customer-hours-day ${day.day === today ? "today" : ""}`}
                  key={day.day}
                >
                  <strong>{day.day}</strong>
                  <span>
                    {day.open
                      ? `${formatTime(day.start)} – ${formatTime(day.end)}`
                      : "Closed"}
                  </span>
                  {day.day === today && <small>Today</small>}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
