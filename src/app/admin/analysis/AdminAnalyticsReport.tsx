"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icons";
import {
  SkeletonChart,
  SkeletonPanel,
  SkeletonStats,
  SkeletonTable,
} from "@/components/PortalSkeletonPrimitives";
import { peso } from "@/lib/format";
import { usePolling } from "@/lib/usePolling";
import { fetchPortalApi } from "@/lib/portalPrefetch";

type Period = "today" | "week" | "month" | "year" | "last7" | "last30" | "custom";
type OrderTypeFilter = "all" | "dine_in" | "take_out";
type PaymentFilter = "all" | "gcash" | "counter" | "cash";

interface AnalyticsReport {
  period: Period;
  range: {
    start: string;
    end: string;
    previous_start: string;
    previous_end: string;
    day_count: number;
  };
  generated_at: string;
  generated_by: string;
  summary: {
    order_count: number;
    revenue: number;
    average_order_value: number;
    revenue_change_pct: number | null;
    order_change_pct: number | null;
    cancelled_orders: number;
    average_wait_minutes: number;
    pending_payment_verifications: number;
    average_rating: number;
    review_count: number;
    items_out_of_stock: number;
  };
  comparison: {
    start: string;
    end: string;
    order_count: number;
    revenue: number;
  };
  daily_sales: { date: string; order_count: number; revenue: number }[];
  products: {
    menu_item_id: number | null;
    name: string;
    quantity_sold: number;
    revenue: number;
  }[];
  peak_hours: { hour: number; order_count: number; revenue: number }[];
  payment_methods: {
    payment_method: string;
    order_count: number;
    revenue: number;
  }[];
  orders: {
    id: number;
    table_number: number;
    order_type: string;
    status: string;
    payment_method: string;
    payment_status: string;
    subtotal: number;
    service_charge: number;
    total: number;
    created_at: string;
    confirmed_at: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
  }[];
  order_items: {
    order_id: number;
    name: string;
    variant_name: string | null;
    extras: string;
    sugar_level: string | null;
    quantity: number;
    price_at_time: number;
  }[];
  insights: {
    revenue_trend: string;
    leading_product: string;
    busiest_hour: string;
  };
  analytics: {
    hourly_sales: { hour: string; order_count: number; revenue: number }[];
    heatmap: { weekday: number; hour: number; order_count: number; revenue: number }[];
    heatmap_weekdays: string[];
    timing: {
      confirmation_minutes: number;
      confirmation_samples: number;
      confirmed_to_preparing_minutes: number;
      confirmed_to_preparing_samples: number;
      preparing_to_ready_minutes: number;
      preparing_to_ready_samples: number;
      confirmed_to_ready_minutes: number;
      confirmed_to_ready_samples: number;
      preparing_stage_available: boolean;
    };
    payment_verification: {
      pending: number | null;
      verified: number | null;
      rejected: number | null;
      balance_payments: {
        payment_method: string;
        status: string;
        payment_count: number;
        amount: number;
        average_verification_minutes: number;
      }[];
    };
    pending_orders: {
      id: number;
      order_type: string;
      payment_method: string;
      payment_status: string;
      total: number;
      created_at: string;
      confirmed_at: string | null;
      status: string;
      elapsed_minutes: number;
    }[];
    pending_gcash: {
      id: number;
      total: number;
      created_at: string;
      external_proof_url: string | null;
      inline_proof: number;
      elapsed_minutes: number;
    }[];
    menu_performance: {
      menu_item_id: number;
      name: string;
      is_active: number;
      stock_status: string;
      quantity_sold: number;
      revenue: number;
      extras_quantity: number;
      sales_share_pct: number;
      extras_attach_rate_pct: number;
      classification: string;
    }[];
    menu_bottom: { menu_item_id: number; name: string; quantity_sold: number }[];
    current_stock: {
      menu_item_id: number;
      name: string;
      stock_count: number;
      low_stock_threshold: number;
      stock_status: string;
      stock_note: string | null;
    }[];
    stock_events: {
      menu_item_id: number;
      name: string;
      out_events: number;
      last_event: string;
    }[];
    waiter_calls: {
      id: number;
      request_type: string;
      status: string;
      created_at: string;
      acknowledged_at: string | null;
      resolved_at: string | null;
      table_number: number;
      hour: number;
      resolution_minutes: number | null;
    }[];
    waiter_reason_counts: { request_type: string; hour: number; call_count: number }[];
    rating_distribution: { rating: number; review_count: number }[];
    recent_reviews: {
      id: number;
      rating: number;
      customer_name: string | null;
      comment: string | null;
      photo_url: string | null;
      created_at: string;
    }[];
    review_rate_pct: number;
    order_type_mix: {
      order_type: string;
      order_count: number;
      revenue: number;
      average_order_value: number;
    }[];
    cancellation_reasons: { cancellation_reason: string | null; order_count: number }[];
    forecast_status: string;
  };
  filters: { order_type: OrderTypeFilter; payment_method: PaymentFilter };
}

interface ChartBucket {
  label: string;
  detail: string;
  revenue: number;
  orders: number;
}

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom" },
];

const PAYMENT_COLORS = ["#9a704e", "#c5a274", "#73866a", "#d4b88e", "#876f80"];

function paymentGradient(
  methods: { revenue: number; color: string }[],
  total: number
): string {
  return methods
    .reduce(
      (state, method) => {
        const end = state.offset + (method.revenue / total) * 100;
        return {
          offset: end,
          stops: [
            ...state.stops,
            `${method.color} ${state.offset}% ${end}%`,
          ],
        };
      },
      { offset: 0, stops: [] as string[] }
    )
    .stops.join(", ");
}

