"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityRow, type ActivityLogItem } from "@/components/ActivityFeed";
import { ActivityDetailsDialog } from "@/components/ActivityDetailsDialog";
import { SkeletonRows } from "@/components/PortalSkeletonPrimitives";
import {
  calendarDate,
  dayHeading,
  localDayKey,
} from "@/lib/format";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { usePolling } from "@/lib/usePolling";

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
  const todayKey = localDayKey(new Date());
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(todayKey);
  const [area, setArea] = useState("");
  const [selectedActivity, setSelectedActivity] = useState<{
    log: ActivityLogItem;
    trigger: HTMLButtonElement;
  } | null>(null);
  const requestId = useRef(0);

  const fetchPage = useCallback(
    async (nextPage: number, append: boolean, preserveLoaded = false) => {
      const id = ++requestId.current;
      if (append) setLoadingMore(true);
      else if (!preserveLoaded) setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          page_size: "30",
        });
        if (date) params.set("date", date);
        if (area) params.set("area", area);
        const response = await fetchPortalApi(`/api/activity?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to load the activity log.");
        }
        if (id !== requestId.current) return;
        const incoming = (data.logs || []) as ActivityLogItem[];
        setLogs((current) => {
          if (append) {
            const existingIds = new Set(current.map((log) => log.id));
            return [...current, ...incoming.filter((log) => !existingIds.has(log.id))];
          }
          if (!preserveLoaded) return incoming;
          const incomingIds = new Set(incoming.map((log) => log.id));
          return [...incoming, ...current.filter((log) => !incomingIds.has(log.id))];
        });
        setTotal(Number(data.total) || 0);
        if (!preserveLoaded) setPage(nextPage);
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
          if (!preserveLoaded) setLoading(false);
          if (append) setLoadingMore(false);
        }
      }
    },
    [area, date]
  );

  useEffect(() => {
    void fetchPage(1, false);
  }, [fetchPage]);

  const refreshLatest = useCallback(() => {
    if (loading || loadingMore) return;
    return fetchPage(1, false, true);
  }, [fetchPage, loading, loadingMore]);

  usePolling(refreshLatest, 15_000, { immediate: false });

  const openDetails = (log: ActivityLogItem, trigger: HTMLButtonElement) => {
    setSelectedActivity({ log, trigger });
  };

  const closeDetails = () => setSelectedActivity(null);

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
    <>
      {error && (
        <div className="error-strip" style={{ marginBottom: 13 }}>
          {error}
        </div>
      )}

      <div className="section-bar activity-section-bar">
        <div className="section-bar-tools">
          <div className="segmented" role="group" aria-label="Activity day">
            <button
              type="button"
              className={date === todayKey ? "active" : ""}
              aria-pressed={date === todayKey}
              onClick={() => setDate(todayKey)}
            >
              Today
            </button>
            <button
              type="button"
              className={date === "" ? "active" : ""}
              aria-pressed={date === ""}
              onClick={() => setDate("")}
            >
              All days
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
            className="select activity-area-filter"
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
        </div>
        <p className="activity-event-count">
          {total} event{total === 1 ? "" : "s"}
        </p>
      </div>

      <div className="panel">
        <div className="panel-body tight">
          {loading && logs.length === 0 ? (
            <div role="status" aria-busy="true" aria-label="Loading activity log">
              <SkeletonRows count={4} />
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
                      <ActivityRow
                        key={log.id}
                        log={log}
                        onSelect={openDetails}
                      />
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
      {selectedActivity && (
        <ActivityDetailsDialog
          log={selectedActivity.log}
          onClose={closeDetails}
          returnFocusTo={selectedActivity.trigger}
        />
      )}
    </>
  );
}
