"use client";

import { errorMessage } from "@/lib/errorMessage";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CoffeeArt, artKindForCategory } from "@/components/CoffeeArt";
import { Icon } from "@/components/Icons";
import { LoadingDots } from "@/components/LoadingDots";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import { useFeedback } from "@/components/Feedback";
import type { MenuItem } from "@/lib/types";
import { peso } from "@/lib/format";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { isStockAmount, MAX_LOW_STOCK_THRESHOLD, MAX_STOCK_COUNT } from "@/lib/stockLimits";
import { usePolling } from "@/lib/usePolling";

type Filter = "all" | "low" | "out" | "available";
type AvailabilityAction = "available" | "out";

function statusLabel(status: MenuItem["stock_status"]) {
  return status === "available"
    ? "Available"
    : status === "low"
      ? "Low portions"
      : "Sold out";
}

export function StaffStockClient() {
  const feedback = useFeedback();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [confirming, setConfirming] = useState<{
    item: MenuItem;
    action: AvailabilityAction;
  } | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [form, setForm] = useState({
    stock_count: "",
    low_stock_threshold: "",
    stock_status: "available" as "available" | "out",
    stock_scope: "today" as "today" | "until_changed",
    track_stock: false,
  });
  const [savedForm, setSavedForm] = useState<typeof form | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetchPortalApi("/api/stock", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to load menu availability.");
      }
      setItems(data.items || []);
      setError("");
    } catch (err: unknown) {
      setError(errorMessage(err, "Unable to load menu availability."));
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(load, 20000, { resources: ["stock"] });

  useEffect(() => {
    if (!confirming) return;
    confirmButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busyId !== confirming.item.id) {
        setConfirming(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirming, busyId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "available"
            ? item.stock_status === "available"
            : item.stock_status === filter;
      const matchesQuery =
        !query ||
        item.name.toLowerCase().includes(query) ||
        (item.category_name || "").toLowerCase().includes(query);
      return matchesFilter && matchesQuery;
    });
  }, [items, filter, search]);

  const updateAvailability = async (
    item: MenuItem,
    action: AvailabilityAction
  ) => {
    setBusyId(item.id);
    setError("");
    const trackingEnabled =
      action === "out" ||
      (Boolean(item.stock_tracking_enabled) && item.stock_count > 0);
    const stockCount =
      action === "out" ? 0 : trackingEnabled ? item.stock_count : null;
    const stockStatus =
      action === "out"
        ? "out"
        : trackingEnabled && item.stock_count <= item.low_stock_threshold
          ? "low"
          : "available";
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi("/api/stock", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: item.id,
            stock_status: stockStatus,
            manual_out: action === "out",
            stock_scope: item.stock_scope || "today",
            stock_count: stockCount,
            stock_tracking_enabled: trackingEnabled,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not update availability.");
        }
        return data;
      },
      {
        loading: {
          title: "Updating availability…",
          message:
            action === "out"
              ? `Marking ${item.name} as sold out.`
              : `Making ${item.name} available to customers.`,
        },
        success: () => ({
          eyebrow: "Availability updated",
          title: item.name,
          message:
            action === "out"
              ? "Customers now see this as sold out."
              : "Customers can order this item again.",
          duration: 1900,
          details: [{ label: "Status", value: statusLabel(stockStatus) }],
        }),
      }
    );
    if (result.ok) await load();
    setBusyId(null);
    if (result.ok) setConfirming(null);
  };

  const openEdit = (item: MenuItem) => {
    setEditing(item);
    const nextForm: typeof form = {
      stock_count: item.stock_tracking_enabled
        ? String(item.stock_count ?? 0)
        : "",
      low_stock_threshold: String(item.low_stock_threshold ?? 5),
      stock_status: item.stock_manual_out_date ? "out" : "available",
      stock_scope: item.stock_scope || "today",
      track_stock: Boolean(item.stock_tracking_enabled),
    };
    setForm(nextForm);
    setSavedForm(nextForm);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const trackStock = form.track_stock;
    if (trackStock && form.stock_count.trim() === "") {
      setError("Enter the number of portions left for a limited item.");
      return;
    }
    const stockCount = trackStock ? Number(form.stock_count) : null;
    if (trackStock && !isStockAmount(form.stock_count, MAX_STOCK_COUNT)) {
      setError(`The number left must be a whole number from 0 to ${MAX_STOCK_COUNT}.`);
      return;
    }
    const thresholdValue = form.low_stock_threshold || "0";
    if (!isStockAmount(thresholdValue, MAX_LOW_STOCK_THRESHOLD)) {
      setError(`The low-portion threshold must be a whole number from 0 to ${MAX_LOW_STOCK_THRESHOLD}.`);
      return;
    }
    const lowStockThreshold = Number(thresholdValue);
    setBusyId(editing.id);
    setError("");
    const item = editing;
    const manuallyOut = form.stock_status === "out";
    const stockStatus =
      manuallyOut
        ? "out"
        : !trackStock
          ? "available"
          : Number(stockCount) <= 0
            ? "out"
            : Number(stockCount) <= lowStockThreshold
              ? "low"
              : "available";
    const payload = {
      id: item.id,
      stock_status: stockStatus,
      stock_scope: form.stock_scope,
      stock_count: manuallyOut ? 0 : trackStock ? stockCount : null,
      stock_tracking_enabled: manuallyOut || trackStock,
      manual_out: manuallyOut,
      low_stock_threshold: lowStockThreshold,
    };
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi("/api/stock", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not update availability.");
        }
        return data;
      },
      {
        loading: {
          title: "Saving availability…",
          message: `Updating ${item.name} for the customer menu.`,
        },
        success: () => ({
          eyebrow: "Saved",
          title: `${item.name} availability updated`,
          message: "Customers see the new status right away.",
          details: [
            { label: "Status", value: statusLabel(stockStatus) },
            {
              label: "Left",
              value:
                payload.stock_count === null
                  ? "Not tracked"
                  : String(payload.stock_count),
            },
          ],
        }),
      }
    );
    if (result.ok) setEditing(null);
    await load();
    setBusyId(null);
  };

  const lowCount = items.filter((item) => item.stock_status === "low").length;
  const outCount = items.filter((item) => item.stock_status === "out").length;

  if (loading) return <PortalPageSkeleton area="staff" />;

  return (
    <>
      {error && <div className="error-strip" style={{ marginBottom: 13 }}>{error}</div>}

      <div className="stat-grid three">
        <div className="stat-card">
          <div className="stat-label">
            <Icon name="coffee" /> On the menu
          </div>
          <div className="stat-value">{items.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Icon name="alert" /> Low portions
          </div>
          <div className="stat-value">{lowCount}</div>
        </div>
        <div className="stat-card dark">
          <div className="stat-label">
            <Icon name="x" /> Sold out
          </div>
          <div className="stat-value">{outCount}</div>
        </div>
      </div>

      <div className="section-bar section-bar-actions-only">
        <button type="button" className="btn btn-soft btn-sm" onClick={load}>
          <Icon name="refresh" className="icon-sm" /> Refresh
        </button>
      </div>

      <div className="admin-menu-toolbar">
        <div className="search-box">
          <Icon name="search" />
          <input
            className="input"
            placeholder="Search an item…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="tabs">
          {(
            [
              ["all", "All"],
              ["available", "Available"],
              ["low", "Low"],
              ["out", "Sold out"],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`tab ${filter === key ? "active" : ""}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-body tight">
          {filtered.length === 0 ? (
            <div className="empty-panel" style={{ border: 0 }}>
              <div className="empty-icon">
                <Icon name="coffee" />
              </div>
              <h3>Nothing to show.</h3>
              Try a different filter or search term.
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table data-table-stack">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Price</th>
                    <th>Status</th>
                    <th>Left</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      <td data-label="">
                        <div className="item-cell">
                          <span className="item-cell-art">
                            <CoffeeArt
                              kind={artKindForCategory(item.category_name, item.name)}
                              variant="icon"
                            />
                          </span>
                          <div>
                            <strong>{item.name}</strong>
                            <span>{item.category_name}</span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Price">{peso(item.price)}</td>
                      <td data-label="Status">
                        <span className={`stock-indicator ${item.stock_status}`}>
                          {item.stock_status === "available"
                            ? "Available"
                            : item.stock_status === "low"
                              ? "Low portions"
                              : "Sold out"}
                        </span>
                      </td>
                      <td data-label="Left">
                        {item.stock_tracking_enabled
                          ? item.stock_count
                          : "Not tracked"}
                        <span className="muted" style={{ fontSize: 8, display: "block" }}>
                          {!item.stock_tracking_enabled
                            ? "Made to order"
                            : item.stock_status === "out"
                              ? "nothing on hand"
                              : `low at ${item.low_stock_threshold}`}
                        </span>
                      </td>
                      <td data-label="Actions">
                        <div className="table-actions">
                          <button
                            type="button"
                            className={`stock-action-btn ${
                              item.stock_status === "out" ? "available-action" : "danger"
                            }`}
                            title={
                              item.stock_status === "out"
                                ? "Add portions on hand"
                                : "Mark sold out"
                            }
                            aria-label={
                              item.stock_status === "out"
                                ? `Add portions of ${item.name}`
                                : `Mark ${item.name} sold out`
                            }
                            disabled={busyId === item.id}
                            onClick={() => {
                              if (item.stock_status === "out") {
                                openEdit(item);
                                return;
                              }
                              setConfirming({ item, action: "out" });
                            }}
                          >
                            {item.stock_status === "out" ? "Restock" : "Sold out"}
                          </button>
                          <button
                            type="button"
                            className="table-icon-btn"
                            title="Edit portions left"
                            onClick={() => openEdit(item)}
                          >
                            <Icon name="edit" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {confirming && (
        <div className="feedback-layer tone-warning">
          <section
            className="feedback-card stock-confirm-card"
            data-tone="warning"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="stock-confirm-title"
            aria-describedby="stock-confirm-message"
          >
            <div className="feedback-medallion" aria-hidden="true">
              <Icon name="alert" size={22} />
            </div>
            <span className="feedback-eyebrow">Confirm availability change</span>
            <h2 id="stock-confirm-title" className="feedback-title">
              {confirming.action === "out"
                ? `Mark ${confirming.item.name} sold out?`
                : `Make ${confirming.item.name} available?`}
            </h2>
            <p id="stock-confirm-message" className="feedback-message">
              {confirming.action === "out"
                ? "This sets the remaining count to zero. The item stays visible on the customer menu as Sold out and can’t be ordered until it’s available again."
                : confirming.item.stock_tracking_enabled &&
                    confirming.item.stock_count <= 0
                  ? "Customers can order it again. The zero count will be cleared and tracking turned off until you enter a new count."
                  : "Customers will be able to order this item again."}
            </p>
            <div className="stock-confirm-actions">
              <button
                type="button"
                className="btn btn-outline"
                disabled={busyId === confirming.item.id}
                onClick={() => setConfirming(null)}
              >
                Cancel
              </button>
              <button
                ref={confirmButtonRef}
                type="button"
                className="btn btn-primary"
                disabled={busyId === confirming.item.id}
                onClick={() =>
                  updateAvailability(confirming.item, confirming.action)
                }
              >
                {busyId === confirming.item.id
                  ? <LoadingDots label="Updating" />
                  : confirming.action === "out"
                    ? "Sold out"
                    : "Available"}
              </button>
            </div>
          </section>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop">
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>{editing.name}</h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>
                  <input
                    id="stock-mode"
                    type="checkbox"
                    checked={form.track_stock}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        track_stock: event.target.checked,
                        stock_count: event.target.checked ? current.stock_count : "",
                      }))
                    }
                  />{" "}
                  Track portions left (limited stock)
                </span>
              </label>
              <small className="muted">
                {form.track_stock
                  ? "Portions remaining; each order deducts one. Reaching zero marks it sold out."
                  : "No count, no limit. Mark sold out manually when it runs out."}
              </small>
              <div className="modal-form-row">
                <div className="field">
                  <label className="label" htmlFor="stock-status">Availability</label>
                  <select
                    id="stock-status"
                    className="select"
                    value={form.stock_status}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        stock_status: event.target.value as "available" | "out",
                      }))
                    }
                  >
                    <option value="available">Available</option>
                    <option value="out">Sold out</option>
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="stock-count">Number left</label>
                  <input
                    id="stock-count"
                    className="input"
                    type="text"
                    inputMode="numeric"
                    aria-describedby="stock-count-hint"
                    value={form.stock_count}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "" || isStockAmount(value, MAX_STOCK_COUNT)) {
                        setForm((current) => ({ ...current, stock_count: value }));
                      }
                    }}
                    placeholder={
                      form.track_stock ? "Portions left" : "Not tracked"
                    }
                    disabled={!form.track_stock}
                    required={form.track_stock}
                  />
                  <small id="stock-count-hint" className="muted">
                    0–{MAX_STOCK_COUNT} portions.
                  </small>
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="low-stock-threshold">
                  Show low portions at
                </label>
                <input
                  id="low-stock-threshold"
                  className="input"
                  type="text"
                  inputMode="numeric"
                  aria-describedby="low-stock-threshold-hint"
                  value={form.low_stock_threshold}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "" || isStockAmount(value, MAX_LOW_STOCK_THRESHOLD)) {
                      setForm((current) => ({ ...current, low_stock_threshold: value }));
                    }
                  }}
                />
                <small id="low-stock-threshold-hint" className="muted">
                  0–{MAX_LOW_STOCK_THRESHOLD} portions. Customers see a low-availability message at this number or below.
                </small>
              </div>
              {form.stock_status === "out" && (
                <div className="field">
                  <label className="label" htmlFor="stock-scope">
                    Sold-out duration
                  </label>
                  <select
                    id="stock-scope"
                    className="select"
                    value={form.stock_scope}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        stock_scope: event.target.value as
                          | "today"
                          | "until_changed",
                      }))
                    }
                  >
                    <option value="today">Today only</option>
                    <option value="until_changed">Until staff changes it</option>
                  </select>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busyId === editing.id ||
                  JSON.stringify(form) === JSON.stringify(savedForm) ||
                  (form.track_stock && form.stock_count.trim() === "")
                }
                onClick={saveEdit}
              >
                Save availability
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