function salesBuckets(report: AnalyticsReport): ChartBucket[] {
  if (report.period === "today") {
    return report.peak_hours
      .slice()
      .sort((a, b) => a.hour - b.hour)
      .map((hour) => ({
        label: `${hour.hour % 12 || 12}${hour.hour < 12 ? "a" : "p"}`,
        detail: `${String(hour.hour).padStart(2, "0")}:00`,
        revenue: hour.revenue,
        orders: hour.order_count,
      }));
  }

  if (report.period === "year") {
    const months = new Map<string, ChartBucket>();
    for (const day of report.daily_sales) {
      const month = day.date.slice(0, 7);
      const bucket = months.get(month) || {
        label: new Date(`${month}-01T12:00:00.000Z`).toLocaleDateString(
          "en-PH",
          { month: "short", timeZone: "UTC" }
        ),
        detail: month,
        revenue: 0,
        orders: 0,
      };
      bucket.revenue += day.revenue;
      bucket.orders += day.order_count;
      months.set(month, bucket);
    }
    return Array.from(months.values());
  }

  return report.daily_sales.map((day) => ({
    label:
      report.period === "week"
        ? new Date(`${day.date}T12:00:00.000Z`).toLocaleDateString("en-PH", {
            weekday: "short",
            timeZone: "UTC",
          })
        : String(Number(day.date.slice(-2))),
    detail: day.date,
    revenue: day.revenue,
    orders: day.order_count,
  }));
}

function reportAnimationKey(report: AnalyticsReport): string {
  const signature = JSON.stringify({
    period: report.period,
    summary: report.summary,
    comparison: report.comparison,
    daily_sales: report.daily_sales,
    peak_hours: report.peak_hours,
    products: report.products,
    payment_methods: report.payment_methods,
    insights: report.insights,
  });
  let hash = 2166136261;
  for (let index = 0; index < signature.length; index += 1) {
    hash = Math.imul(hash ^ signature.charCodeAt(index), 16777619);
  }
  return `${report.period}-${(hash >>> 0).toString(36)}`;
}

function AnimatedKpi({
  value,
  format,
  label,
}: {
  value: number;
  format: "currency" | "number" | "percent" | "decimal";
  label: string;
}) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let animationFrame = 0;
    let startedAt: number | null = null;
    const duration = 950;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const animate = (timestamp: number) => {
      if (reducedMotion) {
        setDisplayValue(value);
        return;
      }
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min((timestamp - startedAt) / duration, 1);
      const eased = 1 - (1 - progress) ** 4;
      setDisplayValue(value * eased);
      if (progress < 1) animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [value]);

  const roundedValue = Math.round(displayValue);
  const display =
    format === "currency"
      ? peso(roundedValue)
      : format === "percent"
        ? `${roundedValue > 0 ? "+" : ""}${roundedValue}%`
        : format === "decimal"
          ? displayValue.toFixed(1)
        : roundedValue.toLocaleString("en-PH");
  const accessibleValue =
    format === "currency"
      ? peso(value)
      : format === "percent"
        ? `${value > 0 ? "+" : ""}${value}%`
        : format === "decimal"
          ? value.toFixed(1)
        : value.toLocaleString("en-PH");

  return (
    <strong aria-label={`${label}: ${accessibleValue}`} aria-live="off">
      {display}
    </strong>
  );
}

