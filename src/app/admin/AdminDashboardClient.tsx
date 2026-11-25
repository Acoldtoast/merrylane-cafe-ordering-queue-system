"use client";

import { errorMessage } from "@/lib/errorMessage";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityRow } from "@/components/ActivityFeed";
import { CoffeeArt, artKindForCategory } from "@/components/CoffeeArt";
import { Icon } from "@/components/Icons";
import { LoadingDots } from "@/components/LoadingDots";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import type {
  AdminOverviewData,
  AdminBestSellingItem as BestSellingItem,
  AdminForecastPoint as ForecastPoint,
} from "@/lib/adminOverview";
import { dateTimeLabel, peso, relativeTime, shortDate } from "@/lib/format";
import { usePolling } from "@/lib/usePolling";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { AdminAnalyticsReport } from "./analysis/AdminAnalyticsReport";

type DashboardData = AdminOverviewData;

export function AdminDashboardClient({
  mode = "overview",
  initialData,
}: {
  mode?: "overview" | "analysis";
  initialData?: AdminOverviewData;
}) {
  const [data, setData] = useState<DashboardData | null>(initialData || null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState("");
  const [busyMenuItemId, setBusyMenuItemId] = useState<number | null>(null);

  const load = useCallback(async (fresh = false) => {
    try {
      const response = await fetchPortalApi(
        `/api/analytics/overview${fresh ? "?fresh=1" : ""}`,
        { cache: fresh ? "no-store" : "no-cache" }
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load dashboard.");
      }
      setData(payload);
      setError("");
    } catch (err: unknown) {
      setError(errorMessage(err, "Unable to load dashboard."));
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(load, 30000, {
    immediate: !initialData,
    resources: ["accounts", "analytics", "menu", "orders", "payments", "reviews", "sales", "stock"],
  });

  const markBestSeller = async (item: BestSellingItem) => {
    if (!item.menu_item_id) return;
    setBusyMenuItemId(item.menu_item_id);
    setError("");
    try {
      const response = await fetchPortalApi(`/api/menu/${item.menu_item_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_best_seller: true }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to mark this menu item as a best seller.");
      }
      await load(true);
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to mark this menu item as a best seller."
      );
    } finally {
      setBusyMenuItemId(null);
    }
  };

  return (
    <>
      {error && <div className="error-strip" style={{ marginBottom: 13 }}>{error}</div>}

      {loading || !data ? (
        <PortalPageSkeleton area="admin" />
      ) : mode === "analysis" ? (
        <div className="analysis-page-enter">
          <Dashboard
            mode={mode}
            data={data}
            busyMenuItemId={busyMenuItemId}
            onMarkBestSeller={markBestSeller}
          />
        </div>
      ) : (
        <Dashboard
          mode={mode}
          data={data}
          busyMenuItemId={busyMenuItemId}
          onMarkBestSeller={markBestSeller}
        />
      )}
    </>
  );
}

function Dashboard({
  mode,
  data,
  busyMenuItemId,
  onMarkBestSeller,
}: {
  mode: "overview" | "analysis";
  data: DashboardData;
  busyMenuItemId: number | null;
  onMarkBestSeller: (item: BestSellingItem) => void;
}) {
  const [bestSellerPeriod, setBestSellerPeriod] = useState<"week" | "month">("week");
  const [chartReport, setChartReport] = useState<{
    rows: { date: string; revenue: number }[];
    label: string;
  } | null>(null);
  const { overview, stats, forecast, reviews, daily_sales } = data;
  const chartDailySales = chartReport?.rows ?? daily_sales;
  const chartLabel = chartReport?.label ?? "Last 14 days";
  const chartDailyAverage = chartDailySales.length
    ? chartDailySales.reduce((sum, point) => sum + Number(point.revenue), 0) /
      chartDailySales.length
    : 0;
  const periodBestSelling =
    bestSellerPeriod === "week"
      ? data.weekly_best_selling
      : data.monthly_best_selling;
  const periodLabel = bestSellerPeriod === "week" ? "this week" : "this month";
  const weeklyLeader = data.weekly_best_selling[0];
  const monthlyLeader = data.monthly_best_selling[0];
  const monthlyLeaderNeedsRestock =
    monthlyLeader?.stock_status === "low" || monthlyLeader?.stock_status === "out";
  const peak = data.peak_hours.reduce(
    (top, item) => (item.order_count > top.order_count ? item : top),
    { hour: 0, order_count: 0, revenue: 0 }
  );

  const avgTicket = overview.all_time_orders
    ? overview.all_time_revenue / overview.all_time_orders
    : 0;
  const salesByDate = new Map(daily_sales.map((day) => [day.date, day]));
  const dailySalesReport = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(`${data.reporting_date}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - (13 - index));
    const dateKey = date.toISOString().slice(0, 10);
    return salesByDate.get(dateKey) || {
      date: dateKey,
      total_orders: 0,
      revenue: 0,
    };
  });
  const currentPeriodRevenue = dailySalesReport
    .slice(-7)
    .reduce((sum, day) => sum + Number(day.revenue), 0);
  const previousPeriodRevenue = dailySalesReport
    .slice(0, 7)
    .reduce((sum, day) => sum + Number(day.revenue), 0);
  const periodRevenueChange =
    previousPeriodRevenue > 0
      ? Math.round(((currentPeriodRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100)
      : null;

  return (
    <>
      {mode === "overview" && (
      <div className="stat-grid">
        <div className="stat-card dark">
          <div className="stat-label">
            <Icon name="receipt" /> Today&apos;s sales
          </div>
          <div className="stat-value">{peso(stats.revenue)}</div>
          <div className="stat-bottom">
            <span>
              {stats.revenue_delta >= 0 ? "▲" : "▼"} {Math.abs(stats.revenue_delta)}%
              vs yesterday
            </span>
            <Sparkline values={daily_sales.map((d) => d.revenue)} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Icon name="bag" /> Orders today
          </div>
          <div className="stat-value">{stats.orders}</div>
          <div className="stat-bottom">
            <span>{stats.awaiting} awaiting confirmation</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Icon name="clock" /> Avg prep time
          </div>
          <div className="stat-value">
            {overview.avg_prep_time ? `${Math.round(overview.avg_prep_time)}m` : "—"}
          </div>
          <div className="stat-bottom">
            <span>Confirmed to served</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Icon name="star" /> Guest rating
          </div>
          <div className="stat-value">
            {reviews.avg_rating ? reviews.avg_rating.toFixed(1) : "—"}
          </div>
          <div className="stat-bottom">
            <span>{reviews.total_reviews} reviews · {reviews.positive_pct}% positive</span>
          </div>
        </div>
      </div>
      )}

      {mode === "analysis" && (
      <>
      <AdminAnalyticsReport onDailySales={setChartReport} />
      <div className="dashboard-grid analytics-chart-grid">
        <section className="card chart-panel">
          <div className="chart-head">
            <div>
              <h2>Sales &amp; forecast</h2>
              <p>Actual revenue · {chartLabel} · next seven days forecast.</p>
              <div className="chart-legend">
                <span><i /> Actual</span>
                <span><i className="dashed" /> Forecast</span>
              </div>
            </div>
            <span className="badge badge-cream">
              {forecast.confidence} confidence
            </span>
          </div>
          <SalesChart
            key={`${data.reporting_date}-${chartDailySales
              .map((point) => `${point.date}:${point.revenue}`)
              .join(",")}`}
            daily={chartDailySales}
            forecast={forecast.points}
          />
          <div className="chart-footer">
            <span>
              Projected week <b>{peso(forecast.projected_week)}</b>
            </span>
            <span>
              Daily average <b>{peso(chartDailyAverage)}</b>
            </span>
          </div>
          <div className="insight-card">
            <span className="insight-icon">
              <Icon name="sparkles" size={15} />
            </span>
            <div>
              <h3>Forecast insight</h3>
              <p>
                {peak.order_count > 0
                  ? `Busiest window around ${hourLabel(peak.hour)}, ${peak.order_count} orders.`
                  : "Not enough order history yet."}
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="card admin-analysis">
        <div className="chart-head">
          <div>
            <h2>Sales suggestions</h2>
            <p>Based on orders, menu tags, stock, and busy hours.</p>
          </div>
        </div>
        <div className="analysis-suggestions">
          <article>
            <span className="insight-icon"><Icon name="sparkles" size={15} /></span>
            <div>
              <h3>Promote this week&apos;s leader</h3>
              <p>
                {weeklyLeader
                  ? `${weeklyLeader.name} leads this week with ${weeklyLeader.total_quantity} sold. Keep it visible on the customer menu.`
                  : "No confirmed orders this week yet."}
              </p>
              {weeklyLeader?.menu_item_id &&
                weeklyLeader.is_active &&
                !weeklyLeader.is_best_seller && (
                  <button
                    type="button"
                    className="text-link"
                    disabled={busyMenuItemId === weeklyLeader.menu_item_id}
                    onClick={() => onMarkBestSeller(weeklyLeader)}
                  >
                    {busyMenuItemId === weeklyLeader.menu_item_id
                      ? <LoadingDots label="Saving" />
                      : `Mark ${weeklyLeader.name} as a best seller`}
                  </button>
                )}
            </div>
          </article>
          <article>
            <span className="insight-icon"><Icon name="coffee" size={15} /></span>
            <div>
              <h3>{monthlyLeaderNeedsRestock ? "Restock a monthly favourite" : "Check stock for monthly favourites"}</h3>
              <p>
                {monthlyLeader
                  ? monthlyLeaderNeedsRestock
                    ? `${monthlyLeader.name} is a top seller this month but is ${monthlyLeader.stock_status}. Restock before the next busy period.`
                    : `${monthlyLeader.name} leads this month with ${monthlyLeader.total_quantity} sold. Check its stock levels.`
                  : "Monthly stock suggestions will appear once there are confirmed orders this month."}
              </p>
            </div>
          </article>
          <article>
            <span className="insight-icon"><Icon name="clock" size={15} /></span>
            <div>
              <h3>Plan for peak hours</h3>
              <p>
                {peak.order_count > 0
                  ? `${peak.order_count} orders around ${hourLabel(peak.hour)}. Prepare ingredients and staff for that window.`
                  : "More order history needed for a busy-hour recommendation."}
              </p>
            </div>
          </article>
          <article>
            <span className="insight-icon"><Icon name="trending-up" size={15} /></span>
            <div>
              <h3>Compare recent sales</h3>
              <p>
                {periodRevenueChange === null
                  ? "Not enough history for comparison."
                  : periodRevenueChange > 10
                    ? `Sales up ${periodRevenueChange}% vs previous 7 days.`
                    : periodRevenueChange < -10
                      ? `Sales down ${Math.abs(periodRevenueChange)}% vs previous 7 days.`
                      : `Sales steady, ${periodRevenueChange}% change.`}
              </p>
            </div>
          </article>
        </div>
      </section>

      </>
      )}

      {mode === "overview" && (
      <>
      <div className="lower-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Recent feedback</h2>
              <p>Recent customer notes.</p>
            </div>
            <Link href="/admin/reviews" className="text-link">
              View all
            </Link>
          </div>
          <div className="panel-body">
            {reviews.recent.length === 0 ? (
              <div className="empty-panel" style={{ border: 0 }}>
                No reviews yet.
              </div>
            ) : (
              reviews.recent.slice(0, 4).map((review) => (
                <div className="feedback-mini" key={review.id}>
                  <span className="avatar">
                    {(review.customer_name || "Guest")
                      .split(" ")
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div className="feedback-mini-body">
                    <div className="feedback-mini-top">
                      <strong>
                        {review.customer_name || "Anonymous guest"} · Table{" "}
                        {String(review.table_number).padStart(2, "0")}
                      </strong>
                      <MiniStars value={review.rating} />
                    </div>
                    <p>{review.comment || "No comment left."}</p>
                    <time>{relativeTime(review.created_at)}</time>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Today at a glance</h2>
              <p>Needs attention.</p>
            </div>
          </div>
          <div className="panel-body">
            <div className="hours-list">
              <div className="hours-line">
                <span>Payments to verify</span>
                <strong>{stats.pending_payments}</strong>
              </div>
              <div className="hours-line">
                <span>Waiter requests</span>
                <strong>{stats.waiter_requests}</strong>
              </div>
              <div className="hours-line">
                <span>Preparing now</span>
                <strong>{stats.preparing}</strong>
              </div>
              <div className="hours-line">
                <span>Served · awaiting customer</span>
                <strong>{stats.ready}</strong>
              </div>
              <div className="hours-line">
                <span>Busiest hour</span>
                <strong>{peak.order_count ? hourLabel(peak.hour) : "—"}</strong>
              </div>
            </div>
            <Link href="/admin/analysis" className="btn btn-primary btn-block mt-2">
              View sales &amp; stock analysis <Icon name="arrow-right" className="icon-sm" />
            </Link>
            <div className="status-refresh" style={{ marginTop: 11 }}>
              <span className="live-dot" /> Dashboard refreshes every 30 seconds
            </div>
          </div>
        </section>
      </div>

      <div className="best-activity-grid">
      <section className="card chart-panel">
        <div className="chart-head">
          <div>
            <h2>Best sellers</h2>
            <p>Most ordered menu items in the current calendar period.</p>
          </div>
          <div className="best-seller-periods" role="group" aria-label="Best seller period">
            <button
              type="button"
              className={bestSellerPeriod === "week" ? "active" : ""}
              aria-pressed={bestSellerPeriod === "week"}
              onClick={() => setBestSellerPeriod("week")}
            >
              Week
            </button>
            <button
              type="button"
              className={bestSellerPeriod === "month" ? "active" : ""}
              aria-pressed={bestSellerPeriod === "month"}
              onClick={() => setBestSellerPeriod("month")}
            >
              Month
            </button>
          </div>
        </div>
        <div className="favorites">
          {periodBestSelling.slice(0, 6).map((item, index) => (
            <div className="favorite-row" key={item.name}>
              <span className="favorite-rank">{String(index + 1).padStart(2, "0")}</span>
              <span className="favorite-art">
                <CoffeeArt
                  kind={artKindForCategory("", item.name)}
                  variant="icon"
                />
              </span>
              <span className="favorite-name">{item.name}</span>
              <span className="favorite-qty">{item.total_quantity} sold</span>
              <span className="favorite-rev">{peso(item.total_revenue)}</span>
              <span className="favorite-flag">
                {item.menu_item_id && item.is_active ? (
                  item.is_best_seller ? (
                    <span className="favorite-featured-label">Best seller</span>
                  ) : (
                    <button
                      type="button"
                      className="favorite-feature-btn"
                      disabled={busyMenuItemId === item.menu_item_id}
                      onClick={() => onMarkBestSeller(item)}
                    >
                      {busyMenuItemId === item.menu_item_id
                        ? <LoadingDots label="Saving" />
                        : "Mark best seller"}
                    </button>
                  )
                ) : null}
              </span>
            </div>
          ))}
          {periodBestSelling.length === 0 && (
            <div className="empty-panel" style={{ border: 0 }}>
              No confirmed orders {periodLabel}.
            </div>
          )}
        </div>
        <div className="week-tiles">
          <div className="week-tile">
            <small>Period</small>
            <strong>
              {bestSellerPeriod === "week"
                ? `From ${formatShortDate(data.best_seller_periods.week_start)}`
                : formatMonth(data.best_seller_periods.month_start)}
            </strong>
          </div>
          <div className="week-tile">
            <small>Avg ticket · all time</small>
            <strong>{peso(avgTicket)}</strong>
          </div>
        </div>
      </section>

      <section className="card chart-panel">
        <div className="chart-head">
          <div>
            <h2>Recent activity</h2>
            <p>Payments, orders, stock, and menu changes.</p>
          </div>
          <Link href="/admin/activity" className="text-link">
            Full log
          </Link>
        </div>
        {data.recent_activity?.length ? (
          <ul className="activity-list activity-list-compact">
            {data.recent_activity.map((log) => (
              <ActivityRow key={log.id} log={log} time="full" />
            ))}
          </ul>
        ) : (
          <div className="empty-panel" style={{ border: 0 }}>
            No activity recorded yet.
          </div>
        )}
      </section>
      </div>

      <div className="section-bar">
        <div>
          <h2>Recent orders</h2>
          <p>The last orders across every table.</p>
        </div>
        <Link href="/admin/activity" className="text-link">
          Admin activity
        </Link>
      </div>
      <div className="panel">
        <div className="panel-body tight">
          <div className="data-table-wrap">
            <table className="data-table data-table-stack">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Table</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Placed</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_orders.map((order) => (
                  <tr key={order.id}>
                    <td data-label="">#{String(order.order_number ?? order.id).padStart(3, "0")}</td>
                    <td data-label="Table">{String(order.table_number).padStart(2, "0")}</td>
                    <td data-label="Items">{(order.items || []).length}</td>
                    <td data-label="Total">{peso(order.total)}</td>
                    <td data-label="Payment" style={{ textTransform: "capitalize" }}>{order.payment_method}</td>
                    <td data-label="Status" style={{ textTransform: "capitalize" }}>{order.status.replace("_", " ")}</td>
                    <td data-label="Placed">{dateTimeLabel(order.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      </>
      )}
    </>
  );
}

function SalesChart({
  daily,
  forecast,
}: {
  daily: { date: string; revenue: number }[];
  forecast: ForecastPoint[];
}) {
  const [width, setWidth] = useState(620);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setWidth(Math.max(320, Math.round(el.clientWidth)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const actual = daily;
  const projected = forecast.slice(0, 7);
  const values = [
    ...actual.map((point) => Number(point.revenue)),
    ...projected.map((point) => Number(point.forecast)),
  ];
  const max = Math.max(1000, ...values) * 1.15;
  const height = Math.max(170, Math.min(300, Math.round(width * 0.2)));
  const padding = { top: 18, right: 12, bottom: 24, left: 54 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const total = actual.length + projected.length;
  const stepX = total > 1 ? chartW / (total - 1) : chartW;

  const pointFor = (index: number, value: number) => ({
    x: padding.left + index * stepX,
    y: padding.top + chartH - (value / max) * chartH,
  });

  const actualPoints = actual.map((point, index) =>
    pointFor(index, Number(point.revenue))
  );
  const forecastPoints = projected.map((point, index) =>
    pointFor(actual.length + index, Number(point.forecast))
  );

  const line = (points: { x: number; y: number }[]) =>
    points
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
      .join(" ");

  const bridge =
    actualPoints.length && forecastPoints.length
      ? `M${actualPoints[actualPoints.length - 1].x} ${actualPoints[actualPoints.length - 1].y} L${forecastPoints[0].x} ${forecastPoints[0].y}`
      : "";

  const labelIndexes = new Set<number>();
  const labelStep = Math.max(1, Math.ceil(actual.length / 4));
  for (let index = 0; index < actual.length; index += labelStep) {
    labelIndexes.add(index);
  }
  if (!projected.length && actual.length) labelIndexes.add(actual.length - 1);

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Sales and forecast chart">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + chartH * ratio;
          return (
            <g key={ratio}>
              <line
                className="grid-line"
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
              />
              <text className="axis-label" x={padding.left - 6} y={y + 4} textAnchor="end">
                {peso(Math.round(max * (1 - ratio))).replace("₱", "")}
              </text>
            </g>
          );
        })}

        {actualPoints.length > 1 && (
          <path
            className="actual-line"
            d={line(actualPoints)}
            pathLength={1}
          />
        )}
        {bridge && (
          <path
            className="forecast-line forecast-bridge"
            d={bridge}
            opacity={0.55}
          />
        )}
        {forecastPoints.length > 1 && (
          <path className="forecast-line" d={line(forecastPoints)} />
        )}

        {actual.length <= 40 && actualPoints.map((point, index) => (
          <circle
            key={`a-${index}`}
            className="chart-dot"
            cx={point.x}
            cy={point.y}
            r={2.4}
            style={{ animationDelay: `${index * 45}ms` }}
          />
        ))}

        {actual.map((point, index) =>
          labelIndexes.has(index) ? (
            <text
              key={`al-${index}`}
              className="axis-label"
              x={pointFor(index, 0).x}
              y={height - 5}
              textAnchor={index === 0 ? "start" : "middle"}
            >
              {shortDate(point.date)}
            </text>
          ) : null
        )}
        {projected.map((point, index) =>
          index === projected.length - 1 ? (
            <text
              key={`fl-${index}`}
              className="axis-label"
              x={pointFor(actual.length + index, 0).x}
              y={height - 5}
              textAnchor="end"
            >
              {shortDate(point.date)}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const points = values
    .slice(-10)
    .map((value, index, list) => {
      const x = (index / Math.max(list.length - 1, 1)) * 50;
      const y = 16 - (value / max) * 14;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="stat-spark" viewBox="0 0 50 18" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function MiniStars({ value }: { value: number }) {
  return (
    <span className="mini-stars">
      {[1, 2, 3, 4, 5].map((star) => (
        <Icon key={star} name="star" className={star <= value ? "" : "star-off"} />
      ))}
    </span>
  );
}

export function hourLabel(hour: number) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toLocaleTimeString("en-PH", { hour: "numeric" });
}

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatShortDate(value: string) {
  return parseDateOnly(value).toLocaleDateString("en-PH", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function formatMonth(value: string) {
  return parseDateOnly(value).toLocaleDateString("en-PH", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}
