"use client";

import { useCallback, useEffect, useState } from "react";
import { staffNav } from "@/components/portalNav";
import { Icon } from "@/components/Icons";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import { useFeedback } from "@/components/Feedback";
import type { WaiterRequest } from "@/lib/types";
import { relativeTime, smartDateTime } from "@/lib/format";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { usePolling } from "@/lib/usePolling";

export function StaffRequestsClient() {
  const feedback = useFeedback();
  const [requestsByTable, setRequestsByTable] = useState<Record<number, WaiterRequest[]>>({});
  const [stats, setStats] = useState({
    pending: 0,
    acknowledged: 0,
    resolved_today: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetchPortalApi("/api/waiter", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to load requests.");
      }
      setRequestsByTable(data.requestsByTable || {});
      if (data.stats) setStats(data.stats);
      setError("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(load, 8000, { resources: ["requests", "waiter"] });

  const act = async (request: WaiterRequest, status: "acknowledged" | "resolved") => {
    setBusyId(request.id);
    setError("");
    const table = String(request.table_number).padStart(2, "0");
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi("/api/waiter", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: request.id, status }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not update the request.");
        }
        return data;
      },
      {
        loading: {
          title: status === "resolved" ? "Closing the request…" : "Letting the table know…",
          message: `Table ${table} · ${request.request_type}.`,
        },
        success: () => ({
          eyebrow: status === "resolved" ? "Resolved" : "On the way",
          title:
            status === "resolved"
              ? `Table ${table} request resolved`
              : `Heading to table ${table}`,
          message:
            status === "resolved"
              ? "The request is cleared from the board."
              : "The table can see that someone is coming.",
          duration: 2000,
          details: [
            { label: "Table", value: table },
            { label: "Request", value: request.request_type },
            ...(request.message ? [{ label: "Note", value: request.message }] : []),
          ],
        }),
      }
    );
    if (result.ok) await load();
    setBusyId(null);
  };

  const activeRequests = Object.values(requestsByTable).flat();
  const waiting = activeRequests
    .filter((request) => request.status === "pending")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const onTheWay = activeRequests
    .filter((request) => request.status === "acknowledged")
    .sort((a, b) =>
      (a.acknowledged_at || a.created_at).localeCompare(
        b.acknowledged_at || b.created_at
      )
    );

  const renderRequest = (request: WaiterRequest, acknowledged: boolean) => (
    <article
      className={`order-card ${acknowledged ? "" : "urgent"}`}
      key={request.id}
    >
      <div className="order-card-top">
        <span className="order-code">
          Table {String(request.table_number).padStart(2, "0")}
        </span>
        <span className={`badge ${acknowledged ? "badge-blue" : "badge-amber"}`}>
          {acknowledged ? "On the way" : "Waiting"}
        </span>
      </div>
      <div className="order-table-row">
        <span className="order-table"><strong>{request.request_type}</strong></span>
        <span className="order-time">
          {relativeTime(
            acknowledged
              ? request.acknowledged_at || request.created_at
              : request.created_at
          )}
        </span>
      </div>
      {request.message && (
        <div className="order-items">
          <div className="order-item-line">
            <span style={{ whiteSpace: "normal" }}>“{request.message}”</span>
          </div>
        </div>
      )}
      <div className="order-items">
        <div className="order-item-line">
          <span>Requested</span>
          <span>{smartDateTime(request.created_at)}</span>
        </div>
        {request.order_id && (
          <div className="order-item-line">
            <span>Order</span>
            <span>#{String(request.order_id).padStart(3, "0")}</span>
          </div>
        )}
        {acknowledged && (
          <div className="order-time" style={{ marginTop: 6 }}>
            Automatically resolves after 25 minutes on the way.
          </div>
        )}
      </div>
      {!acknowledged && (
        <div className="order-card-foot">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busyId === request.id}
            onClick={() => act(request, "acknowledged")}
          >
            <Icon name="waiter" className="icon-sm" /> On my way
          </button>
        </div>
      )}
    </article>
  );

  if (loading) return <PortalPageSkeleton area="staff" />;

  return (
    <>
      {error && <div className="error-strip" style={{ marginBottom: 13 }}>{error}</div>}

      <div className="stat-grid">
        <div className="stat-card dark">
          <div className="stat-label">
            <Icon name="bell" /> Waiting now
          </div>
          <div className="stat-value">{stats.pending}</div>
          <div className="stat-bottom">
            <span>Tables hoping to see you</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Icon name="waiter" /> On the way
          </div>
          <div className="stat-value">{stats.acknowledged}</div>
          <div className="stat-bottom">
            <span>Acknowledged requests</span>
          </div>
        </div>
      </div>

      <div className="section-bar section-bar-actions-only">
        <button type="button" className="btn btn-soft btn-sm" onClick={load}>
          <Icon name="refresh" className="icon-sm" /> Refresh
        </button>
      </div>

      {waiting.length + onTheWay.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-icon">
            <Icon name="waiter" />
          </div>
          <h3>No calls right now.</h3>
          Every table is happily settled. We&apos;ll show a request the moment it arrives.
        </div>
      ) : (
        <div className="waiter-request-board">
          <section className="waiter-request-column">
            <div className="waiter-request-column-heading">
              <span className="followup-lane-status">Waiting</span>
              <strong>{waiting.length} requests</strong>
            </div>
            {waiting.length ? (
              <div className="waiter-request-cards">
                {waiting.map((request) => renderRequest(request, false))}
              </div>
            ) : (
              <div className="followup-lane-empty">No waiting requests.</div>
            )}
          </section>
          <section className="waiter-request-column">
            <div className="waiter-request-column-heading">
              <span className="followup-lane-status preparing">On the way</span>
              <strong>{onTheWay.length} requests</strong>
            </div>
            {onTheWay.length ? (
              <div className="waiter-request-cards">
                {onTheWay.map((request) => renderRequest(request, true))}
              </div>
            ) : (
              <div className="followup-lane-empty">No requests in progress.</div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