function RevenueBarChart({
  report,
  buckets,
}: {
  report: AnalyticsReport;
  buckets: ChartBucket[];
}) {
  const maxRevenue = Math.max(0, ...buckets.map((bucket) => bucket.revenue));
  const labelStep = Math.max(1, Math.ceil(buckets.length / 7));
  const description =
    report.period === "today"
      ? "Revenue by hour"
      : report.period === "year"
        ? "Revenue by month"
        : "Revenue by day";

  return (
    <section className="analytics-chart-card">
      <div className="analytics-chart-heading">
        <div>
          <h3>{description}</h3>
          <p>Confirmed sales · {peso(maxRevenue)} peak</p>
        </div>
        <Icon name="chart" size={16} />
      </div>
      {maxRevenue > 0 ? (
        <div
          className="analytics-bar-chart"
          role="img"
          aria-label={`${description}, maximum ${peso(maxRevenue)}`}
        >
          <div className="analytics-bar-axis">
            {[1, 0.5, 0].map((ratio) => (
              <span key={ratio}>{peso(maxRevenue * ratio)}</span>
            ))}
          </div>
          <div className="analytics-bar-plot">
            {buckets.map((bucket, index) => {
              const height = Math.max(
                bucket.revenue > 0 ? 4 : 0,
                (bucket.revenue / maxRevenue) * 100
              );
              const showLabel =
                index === 0 ||
                index === buckets.length - 1 ||
                index % labelStep === 0;
              return (
                <div className="analytics-bar-column" key={bucket.detail}>
                  <div className="analytics-bar-track">
                    <div
                      className="analytics-bar"
                      style={{
                        height: `${height}%`,
                        animationDelay: `${Math.min(index, 20) * 35}ms`,
                      }}
                      title={`${bucket.detail}: ${peso(bucket.revenue)} · ${bucket.orders} orders`}
                    />
                  </div>
                  <small>{showLabel ? bucket.label : ""}</small>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="analytics-chart-empty">No served sales to chart for this period.</div>
      )}
    </section>
  );
}

function PaymentMixChart({ report }: { report: AnalyticsReport }) {
  const methods = report.payment_methods
    .filter((method) => method.revenue > 0)
    .map((method, index) => ({
      ...method,
      color: PAYMENT_COLORS[index % PAYMENT_COLORS.length],
    }));
  const total = methods.reduce((sum, method) => sum + method.revenue, 0);
  const gradient = paymentGradient(methods, total);

  return (
    <section className="analytics-chart-card">
      <div className="analytics-chart-heading">
        <div>
          <h3>Revenue by payment</h3>
          <p>Share of served sales</p>
        </div>
        <Icon name="card" size={16} />
      </div>
      {total > 0 ? (
        <div className="analytics-pie-content">
          <div
            className="analytics-pie"
            style={{ background: `conic-gradient(${gradient})` }}
            role="img"
            aria-label={`Payment mix totaling ${peso(total)}`}
          >
            <div className="analytics-pie-center">
              <small>Total revenue</small>
              <strong>{peso(total)}</strong>
            </div>
          </div>
          <div className="analytics-pie-legend">
            {methods.map((method) => (
              <div key={method.payment_method}>
                <span
                  className="analytics-pie-swatch"
                  style={{ background: method.color }}
                />
                <strong>{method.payment_method}</strong>
                <small>
                  {peso(method.revenue)} ·{" "}
                  {((method.revenue / total) * 100).toFixed(1)}%
                </small>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="analytics-chart-empty">No confirmed payment data for this period.</div>
      )}
    </section>
  );
}

function SalesTrendChart({ report }: { report: AnalyticsReport }) {
  const rows = report.range.day_count <= 2 && report.analytics.hourly_sales.length
    ? report.analytics.hourly_sales.map((row) => ({
        label: row.hour.slice(11, 16),
        revenue: row.revenue,
        orders: row.order_count,
      }))
    : report.daily_sales.map((row) => ({
        label: row.date.slice(5),
        revenue: row.revenue,
        orders: row.order_count,
      }));
  const width = 720;
  const height = 220;
  const padding = 28;
  const maxRevenue = Math.max(1, ...rows.map((row) => row.revenue));
  const maxOrders = Math.max(1, ...rows.map((row) => row.orders));
  const pointFor = (value: number, max: number, index: number) => ({
    x: padding + (rows.length <= 1 ? 0 : (index / (rows.length - 1)) * (width - padding * 2)),
    y: height - padding - (value / max) * (height - padding * 2),
  });
  const revenuePoints = rows.map((row, index) => pointFor(row.revenue, maxRevenue, index));
  const orderPoints = rows.map((row, index) => pointFor(row.orders, maxOrders, index));
  const hasSales = rows.some((row) => row.revenue > 0 || row.orders > 0);
  const compact = (points: { x: number; y: number }[]) =>
    points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <section className="analytics-module-card">
      <header><h3>Sales trend</h3><p>Revenue and order count over the selected range</p></header>
      {rows.length && hasSales ? (
        <>
          <div className="analytics-line-legend">
            <span><i className="revenue" />Revenue</span>
            <span><i className="orders" />Orders</span>
          </div>
          <svg className="analytics-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Sales revenue and orders trend">
            {[0, 0.5, 1].map((ratio) => {
              const y = height - padding - ratio * (height - padding * 2);
              return <line key={ratio} x1={padding} y1={y} x2={width - padding} y2={y} className="chart-grid-line" />;
            })}
            <polyline points={compact(revenuePoints)} className="trend-revenue" />
            <polyline points={compact(orderPoints)} className="trend-orders" />
            {rows.map((row, index) => (
              <g key={`${row.label}-${index}`}>
                <circle cx={revenuePoints[index].x} cy={revenuePoints[index].y} r="4" className="trend-revenue-dot">
                  <title>{row.label}: {peso(row.revenue)}</title>
                </circle>
                <circle cx={orderPoints[index].x} cy={orderPoints[index].y} r="4" className="trend-orders-dot">
                  <title>{row.label}: {row.orders} orders</title>
                </circle>
              </g>
            ))}
          </svg>
          <div className="analytics-trend-labels">
            {rows.filter((_, index) => index % Math.max(1, Math.ceil(rows.length / 8)) === 0 || index === rows.length - 1)
              .map((row, index) => <span key={`${row.label}-${index}`}>{row.label}</span>)}
          </div>
        </>
      ) : <div className="analytics-chart-empty">No sales data for this period.</div>}
    </section>
  );
}

function PeakHourHeatmap({ report }: { report: AnalyticsReport }) {
  const maxCount = Math.max(1, ...report.analytics.heatmap.map((cell) => cell.order_count));
  const cells = new Map(report.analytics.heatmap.map((cell) => [`${cell.weekday}-${cell.hour}`, cell]));
  const weekdays = [1, 2, 3, 4, 5, 6, 0];

  return (
    <section className="analytics-module-card analytics-heatmap-card">
      <header><h3>Peak-hour heatmap</h3><p>Order concentration by weekday and hour · supports staffing decisions</p></header>
      <div className="analytics-heatmap-scroll">
        <div className="analytics-heatmap">
          <span className="heatmap-corner" />
          {Array.from({ length: 24 }, (_, hour) => <span className="heatmap-hour" key={hour}>{hour % 3 === 0 ? `${String(hour).padStart(2, "0")}` : ""}</span>)}
          {weekdays.map((weekday) => (
            <Fragment key={weekday}>
              <span className="heatmap-day">{report.analytics.heatmap_weekdays[weekday]}</span>
              {Array.from({ length: 24 }, (_, hour) => {
                const cell = cells.get(`${weekday}-${hour}`);
                const opacity = cell ? 0.12 + (cell.order_count / maxCount) * 0.78 : 0.05;
                return (
                  <span
                    key={`${weekday}-${hour}`}
                    className="heatmap-cell"
                    style={{ backgroundColor: `rgba(154,112,78,${opacity})` }}
                    title={`${report.analytics.heatmap_weekdays[weekday]} ${String(hour).padStart(2, "0")}:00 · ${cell?.order_count || 0} orders · ${peso(cell?.revenue || 0)}`}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <small className="analytics-module-note">Darker cells indicate more served orders. Hover or tap a cell for totals.</small>
    </section>
  );
}

function orderTypeGradient(
  rows: { order_type: string; revenue: number }[]
): string {
  const total = rows.reduce((sum, row) => sum + row.revenue, 0);
  if (!total) return "var(--cream)";
  let offset = 0;
  const colors = ["#9a704e", "#c5a274"];
  return `conic-gradient(${rows.map((row, index) => {
    const start = offset;
    offset += (row.revenue / total) * 100;
    return `${colors[index % colors.length]} ${start}% ${offset}%`;
  }).join(", ")})`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function buildReportHtml(report: AnalyticsReport): string {
  const table = (headers: string[], rows: unknown[][]) => `
    <table>
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>${rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
        )
        .join("")}</tbody>
    </table>`;
  const buckets = salesBuckets(report);
  const maxSales = Math.max(0, ...buckets.map((bucket) => bucket.revenue));
  const labelStep = Math.max(1, Math.ceil(buckets.length / 14));
  const barChart =
    maxSales > 0
      ? `<div class="bars">${buckets
          .map(
            (bucket, index) => `<div class="bar-column">
              <div class="bar-track"><i style="height:${Math.max(
                bucket.revenue > 0 ? 2 : 0,
                (bucket.revenue / maxSales) * 100
              )}%"></i></div>
              <small>${index % labelStep === 0 || index === buckets.length - 1 ? escapeHtml(bucket.label) : ""}</small>
            </div>`
          )
          .join("")}</div>`
      : "<p>No served sales to chart for this period.</p>";
  const paymentMethods = report.payment_methods
    .filter((method) => method.revenue > 0)
    .map((method, index) => ({
      ...method,
      color: PAYMENT_COLORS[index % PAYMENT_COLORS.length],
    }));
  const paymentTotal = paymentMethods.reduce(
    (sum, method) => sum + method.revenue,
    0
  );
  const reportPieGradient = paymentGradient(paymentMethods, paymentTotal);
  const pieChart =
    paymentTotal > 0
      ? `<div class="pie-layout">
          <div class="pie" style="background:conic-gradient(${reportPieGradient})"></div>
          ${table(
            ["Payment method", "Orders", "Revenue"],
            paymentMethods.map((method) => [
              method.payment_method,
              method.order_count,
              peso(method.revenue),
            ])
          )}
        </div>`
      : "<p>No confirmed payment data for this period.</p>";

  const title = `Merrylane Cafe Analytics · ${report.period}`;
  const generated = new Date(report.generated_at).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
  });
  const changeText = (value: number | null) =>
    value === null ? "No previous-period data" : `${value > 0 ? "+" : ""}${value}% vs previous period`;
  const waitSummary = report.analytics.timing.confirmed_to_ready_samples > 0
    ? `${report.summary.average_wait_minutes.toFixed(1)} min`
    : "No timestamp data";
  const ratingSummary = report.summary.review_count > 0
    ? `${report.summary.average_rating.toFixed(1)} / 5`
    : "No reviews";
  const contents = `
    <header>
      <p class="eyebrow">Merrylane Cafe · Business Analytics</p>
      <h1>${escapeHtml(title)}</h1>
      <p>Reporting period: ${escapeHtml(report.range.start)} – ${escapeHtml(report.range.end)}</p>
      <p>Compared with: ${escapeHtml(report.comparison.start)} – ${escapeHtml(report.comparison.end)}</p>
      <p>Filters: ${escapeHtml(report.filters.order_type.replaceAll("_", " "))} · ${escapeHtml(report.filters.payment_method)}</p>
      <p>Generated by ${escapeHtml(report.generated_by)} · ${escapeHtml(generated)}</p>
    </header>
    <section class="kpis">
      <article><span>Served revenue</span><strong>${escapeHtml(peso(report.summary.revenue))}</strong><small>${escapeHtml(changeText(report.summary.revenue_change_pct))}</small></article>
      <article><span>Served orders</span><strong>${escapeHtml(report.summary.order_count.toLocaleString("en-PH"))}</strong><small>${escapeHtml(changeText(report.summary.order_change_pct))}</small></article>
      <article><span>Average order value</span><strong>${escapeHtml(peso(report.summary.average_order_value))}</strong><small>Average of served orders</small></article>
      <article><span>Average wait</span><strong>${escapeHtml(waitSummary)}</strong><small>Confirmed to served</small></article>
      <article><span>Pending payments</span><strong>${escapeHtml(report.summary.pending_payment_verifications.toLocaleString("en-PH"))}</strong><small>Awaiting verification</small></article>
      <article><span>Average rating</span><strong>${escapeHtml(ratingSummary)}</strong><small>${escapeHtml(report.summary.review_count.toLocaleString("en-PH"))} reviews</small></article>
    </section>
    <div class="visuals">
      <section><h2>Revenue trend</h2>${barChart}</section>
      <section><h2>Payment mix</h2>${pieChart}</section>
    </div>
    <section>
      <h2>Key business insights</h2>
      ${table(["Insight", "Finding"], [
        ["Revenue trend", report.insights.revenue_trend],
        ["Leading product", report.insights.leading_product],
        ["Busiest hour", report.insights.busiest_hour],
      ])}
    </section>
    <section>
      <h2>Top menu items</h2>
      ${table(["Item", "Quantity sold", "Revenue"], report.products.slice(0, 5).map((row) => [row.name, row.quantity_sold, peso(row.revenue)]))}
      ${report.products.length ? "" : "<p>No served item sales for this period.</p>"}
    </section>
    <footer>Generated ${escapeHtml(generated)} · Summary of served sales. Customer names and payment proofs are excluded.</footer>`;

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(title)}</title>
        <style>
          :root { color-scheme: light; }
          body { margin: 0; padding: 32px; color: #30251f; background: #fff; font: 13px/1.5 Arial, sans-serif; }
          header { border-bottom: 2px solid #c5a274; margin-bottom: 22px; padding-bottom: 14px; }
          .eyebrow { color: #8d6748; font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
          h1 { margin: 6px 0; font: 600 30px Georgia, serif; }
          h2 { margin: 0 0 10px; font: 600 19px Georgia, serif; }
          section { margin: 16px 0; break-inside: avoid; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          th, td { padding: 6px 7px; border: 1px solid #e8dfd3; text-align: left; overflow-wrap: anywhere; }
          tr { break-inside: avoid; }
          th { background: #f5f0e9; }
          footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e8dfd3; color: #786d62; font-size: 10px; }
          .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
          .kpis article { min-width: 0; padding: 10px; border: 1px solid #e8dfd3; border-radius: 10px; background: #fbf8f3; }
          .kpis span, .kpis small { display: block; color: #786d62; }
          .kpis span { font-size: 10px; }
          .kpis strong { display: block; margin: 5px 0; font: 600 17px Georgia, serif; color: #553b2c; }
          .kpis small { font-size: 9px; }
          .visuals { display: grid; grid-template-columns: 1.5fr 1fr; gap: 20px; }
          .visuals > section { min-width: 0; }
          .bars { height: 150px; display: flex; align-items: stretch; gap: 5px; border-bottom: 1px solid #e8dfd3; }
          .bar-column { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
          .bar-track { height: calc(100% - 18px); width: 100%; display: flex; align-items: flex-end; justify-content: center; }
          .bar-column i { width: 65%; display: block; min-height: 1px; border-radius: 3px 3px 0 0; background: #9a704e; }
          .bar-column small { height: 18px; padding-top: 4px; color: #786d62; font-size: 8px; }
          .pie-layout { display: flex; align-items: center; gap: 24px; }
          .pie { width: 100px; height: 100px; flex: 0 0 auto; border-radius: 50%; }
          @page { size: landscape; margin: 14mm; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>${contents}<script>window.addEventListener("load", () => setTimeout(() => window.print(), 250));</script></body>
    </html>`;
}

function exportReport(report: AnalyticsReport): boolean {
  const html = buildReportHtml(report);
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    return true;
  }
  // Download fallback for phones / pop-up blockers.
  try {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `merrylane-analytics-${report.period}-${report.range.start}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

export function AdminAnalyticsReport() {
  const [period, setPeriod] = useState<Period>("month");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [orderType, setOrderType] = useState<OrderTypeFilter>("all");
  const [paymentMethod, setPaymentMethod] = useState<PaymentFilter>("all");
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const load = useCallback(async (
    requestedPeriod: Period,
    showLoading = false,
    override?: {
      startDate: string;
      endDate: string;
      orderType: OrderTypeFilter;
      paymentMethod: PaymentFilter;
    }
  ) => {
    const currentRequestId = ++requestId.current;
    if (showLoading) setLoading(true);
    try {
    const activeFilters = override || {
      startDate,
      endDate,
      orderType,
      paymentMethod,
    };
    const search = new URLSearchParams({
      period: requestedPeriod,
      order_type: activeFilters.orderType,
      payment_method: activeFilters.paymentMethod,
    });
    if (requestedPeriod === "custom" && activeFilters.startDate && activeFilters.endDate) {
      search.set("from", activeFilters.startDate);
      search.set("to", activeFilters.endDate);
    }
    const response = await fetchPortalApi(
      `/api/analytics/report?${search.toString()}`,
      { cache: "no-store" }
    );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to load analytics report.");
      }
      if (currentRequestId !== requestId.current) return;
      setReport(data as AnalyticsReport);
      setError("");
    } catch (cause: unknown) {
      if (currentRequestId !== requestId.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load analytics report."
      );
      setReport(null);
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, [endDate, orderType, paymentMethod, startDate]);

  usePolling(() => load(period), 30_000, {
    resources: ["analytics", "orders", "payments", "sales", "stock"],
  });

  const animationKey = report ? reportAnimationKey(report) : "";
  const menuEngineeringItems =
    report?.analytics.menu_performance.filter((item) => item.quantity_sold > 0) ?? [];
  return (
    <section className="card admin-analysis analytics-report" key={period}>
      <div className="chart-head analytics-report-head">
        <div>
          <h2>Performance report</h2>
          <p>Explore actual sales, order mix, item performance, and period-over-period trends.</p>
        </div>
        <div className="analytics-export-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={!report || loading}
            onClick={() => {
              try {
                if (report && !exportReport(report)) {
                  setError("Unable to export analytics. Please allow pop-ups or downloads and try again.");
                }
              } catch {
                setError("Unable to open the analytics export.");
              }
            }}
          >
            <Icon name="download" className="icon-sm" /> Print analytics
          </button>
        </div>
      </div>

      <div
        className="best-seller-periods analytics-periods"
        role="group"
        aria-label="Analytics reporting period"
      >
        {PERIODS.map((option) => (
          <button
            type="button"
            key={option.value}
            className={period === option.value ? "active" : ""}
            aria-pressed={period === option.value}
            onClick={() => {
              setPeriod(option.value);
              if (option.value === "custom") {
                setStartDate(report?.range.start || "");
                setEndDate(report?.range.end || "");
              } else {
                void load(option.value, true);
              }
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="analytics-filter-bar">
        {period === "custom" && (
          <>
            <label>
              Start date
              <input
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
          </>
        )}
        <label>
          Order type
          <select
            value={orderType}
            onChange={(event) => setOrderType(event.target.value as OrderTypeFilter)}
          >
            <option value="all">All order types</option>
            <option value="dine_in">Dine-in</option>
            <option value="take_out">Take-out</option>
          </select>
        </label>
        <label>
          Payment method
          <select
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value as PaymentFilter)}
          >
            <option value="all">All payment methods</option>
            <option value="counter">Counter</option>
            <option value="cash">Cash</option>
            <option value="gcash">GCash</option>
          </select>
        </label>
        <div className="analytics-filter-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={loading || (period === "custom" && (!startDate || !endDate))}
            onClick={() => void load(period, true)}
          >
            Apply filters
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={loading}
            onClick={() => {
              const defaults = {
                startDate: "",
                endDate: "",
                orderType: "all" as const,
                paymentMethod: "all" as const,
              };
              setStartDate("");
              setEndDate("");
              setOrderType("all");
              setPaymentMethod("all");
              setPeriod("last7");
              void load("last7", true, defaults);
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {error && <div className="error-strip" role="alert">{error}</div>}
      {loading ? (
        <div
          className="portal-page-skeleton portal-page-skeleton-admin portal-page-skeleton-analysis"
          role="status"
          aria-busy="true"
          aria-label="Loading business analysis"
        >
          <div className="portal-skeleton-content" aria-hidden="true">
            <SkeletonStats count={4} darkFirst />
            <div className="dashboard-grid">
              <SkeletonChart />
              <SkeletonPanel rows={5} className="portal-skeleton-best-sellers" />
            </div>
            <div className="dashboard-grid">
              <SkeletonPanel rows={4} />
              <SkeletonPanel rows={4} />
            </div>
            <SkeletonTable columns={6} rows={5} />
          </div>
        </div>
      ) : !report ? (
        <div className="empty-panel" role="status">
          No report data available.
        </div>
      ) : (
        <>
          <div className="analytics-report-range">
            <span className="analytics-report-range-primary">
              {report.range.start} – {report.range.end}
            </span>
            <span>
              Compared with {report.comparison.start} – {report.comparison.end}
            </span>
          </div>
          <div className="analytics-kpis" key={`kpis-${animationKey}`}>
            <article>
              <span>Served revenue</span>
              <AnimatedKpi
                value={report.summary.revenue}
                format="currency"
                label="Served revenue"
              />
              <small>
                {report.summary.revenue_change_pct === null
                  ? "No previous-period sales to compare"
                  : `${report.summary.revenue_change_pct > 0 ? "+" : ""}${report.summary.revenue_change_pct}% vs previous period`}
              </small>
            </article>
            <article>
              <span>Served orders</span>
              <AnimatedKpi
                value={report.summary.order_count}
                format="number"
                label="Served orders"
              />
              <small>
                {report.summary.order_change_pct === null
                  ? "No previous-period orders to compare"
                  : `${report.summary.order_change_pct > 0 ? "+" : ""}${report.summary.order_change_pct}% vs previous period`}
              </small>
            </article>
            <article>
              <span>Average order value</span>
              <AnimatedKpi
                value={report.summary.average_order_value}
                format="currency"
                label="Average order value"
              />
              <small>Average of served orders</small>
            </article>
            <article>
              <span>Cancelled orders</span>
              <AnimatedKpi
                value={report.summary.cancelled_orders}
                format="number"
                label="Cancelled orders"
              />
              <small>Created during this period</small>
            </article>
            <article>
              <span>Average confirmed-to-served</span>
              {report.analytics.timing.confirmed_to_ready_samples > 0 ? (
                <AnimatedKpi
                  value={report.summary.average_wait_minutes}
                  format="number"
                  label="Average confirmed-to-served minutes"
                />
              ) : <strong aria-label="Average confirmed-to-served: no timestamp data">—</strong>}
              <small>{report.analytics.timing.confirmed_to_ready_samples > 0 ? "Minutes · only served orders with both timestamps" : "No served-time data for this period"}</small>
            </article>
            <article>
              <span>Pending payment checks</span>
              <AnimatedKpi
                value={report.summary.pending_payment_verifications}
                format="number"
                label="Pending payment verifications"
              />
              <small>Orders created within this period</small>
            </article>
            <article>
              <span>Average customer rating</span>
              {report.summary.review_count > 0 ? (
                <AnimatedKpi
                  value={report.summary.average_rating}
                  format="decimal"
                  label="Average customer rating"
                />
              ) : <strong aria-label="Average customer rating: no reviews">—</strong>}
              <small>{report.summary.review_count > 0 ? `${report.summary.review_count} reviews · / 5` : "No review data for this period"}</small>
            </article>
            <article>
              <span>Currently out of stock</span>
              <AnimatedKpi
                value={report.summary.items_out_of_stock}
                format="number"
                label="Currently out of stock"
              />
              <small>Active, stock-tracked menu items</small>
            </article>
          </div>

          <div className="analytics-insights">
            <article>
              <Icon name="trending-up" size={15} />
              <span>{report.insights.revenue_trend}</span>
            </article>
            <article>
              <Icon name="coffee" size={15} />
              <span>{report.insights.leading_product}</span>
            </article>
            <article>
              <Icon name="clock" size={15} />
              <span>{report.insights.busiest_hour}</span>
            </article>
          </div>

          <div className="analytics-charts" key={`charts-${animationKey}`}>
            <RevenueBarChart report={report} buckets={salesBuckets(report)} />
            <PaymentMixChart report={report} />
          </div>

          <div className="analytics-module-grid">
            <SalesTrendChart report={report} />
            <PeakHourHeatmap report={report} />

            <section className="analytics-module-card">
              <header>
                <h3>Menu performance &amp; engineering</h3>
                <p>Quantity, revenue contribution, and extras attach rate guide promotion and menu changes.</p>
              </header>
              {report.analytics.menu_performance.length ? (
                <>
                  <div className="analytics-horizontal-bars">
                    {report.analytics.menu_performance.slice(0, 10).map((item) => {
                      const maxQuantity = Math.max(1, ...report.analytics.menu_performance.map((row) => row.quantity_sold));
                      return (
                        <div className="analytics-horizontal-row" key={item.menu_item_id}>
                          <span title={item.name}>{item.name}</span>
                          <i><b style={{ width: `${(item.quantity_sold / maxQuantity) * 100}%` }} /></i>
                          <strong>{item.quantity_sold}</strong>
                        </div>
                      );
                    })}
                  </div>
                  {menuEngineeringItems.length ? (
                    <div className="analytics-scatter-wrap">
                      <svg viewBox="0 0 360 180" role="img" aria-label="Menu engineering matrix">
                        <line x1="35" y1="150" x2="345" y2="150" className="chart-grid-line" />
                        <line x1="35" y1="15" x2="35" y2="150" className="chart-grid-line" />
                        {menuEngineeringItems.map((item) => {
                          const maxQuantity = Math.max(1, ...menuEngineeringItems.map((row) => row.quantity_sold));
                          const maxRevenue = Math.max(1, ...menuEngineeringItems.map((row) => row.revenue));
                          const x = 42 + (item.quantity_sold / maxQuantity) * 290;
                          const y = 142 - (item.revenue / maxRevenue) * 120;
                          return <circle key={item.menu_item_id} cx={x} cy={y} r="5" className={`menu-point ${item.classification.toLowerCase()}`}>
                            <title>{item.name}: {item.quantity_sold} sold, {peso(item.revenue)}, {item.classification}</title>
                          </circle>;
                        })}
                        <text x="180" y="174" textAnchor="middle">Popularity · quantity sold</text>
                        <text x="12" y="85" transform="rotate(-90 12 85)" textAnchor="middle">Revenue</text>
                      </svg>
                    </div>
                  ) : (
                    <div className="analytics-empty">No served item sales to compare in the menu matrix.</div>
                  )}
                  <div className="analytics-engineering-legend">
                    <span><i className="star" />Star · high popularity / high revenue</span>
                    <span><i className="plowhorse" />Plowhorse · high popularity / lower revenue</span>
                    <span><i className="puzzle" />Puzzle · lower popularity / high revenue</span>
                    <span><i className="dog" />Dog · lower popularity / lower revenue</span>
                  </div>
                  <div className="data-table-wrap">
                    <table className="data-table">
                      <thead><tr><th>Menu item</th><th>Qty</th><th>Revenue</th><th>Share</th><th>Extras attach</th><th>Class</th></tr></thead>
                      <tbody>{report.analytics.menu_performance.map((item) => (
                        <tr key={item.menu_item_id}>
                          <td>{item.name}</td><td>{item.quantity_sold}</td><td>{peso(item.revenue)}</td>
                          <td>{item.sales_share_pct}%</td><td>{item.extras_attach_rate_pct}%</td><td>{item.classification}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  {report.analytics.menu_bottom.length > 0 && (
                    <p className="analytics-module-note">
                      Lowest-selling menu items · {report.analytics.menu_bottom.map((item) => `${item.name} (${item.quantity_sold})`).join(", ")}.
                    </p>
                  )}
                  <p className="analytics-module-note">Matrix compares each item with the active menu average; “revenue” uses item revenue, not profit (cost data is not stored).</p>
                </>
              ) : <div className="analytics-chart-empty">No active menu items found.</div>}
            </section>

            <section className="analytics-module-card">
              <header>
                <h3>Order timing &amp; live queue</h3>
                <p>Use stage delays to identify handoff bottlenecks.</p>
              </header>
              <div className="analytics-stage-bars">
                {[
                  ["Submitted → confirmed", report.analytics.timing.confirmation_minutes, report.analytics.timing.confirmation_samples],
                  ["Confirmed → preparing", report.analytics.timing.confirmed_to_preparing_minutes, report.analytics.timing.confirmed_to_preparing_samples],
                  ["Preparing → served", report.analytics.timing.preparing_to_ready_minutes, report.analytics.timing.preparing_to_ready_samples],
                  ["Confirmed → served", report.analytics.timing.confirmed_to_ready_minutes, report.analytics.timing.confirmed_to_ready_samples],
                ].map(([label, minutes, samples]) => {
                  const duration = Number(minutes);
                  return <div key={String(label)}><span>{label}</span><b>{Number(samples) > 0 ? `${duration.toFixed(1)} min` : "No timestamp data"}</b><i><em style={{ width: `${Math.min(100, duration * 2)}%` }} /></i></div>;
                })}
              </div>
              <p className="analytics-module-note">Stage averages include served orders with both timestamps. The preparing stage starts collecting data for new orders after the migration.</p>
              <h4>Open orders · oldest first</h4>
              {report.analytics.pending_orders.length ? (
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Order</th><th>Status</th><th>Payment</th><th>Elapsed</th></tr></thead>
                    <tbody>{report.analytics.pending_orders.map((order) => (
                      <tr key={order.id}>
                        <td>#{order.id}</td><td>{order.status.replaceAll("_", " ")}</td>
                        <td>{order.payment_method} · {order.payment_status}</td>
                        <td>{order.elapsed_minutes} min</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <div className="analytics-chart-empty">No open orders in this filtered period.</div>}
            </section>

            <section className="analytics-module-card">
              <header><h3>Payment verification</h3><p>Manual workload and verification status</p></header>
              <div className="analytics-status-bars">
                {[
                  ["Pending", Number(report.analytics.payment_verification.pending || 0), "pending"],
                  ["Verified", Number(report.analytics.payment_verification.verified || 0), "verified"],
                  ["Rejected", Number(report.analytics.payment_verification.rejected || 0), "rejected"],
                ].map(([label, count, status]) => (
                  <div key={String(status)}><span>{label}</span><strong>{count}</strong><i><b className={String(status)} style={{ width: `${Math.min(100, (Number(count) / Math.max(1, report.orders.length)) * 100)}%` }} /></i></div>
                ))}
              </div>
              <p className="analytics-module-note">Counts include all payment methods. Balance payment verification times are available where verified timestamps exist.</p>
              {report.analytics.payment_verification.balance_payments.length ? (
                <div className="data-table-wrap">
                  <table className="data-table"><thead><tr><th>Method</th><th>Status</th><th>Count</th><th>Amount</th><th>Avg verify</th></tr></thead>
                    <tbody>{report.analytics.payment_verification.balance_payments.map((row) => (
                      <tr key={`${row.payment_method}-${row.status}`}><td>{row.payment_method}</td><td>{row.status}</td><td>{row.payment_count}</td><td>{peso(row.amount)}</td><td>{row.average_verification_minutes.toFixed(1)} min</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <div className="analytics-chart-empty">No additional balance-payment records in this range.</div>}
              <h4>Pending order payments</h4>
              {report.analytics.pending_orders.filter((order) => order.payment_status === "pending").length ? (
                <div className="data-table-wrap">
                  <table className="data-table"><thead><tr><th>Order</th><th>Method</th><th>Amount</th><th>Waiting</th></tr></thead>
                    <tbody>{report.analytics.pending_orders.filter((order) => order.payment_status === "pending").map((order) => (
                      <tr key={order.id}><td>#{order.id}</td><td>{order.payment_method}</td><td>{peso(order.total)}</td><td>{order.elapsed_minutes} min</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <div className="analytics-chart-empty">No pending order payments in this range.</div>}
              <p className="analytics-module-note">Receipt links are shown only on the admin analytics page and are excluded from CSV/PDF/JPG exports.</p>
              <h4>Pending GCash proofs</h4>
              {report.analytics.pending_gcash.length ? (
                <div className="data-table-wrap">
                  <table className="data-table"><thead><tr><th>Order</th><th>Amount</th><th>Waiting</th><th>Receipt</th></tr></thead>
                    <tbody>{report.analytics.pending_gcash.map((payment) => (
                      <tr key={payment.id}><td>#{payment.id}</td><td>{peso(payment.total)}</td><td>{payment.elapsed_minutes} min</td>
                        <td>{payment.inline_proof
                          ? <a href={`/api/analytics/report/payment-proof/${payment.id}`} target="_blank" rel="noreferrer">View proof</a>
                          : payment.external_proof_url
                            ? <a href={payment.external_proof_url} target="_blank" rel="noreferrer">View proof</a>
                            : "Not uploaded"}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <div className="analytics-chart-empty">No pending GCash proof checks in this period.</div>}
            </section>

            <section className="analytics-module-card">
              <header><h3>Stock availability</h3><p>Prioritize repeated stockouts and active low-stock warnings.</p></header>
              {report.analytics.stock_events.length ? (
                <div className="analytics-horizontal-bars">
                  {report.analytics.stock_events.slice(0, 10).map((item) => {
                    const maxEvents = Math.max(1, ...report.analytics.stock_events.map((row) => row.out_events));
                    return <div className="analytics-horizontal-row" key={item.menu_item_id}>
                      <span title={item.name}>{item.name}</span><i><b style={{ width: `${(item.out_events / maxEvents) * 100}%` }} /></i><strong>{item.out_events}</strong>
                    </div>;
                  })}
                </div>
              ) : <div className="analytics-chart-empty">No stockout events were logged during this period.</div>}
              <div className="data-table-wrap">
                <table className="data-table"><thead><tr><th>Current item</th><th>Status</th><th>Remaining</th><th>Note</th></tr></thead>
                  <tbody>{report.analytics.current_stock.map((item) => (
                    <tr key={item.menu_item_id}><td>{item.name}</td><td>{item.stock_status}</td><td>{item.stock_count}</td><td>{item.stock_note || "—"}</td></tr>
                  ))}</tbody>
                </table>
                {!report.analytics.current_stock.length && <div className="analytics-chart-empty">No active low/out stock warnings.</div>}
              </div>
            </section>

            <section className="analytics-module-card">
              <header><h3>Waiter calls</h3><p>Requests by reason and hour help plan floor coverage.</p></header>
              {report.analytics.waiter_reason_counts.length ? (
                <div className="analytics-waiter-bars">
                  {report.analytics.waiter_reason_counts.slice(0, 12).map((row, index) => (
                    <div key={`${row.request_type}-${row.hour}`}>
                      <span>{row.request_type} · {String(row.hour).padStart(2, "0")}:00</span>
                      <i><b style={{ height: `${Math.min(100, (row.call_count / Math.max(1, ...report.analytics.waiter_reason_counts.map((item) => item.call_count))) * 100)}%`, animationDelay: `${index * 20}ms` }} /></i>
                      <strong>{row.call_count}</strong>
                    </div>
                  ))}
                </div>
              ) : <div className="analytics-chart-empty">No waiter requests for this period.</div>}
              <div className="data-table-wrap">
                <table className="data-table"><thead><tr><th>Table</th><th>Reason</th><th>Status</th><th>Time</th><th>Resolution</th></tr></thead>
                  <tbody>{report.analytics.waiter_calls.slice(0, 20).map((call) => (
                    <tr key={call.id}><td>{call.table_number}</td><td>{call.request_type}</td><td>{call.status}</td><td>{call.created_at}</td>
                      <td>{call.resolution_minutes === null ? "Open" : `${call.resolution_minutes} min`}</td></tr>
                  ))}</tbody>
                </table>
                {!report.analytics.waiter_calls.length && <div className="analytics-chart-empty">No waiter calls recorded.</div>}
              </div>
            </section>

            <section className="analytics-module-card">
              <header><h3>Customer feedback</h3><p>{report.analytics.review_rate_pct}% reviews per confirmed order · no automated sentiment analysis</p></header>
              <div className="analytics-rating-bars">
                {report.analytics.rating_distribution.map((row) => (
                  <div key={row.rating}><span>{row.rating}★</span><i><b style={{ width: `${report.summary.review_count ? (row.review_count / report.summary.review_count) * 100 : 0}%` }} /></i><strong>{row.review_count}</strong></div>
                ))}
              </div>
              <div className="data-table-wrap">
                <table className="data-table"><thead><tr><th>Rating</th><th>Review</th><th>Date</th></tr></thead>
                  <tbody>{report.analytics.recent_reviews.map((review) => (
                    <tr key={review.id}><td>{review.rating} / 5</td><td>{review.comment || "No written comment"}</td><td>{review.created_at}</td></tr>
                  ))}</tbody>
                </table>
                {!report.analytics.recent_reviews.length && <div className="analytics-chart-empty">No reviews linked to orders in this range.</div>}
              </div>
            </section>

            <section className="analytics-module-card">
              <header><h3>Dine-in vs take-out</h3><p>Order mix and average ticket size</p></header>
              {report.analytics.order_type_mix.length ? (
                <>
                  <div className="analytics-type-mix" style={{ background: orderTypeGradient(report.analytics.order_type_mix) }} />
                  <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Order type</th><th>Orders</th><th>Revenue</th><th>Avg ticket</th></tr></thead>
                    <tbody>{report.analytics.order_type_mix.map((row) => (
                      <tr key={row.order_type}><td>{row.order_type.replaceAll("_", " ")}</td><td>{row.order_count}</td><td>{peso(row.revenue)}</td><td>{peso(row.average_order_value)}</td></tr>
                    ))}</tbody>
                  </table></div>
                </>
              ) : <div className="analytics-chart-empty">No served orders to compare.</div>}
              <div className="analytics-forecast-placeholder"><strong>Forecast vs actual</strong><span>{report.analytics.forecast_status}</span></div>
            </section>

            <section className="analytics-module-card">
              <header><h3>System health &amp; data coverage</h3><p>Signals should be instrumented before drawing operational conclusions.</p></header>
              <div className="analytics-forecast-placeholder">
                <strong>Wi-Fi denials and abandoned QR sessions</strong>
                <span>The current schema does not record access denials, QR scans, or menu-view events. Those conversion-loss metrics are unavailable until access logging is added.</span>
              </div>
              <div className="analytics-forecast-placeholder">
                <strong>Historical queue length</strong>
                <span>Active orders and waiter requests are available, but queue-length snapshots are not stored. Historical average queue length cannot be calculated reliably.</span>
              </div>
              <div className="analytics-forecast-placeholder">
                <strong>Cancellation reasons</strong>
                <span>{report.analytics.cancellation_reasons.length
                  ? report.analytics.cancellation_reasons.map((row) => `${row.cancellation_reason || "Unspecified"} (${row.order_count})`).join(" · ")
                  : "No cancelled orders were recorded in this period."}</span>
              </div>
            </section>
          </div>

          <div className="analytics-report-grid">
            <section>
              <h3>Daily sales</h3>
              <div className="data-table-wrap">
                <table className="data-table data-table-stack">
                  <thead>
                    <tr><th>Date</th><th>Orders</th><th>Revenue</th></tr>
                  </thead>
                  <tbody>
                    {[...report.daily_sales].reverse().map((day) => (
                      <tr key={day.date}>
                        <td data-label="Date">{day.date}</td>
                        <td data-label="Orders">{day.order_count}</td>
                        <td data-label="Revenue"><strong>{peso(day.revenue)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

          </div>
          <div className="analytics-report-foot">
            <span>
              Includes {report.orders.length} orders and {report.order_items.length} line items.
              Personal customer details and payment proofs are excluded from exports.
            </span>
            <span>
              Generated {new Date(report.generated_at).toLocaleString("en-PH", {
                timeZone: "Asia/Manila",
              })}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
