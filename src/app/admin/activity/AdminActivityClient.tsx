"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { adminNav } from "@/components/portalNav";
import { Icon } from "@/components/Icons";
import { ActivityRow, type ActivityLogItem } from "@/components/ActivityFeed";
import {
  calendarDate,
  dayHeading,
  localDayKey,
} from "@/lib/format";

const AREAS = [
  "Payments",
  "Orders",
  "Stock",
  "Menu",
  "Add-ons",
  "Settings",
  "Requests",
  "Accounts",
  "Access",
];

export function AdminActivityClient() {
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState("");
  const [area, setArea] = useState("");
  const requestId = useRef(0);
  const todayKey = localDayKey(new Date());

  const fetchPage = useCallback(
    async (nextPage: number, append: boolean) => {
      const id = ++requestId.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          page_size: "30",
        });
        if (date) params.set("date", date);
        if (area) params.set("area", area);
        const response = await fetch(`/api/activity?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to load the activity log.");
        }
        if (id !== requestId.current) return;
        const incoming = (data.logs || []) as ActivityLogItem[];
        setLogs((current) => (append ? [...current, ...incoming] : incoming));
        setTotal(Number(data.total) || 0);
        setPage(nextPage);
        setError("");
      } catch (err: unknown) {
        if (id === requestId.current) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load the activity log."
          );
        }
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [area, date]
  );

  useEffect(() => {
    void fetchPage(1, false);
  }, [fetchPage]);

  const groups = useMemo(() => {
    const ordered: {
      key: string;
      heading: string;
      subheading: string;
      logs: ActivityLogItem[];
    }[] = [];
    for (const log of logs) {
      const key = localDayKey(log.created_at);
      let group = ordered[ordered.length - 1];
      if (!group || group.key !== key) {
        const heading = dayHeading(log.created_at);
        group = {
          key,
          heading,
          // Only repeat the date when the heading is relative ("Today"),
          // otherwise the heading already carries the calendar day.
          subheading:
            heading === "Today" || heading === "Yesterday"
              ? calendarDate(log.created_at)
              : "",
          logs: [],
        };
        ordered.push(group);
      }
      group.logs.push(log);
    }
    return ordered;
  }, [logs]);

  return (
    <PortalShell
      area="admin"
      title="A record of what happens."
      subtitle="Payments, orders, stock, and people — newest first."
      contextLabel="Admin · Activity"
      contextTitle="Every recorded action"
      nav={adminNav}
    >
      {error && (
        <div className="error-strip" style={{ marginBottom: 13 }}>
          {error}
        </div>
      )}

      <div className="section-bar">
        <div>
          <h2>Activity log</h2>
          <p>
            {total} event{total === 1 ? "" : "s"}{" "}
            {date
              ? `on ${calendarDate(`${date}T12:00:00`)}`
              : "across every day"}{" "}
            · newest first
          </p>
        </div>
        <div className="section-bar-tools">
          <div className="segmented" role="group" aria-label="Activity day">
            <button
              type="button"
              className={date === "" ? "active" : ""}
              aria-pressed={date === ""}
              onClick={() => setDate("")}
            >
              All days
            </button>
            <button
              type="button"
              className={date === todayKey ? "active" : ""}
              aria-pressed={date === todayKey}
              onClick={() => setDate(todayKey)}
            >
              Today
            </button>
          </div>
          <input
            type="date"
            className="input activity-date"
            value={date}
            max={todayKey}
            aria-label="Choose a day"
            onChange={(event) => setDate(event.target.value)}
          />
          <select
            className="select"
            value={area}
            aria-label="Filter by area"
            onChange={(event) => setArea(event.target.value)}
          >
            <option value="">All areas</option>
            {AREAS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={() => void fetchPage(1, false)}
            disabled={loading}
          >
            <Icon name="refresh" className="icon-sm" /> Refresh
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body tight">
          {loading && logs.length === 0 ? (
            <div className="loading-block">
              <span className="spinner" /> Reading the log…
            </div>
          ) : logs.length === 0 ? (
            <div className="empty-panel" style={{ border: 0 }}>
              {date
                ? "No activity was recorded on this day."
                : "No activity recorded yet."}
            </div>
          ) : (
            <>
              {groups.map((group) => (
                <section className="activity-day" key={group.key}>
                  <header className="activity-day-head">
                    <strong>{group.heading}</strong>
                    {group.subheading && <span>{group.subheading}</span>}
                  </header>
                  <ul className="activity-list">
                    {group.logs.map((log) => (
                      <ActivityRow key={log.id} log={log} />
                    ))}
                  </ul>
                </section>
              ))}
              {logs.length < total && (
                <div className="activity-more">
                  <button
                    type="button"
                    className="btn btn-soft"
                    disabled={loadingMore}
                    onClick={() => void fetchPage(page + 1, true)}
                  >
                    {loadingMore ? (
                      <>
                        <span className="spinner" /> Loading…
                      </>
                    ) : (
                      <>Load older activity</>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
