import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { peso } from "@/lib/format";

export type ReportPeriod = "today" | "week" | "month" | "year" | "last7" | "last30" | "custom";
export type ReportFilters = {
  period: ReportPeriod;
  start?: string;
  end?: string;
  orderType?: "all" | "dine_in" | "take_out";
  paymentMethod?: "all" | "gcash" | "counter" | "cash";
};

const VALID_PERIODS = new Set<ReportPeriod>([
  "today",
  "week",
  "month",
  "year",
  "last7",
  "last30",
  "custom",
]);
const SALES_STATUSES = "'ready','completed'";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function buildFilterSql(
  alias: string,
  orderType: ReportFilters["orderType"],
  paymentMethod: ReportFilters["paymentMethod"]
) {
  let sql = "";
  const params: string[] = [];
  if (orderType && orderType !== "all") {
    sql += ` AND ${alias}.order_type = ?`;
    params.push(orderType);
  }
  if (paymentMethod && paymentMethod !== "all") {
    sql += ` AND ${alias}.payment_method = ?`;
    params.push(paymentMethod);
  }
  return { sql, params };
}

function manilaDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Unable to determine the reporting date.");
  }
  return `${year}-${month}-${day}`;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateRange(period: ReportPeriod, today: string) {
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const start =
    period === "today"
      ? today
      : period === "last7"
        ? shiftDate(today, -6)
        : period === "last30"
          ? shiftDate(today, -29)
      : period === "week"
        ? shiftDate(today, -((todayDate.getUTCDay() + 6) % 7))
        : period === "month"
          ? `${today.slice(0, 7)}-01`
          : `${today.slice(0, 4)}-01-01`;
  const dayCount =
    Math.round(
      (todayDate.getTime() - new Date(`${start}T00:00:00.000Z`).getTime()) /
        86_400_000
    ) + 1;
  return {
    start,
    end: today,
    previous_start: shiftDate(start, -dayCount),
    previous_end: shiftDate(start, -1),
    day_count: dayCount,
  };
}

async function reportFor(filters: ReportFilters, includePaymentProofs = true) {
  const today = manilaDate();
  const period = filters.period;
  const range =
    period === "custom" && filters.start && filters.end
      ? (() => {
          const dayCount =
            Math.round(
              (new Date(`${filters.end}T00:00:00.000Z`).getTime() -
                new Date(`${filters.start}T00:00:00.000Z`).getTime()) /
                86_400_000
            ) + 1;
          return {
            start: filters.start!,
            end: filters.end!,
            previous_start: shiftDate(filters.start!, -dayCount),
            previous_end: shiftDate(filters.start!, -1),
            day_count: dayCount,
          };
        })()
      : dateRange(period === "custom" ? "week" : period, today);
  const orderFilters = buildFilterSql(
    "o",
    filters.orderType,
    filters.paymentMethod
  );
  const baseArgs = [range.start, range.end, ...orderFilters.params];
  const comparisonArgs = [
    range.previous_start,
    range.previous_end,
    ...orderFilters.params,
  ];
  const db = getDb();
  const summary = await db
    .prepare(
      `SELECT COUNT(*) AS order_count,
              COALESCE(SUM(total), 0) AS revenue,
              COALESCE(AVG(total), 0) AS average_order_value
       FROM orders o
       WHERE o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL
         AND o.payment_status = 'verified'
         AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}`
    )
    .get(...baseArgs) as {
    order_count: number;
    revenue: number;
    average_order_value: number;
  };
  const previous = await db
    .prepare(
      `SELECT COUNT(*) AS order_count,
              COALESCE(SUM(total), 0) AS revenue
       FROM orders o
       WHERE o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL
         AND o.payment_status = 'verified'
         AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}`
    )
    .get(...comparisonArgs) as {
    order_count: number;
    revenue: number;
  };
  const dailyRows = await db
    .prepare(
      `SELECT DATE(created_at) AS date,
              COUNT(*) AS order_count,
              COALESCE(SUM(total), 0) AS revenue
       FROM orders o
       WHERE o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL
         AND o.payment_status = 'verified'
         AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
       GROUP BY DATE(o.created_at)
       ORDER BY date`
    )
    .all(...baseArgs) as {
    date: string;
    order_count: number;
    revenue: number;
  }[];
  const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]));
  const dailySales = Array.from({ length: range.day_count }, (_, index) => {
    const date = shiftDate(range.start, index);
    return dailyByDate.get(date) || { date, order_count: 0, revenue: 0 };
  });
  const products = await db
    .prepare(
      `SELECT oi.menu_item_id,
              oi.name,
              SUM(oi.quantity) AS quantity_sold,
              COALESCE(SUM(oi.price_at_time * oi.quantity), 0) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL
         AND o.payment_status = 'verified'
         AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
       GROUP BY oi.menu_item_id, oi.name
       ORDER BY quantity_sold DESC, revenue DESC`
    )
    .all(...baseArgs) as {
    menu_item_id: number | null;
    name: string;
    quantity_sold: number;
    revenue: number;
  }[];
  const peakHours = await db
    .prepare(
      `SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour,
              COUNT(*) AS order_count,
              COALESCE(SUM(total), 0) AS revenue
       FROM orders o
       WHERE o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL
         AND o.payment_status = 'verified'
         AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
       GROUP BY hour
       ORDER BY order_count DESC, revenue DESC`
    )
    .all(...baseArgs) as {
    hour: number;
    order_count: number;
    revenue: number;
  }[];
  const paymentMethods = await db
    .prepare(
      `SELECT payment_method,
              COUNT(*) AS order_count,
              COALESCE(SUM(total), 0) AS revenue
       FROM orders o
       WHERE o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL
         AND o.payment_status = 'verified'
         AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
       GROUP BY payment_method
       ORDER BY revenue DESC`
    )
    .all(...baseArgs) as {
    payment_method: string;
    order_count: number;
    revenue: number;
  }[];
  const orders = await db
    .prepare(
      `SELECT id, table_number, order_type,
              CASE WHEN status IN (${SALES_STATUSES}) AND ready_at IS NOT NULL
                THEN 'served' ELSE status END AS status,
              payment_method,
              payment_status, subtotal, service_charge, total, created_at,
              confirmed_at, completed_at, cancelled_at
       FROM orders o
       WHERE DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
       ORDER BY o.created_at DESC, o.id DESC`
    )
    .all(...baseArgs) as {
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
  const orderItems = await db
    .prepare(
      `SELECT oi.order_id, oi.name, oi.variant_name, oi.extras,
              oi.sugar_level, oi.quantity, oi.price_at_time
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
       ORDER BY oi.order_id DESC, oi.id`
    )
    .all(...baseArgs) as {
    order_id: number;
    name: string;
    variant_name: string | null;
    extras: string;
    sugar_level: string | null;
    quantity: number;
    price_at_time: number;
  }[];
  const waitStats = await db
  .prepare(
    `SELECT COALESCE(AVG((julianday(o.ready_at) - julianday(o.confirmed_at)) * 1440), 0) AS average_wait_minutes,
            COUNT(*) AS sample_count
     FROM orders o
     WHERE o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL
       AND o.payment_status = 'verified'
       AND o.confirmed_at IS NOT NULL AND o.ready_at IS NOT NULL
       AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}`
  )
  .get(...baseArgs) as { average_wait_minutes: number; sample_count: number };
  const paymentVerificationCounts = await db
  .prepare(
    `SELECT
       SUM(CASE WHEN o.payment_status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN o.payment_status = 'verified' THEN 1 ELSE 0 END) AS verified,
       SUM(CASE WHEN o.payment_status = 'rejected' THEN 1 ELSE 0 END) AS rejected
     FROM orders o
     WHERE DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}`
  )
  .get(...baseArgs) as {
  pending: number | null;
  verified: number | null;
  rejected: number | null;
  };
  const averageRating = await db
  .prepare(
    `SELECT COALESCE(AVG(r.rating), 0) AS average_rating, COUNT(*) AS review_count
     FROM reviews r
     JOIN orders o ON o.id = r.order_id
     WHERE DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}`
  )
  .get(...baseArgs) as { average_rating: number; review_count: number };
  const itemsOutOfStock = await db
  .prepare(
    `SELECT COUNT(*) AS count FROM menu_items
     WHERE is_active = 1 AND stock_tracking_enabled = 1 AND stock_status = 'out'`
  )
  .get() as { count: number };
  const heatmap = await db
  .prepare(
    `SELECT CAST(strftime('%w', o.created_at) AS INTEGER) AS weekday,
            CAST(strftime('%H', o.created_at) AS INTEGER) AS hour,
            COUNT(*) AS order_count,
            COALESCE(SUM(o.total), 0) AS revenue
     FROM orders o
     WHERE o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL
       AND o.payment_status = 'verified'
       AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
     GROUP BY weekday, hour ORDER BY weekday, hour`
  )
  .all(...baseArgs) as {
  weekday: number;
  hour: number;
  order_count: number;
  revenue: number;
  }[];
  const hourlySales = await db
  .prepare(
    `SELECT strftime('%Y-%m-%d %H:00', o.created_at) AS hour,
            COUNT(*) AS order_count, COALESCE(SUM(o.total), 0) AS revenue
     FROM orders o
     WHERE o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL
       AND o.payment_status = 'verified'
       AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
     GROUP BY hour ORDER BY hour`
  )
  .all(...baseArgs) as {
  hour: string;
  order_count: number;
  revenue: number;
  }[];
  const timingStats = await db
  .prepare(
    `SELECT
       COALESCE(AVG(CASE WHEN confirmed_at IS NOT NULL THEN
         (julianday(confirmed_at) - julianday(created_at)) * 1440 END), 0) AS confirmation_minutes,
       COUNT(CASE WHEN confirmed_at IS NOT NULL THEN 1 END) AS confirmation_samples,
       COALESCE(AVG(CASE WHEN preparing_at IS NOT NULL AND confirmed_at IS NOT NULL THEN
         (julianday(preparing_at) - julianday(confirmed_at)) * 1440 END), 0) AS confirmed_to_preparing_minutes,
       COUNT(CASE WHEN preparing_at IS NOT NULL AND confirmed_at IS NOT NULL THEN 1 END) AS confirmed_to_preparing_samples,
       COALESCE(AVG(CASE WHEN ready_at IS NOT NULL AND preparing_at IS NOT NULL THEN
         (julianday(ready_at) - julianday(preparing_at)) * 1440 END), 0) AS preparing_to_ready_minutes,
       COUNT(CASE WHEN ready_at IS NOT NULL AND preparing_at IS NOT NULL THEN 1 END) AS preparing_to_ready_samples
     FROM orders o
       WHERE o.status IN (${SALES_STATUSES})
         AND o.ready_at IS NOT NULL
         AND o.payment_status = 'verified'
         AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}`
  )
  .get(...baseArgs) as {
  confirmation_minutes: number;
  confirmation_samples: number;
  confirmed_to_preparing_minutes: number;
  confirmed_to_preparing_samples: number;
  preparing_to_ready_minutes: number;
  preparing_to_ready_samples: number;
  };
  const pendingOrders = await db
  .prepare(
    `SELECT o.id, o.order_type, o.payment_method, o.payment_status,
            o.total, o.created_at, o.confirmed_at, o.status,
            CASE WHEN o.payment_status = 'rejected'
              THEN 0
              ELSE MAX(0, CAST((julianday('now','localtime') - julianday(o.created_at)) * 1440 AS INTEGER))
            END AS elapsed_minutes
     FROM orders o
     WHERE o.status IN ('pending','payment_pending','confirmed','preparing')
       AND o.payment_status != 'rejected'
       AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
     ORDER BY o.created_at ASC LIMIT 50`
  )
  .all(...baseArgs) as {
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
  const pendingGcash = await db
  .prepare(
    `SELECT o.id, o.total, o.created_at,
            CASE WHEN ? = 1 AND o.payment_proof_url LIKE 'http%'
              THEN o.payment_proof_url ELSE NULL END AS external_proof_url,
            CASE WHEN ? = 1 AND o.payment_proof_url LIKE 'data:image/%'
              THEN 1 ELSE 0 END AS inline_proof,
            MAX(0, CAST((julianday('now','localtime') - julianday(o.created_at)) * 1440 AS INTEGER)) AS elapsed_minutes
     FROM orders o
     WHERE o.payment_method = 'gcash' AND o.payment_status = 'pending'
       AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
     ORDER BY o.created_at ASC LIMIT 50`
  )
  .all(includePaymentProofs ? 1 : 0, includePaymentProofs ? 1 : 0, ...baseArgs) as {
  id: number;
  total: number;
  created_at: string;
  external_proof_url: string | null;
  inline_proof: number;
  elapsed_minutes: number;
  }[];
  const menuPerformance = await db
  .prepare(
    `SELECT m.id AS menu_item_id, m.name, m.is_active, m.stock_status,
            COALESCE(SUM(CASE WHEN o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL AND o.payment_status = 'verified' THEN oi.quantity ELSE 0 END), 0) AS quantity_sold,
            COALESCE(SUM(CASE WHEN o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL AND o.payment_status = 'verified' THEN oi.price_at_time * oi.quantity ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(CASE WHEN o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL AND o.payment_status = 'verified'
              AND oi.extras IS NOT NULL AND oi.extras NOT IN ('', '[]', 'null')
              THEN oi.quantity ELSE 0 END), 0) AS extras_quantity
     FROM menu_items m
     LEFT JOIN order_items oi ON oi.menu_item_id = m.id
     LEFT JOIN orders o ON o.id = oi.order_id
       AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
     WHERE m.is_active = 1
     GROUP BY m.id, m.name, m.is_active, m.stock_status
     ORDER BY quantity_sold DESC, revenue DESC`
  )
  .all(...baseArgs) as {
  menu_item_id: number;
  name: string;
  is_active: number;
  stock_status: string;
  quantity_sold: number;
  revenue: number;
  extras_quantity: number;
  }[];
  const stockEvents = await db
  .prepare(
    `SELECT sl.menu_item_id, m.name,
            SUM(CASE WHEN sl.action = 'out_of_stock' THEN 1 ELSE 0 END) AS out_events,
            MAX(sl.created_at) AS last_event
     FROM stock_logs sl JOIN menu_items m ON m.id = sl.menu_item_id
     WHERE DATE(sl.created_at) >= ? AND DATE(sl.created_at) <= ?
     GROUP BY sl.menu_item_id, m.name ORDER BY out_events DESC, m.name`
  )
  .all(range.start, range.end) as {
  menu_item_id: number;
  name: string;
  out_events: number;
  last_event: string;
  }[];
  const currentStock = await db
  .prepare(
    `SELECT id AS menu_item_id, name, stock_count, low_stock_threshold,
            stock_status, stock_note
     FROM menu_items
     WHERE is_active = 1 AND stock_tracking_enabled = 1
       AND stock_status IN ('out','low')
     ORDER BY CASE stock_status WHEN 'out' THEN 0 ELSE 1 END, stock_count, name`
  )
  .all() as {
  menu_item_id: number;
  name: string;
  stock_count: number;
  low_stock_threshold: number;
  stock_status: string;
  stock_note: string | null;
  }[];
  const waiterCalls = await db
  .prepare(
    `SELECT wr.id, wr.request_type, wr.status, wr.created_at,
            wr.acknowledged_at, wr.resolved_at, wr.table_number,
            CAST(strftime('%H', wr.created_at) AS INTEGER) AS hour,
            CASE WHEN wr.resolved_at IS NOT NULL
              THEN MAX(0, CAST((julianday(wr.resolved_at) - julianday(wr.created_at)) * 1440 AS INTEGER))
              ELSE NULL END AS resolution_minutes
     FROM waiter_requests wr
     LEFT JOIN orders o ON o.id = wr.order_id
     WHERE DATE(wr.created_at) >= ? AND DATE(wr.created_at) <= ?
       AND ${orderFilters.sql ? `o.id IS NOT NULL${orderFilters.sql}` : "1 = 1"}
     ORDER BY wr.created_at DESC LIMIT 100`
  )
  .all(range.start, range.end, ...(orderFilters.sql ? orderFilters.params : [])) as {
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
  const waiterReasonCounts = await db
  .prepare(
    `SELECT wr.request_type, CAST(strftime('%H', wr.created_at) AS INTEGER) AS hour,
            COUNT(*) AS call_count
     FROM waiter_requests wr
     LEFT JOIN orders o ON o.id = wr.order_id
     WHERE DATE(wr.created_at) >= ? AND DATE(wr.created_at) <= ?
       AND ${orderFilters.sql ? `o.id IS NOT NULL${orderFilters.sql}` : "1 = 1"}
     GROUP BY wr.request_type, hour ORDER BY hour, call_count DESC`
  )
  .all(range.start, range.end, ...(orderFilters.sql ? orderFilters.params : [])) as {
  request_type: string;
  hour: number;
  call_count: number;
  }[];
  const recentReviews = await db
  .prepare(
    `SELECT r.id, r.rating, r.customer_name, r.comment, r.photo_url, r.created_at
     FROM reviews r JOIN orders o ON o.id = r.order_id
     WHERE DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
     ORDER BY r.created_at DESC LIMIT 50`
  )
  .all(...baseArgs) as {
  id: number;
  rating: number;
  customer_name: string | null;
  comment: string | null;
  photo_url: string | null;
  created_at: string;
  }[];
  const ratingDistribution = await db
  .prepare(
    `SELECT r.rating, COUNT(*) AS review_count
     FROM reviews r JOIN orders o ON o.id = r.order_id
     WHERE DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
     GROUP BY r.rating ORDER BY r.rating`
  )
  .all(...baseArgs) as { rating: number; review_count: number }[];
  const orderTypeMix = await db
  .prepare(
    `SELECT o.order_type, COUNT(*) AS order_count, COALESCE(SUM(o.total), 0) AS revenue
     FROM orders o
     WHERE o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL
       AND o.payment_status = 'verified'
       AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
     GROUP BY o.order_type ORDER BY revenue DESC`
  )
  .all(...baseArgs) as {
  order_type: string;
  order_count: number;
  revenue: number;
  }[];
  const recentCancelled = await db
  .prepare(
    `SELECT cancellation_reason, COUNT(*) AS order_count
     FROM orders o
     WHERE o.status = 'cancelled'
       AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?${orderFilters.sql}
     GROUP BY cancellation_reason ORDER BY order_count DESC LIMIT 10`
  )
  .all(...baseArgs) as {
  cancellation_reason: string | null;
  order_count: number;
  }[];
  const paymentBalances = await db
  .prepare(
    `SELECT p.payment_method, p.status, COUNT(*) AS payment_count,
            COALESCE(SUM(p.amount), 0) AS amount,
            COALESCE(AVG(CASE WHEN p.verified_at IS NOT NULL
              THEN (julianday(p.verified_at) - julianday(p.created_at)) * 1440 END), 0) AS average_verification_minutes
     FROM order_balance_payments p
     JOIN orders o ON o.id = p.order_id
     WHERE DATE(p.created_at) >= ? AND DATE(p.created_at) <= ?${orderFilters.sql}
     GROUP BY p.payment_method, p.status ORDER BY p.payment_method, p.status`
  )
  .all(...baseArgs) as {
  payment_method: string;
  status: string;
  payment_count: number;
  amount: number;
  average_verification_minutes: number;
  }[];
  const productTotalRevenue = menuPerformance.reduce(
  (sum, item) => sum + Number(item.revenue),
  0
  );
  const soldMenuItems = menuPerformance.filter(
  (item) => Number(item.quantity_sold) > 0
  );
  const averageItemQuantity = soldMenuItems.length
  ? soldMenuItems.reduce((sum, item) => sum + Number(item.quantity_sold), 0) /
    soldMenuItems.length
  : 0;
  const averageItemRevenue = soldMenuItems.length
  ? soldMenuItems.reduce((sum, item) => sum + Number(item.revenue), 0) /
    soldMenuItems.length
  : 0;
  const rankedMenu = menuPerformance.map((item) => {
  const hasSales = Number(item.quantity_sold) > 0;
  const popular = averageItemQuantity > 0 &&
    Number(item.quantity_sold) >= averageItemQuantity;
  const aboveAverageRevenue = averageItemRevenue > 0 &&
    Number(item.revenue) >= averageItemRevenue;
  return {
    ...item,
    quantity_sold: Number(item.quantity_sold),
    revenue: Number(item.revenue),
    extras_quantity: Number(item.extras_quantity),
    sales_share_pct: productTotalRevenue > 0
      ? Number(((Number(item.revenue) / productTotalRevenue) * 100).toFixed(1))
      : 0,
    extras_attach_rate_pct: Number(item.quantity_sold) > 0
      ? Number(((Number(item.extras_quantity) / Number(item.quantity_sold)) * 100).toFixed(1))
      : 0,
    classification: !hasSales
      ? "No sales"
      : popular
        ? aboveAverageRevenue ? "Star" : "Plowhorse"
        : aboveAverageRevenue ? "Puzzle" : "Dog",
  };
  });
  const selectedOrderCount = Number(summary.order_count);
  const reviewRatePct = selectedOrderCount > 0
  ? Number(((Number(averageRating.review_count) / selectedOrderCount) * 100).toFixed(1))
  : 0;

  const revenueChange =
    Number(previous.revenue) > 0
      ? Math.round(
          ((Number(summary.revenue) - Number(previous.revenue)) /
            Number(previous.revenue)) *
            100
        )
      : null;
  const orderChange =
    Number(previous.order_count) > 0
      ? Math.round(
          ((Number(summary.order_count) - Number(previous.order_count)) /
            Number(previous.order_count)) *
            100
        )
      : null;

  return {
    period,
    range,
    generated_at: new Date().toISOString(),
    summary: {
      order_count: Number(summary.order_count),
      revenue: Number(summary.revenue),
      average_order_value: Number(summary.average_order_value),
      revenue_change_pct: revenueChange,
      order_change_pct: orderChange,
      cancelled_orders: orders.filter((order) => order.status === "cancelled")
        .length,
      average_wait_minutes: Number(waitStats.average_wait_minutes),
      pending_payment_verifications: Number(paymentVerificationCounts.pending || 0),
      average_rating: Number(averageRating.average_rating),
      review_count: Number(averageRating.review_count),
      items_out_of_stock: Number(itemsOutOfStock.count),
    },
    comparison: {
      start: range.previous_start,
      end: range.previous_end,
      order_count: Number(previous.order_count),
      revenue: Number(previous.revenue),
    },
    daily_sales: dailySales.map((row) => ({
      ...row,
      order_count: Number(row.order_count),
      revenue: Number(row.revenue),
    })),
    products: products.map((row) => ({
      ...row,
      quantity_sold: Number(row.quantity_sold),
      revenue: Number(row.revenue),
    })),
    peak_hours: peakHours.map((row) => ({
      ...row,
      hour: Number(row.hour),
      order_count: Number(row.order_count),
      revenue: Number(row.revenue),
    })),
    payment_methods: paymentMethods.map((row) => ({
      ...row,
      order_count: Number(row.order_count),
      revenue: Number(row.revenue),
    })),
    orders,
    order_items: orderItems,
    analytics: {
      hourly_sales: hourlySales.map((row) => ({
        ...row,
        order_count: Number(row.order_count),
        revenue: Number(row.revenue),
      })),
      heatmap: heatmap.map((row) => ({
        ...row,
        weekday: Number(row.weekday),
        hour: Number(row.hour),
        order_count: Number(row.order_count),
        revenue: Number(row.revenue),
      })),
      timing: {
        confirmation_minutes: Number(timingStats.confirmation_minutes),
        confirmation_samples: Number(timingStats.confirmation_samples),
        confirmed_to_preparing_minutes: Number(timingStats.confirmed_to_preparing_minutes),
        confirmed_to_preparing_samples: Number(timingStats.confirmed_to_preparing_samples),
        preparing_to_ready_minutes: Number(timingStats.preparing_to_ready_minutes),
        preparing_to_ready_samples: Number(timingStats.preparing_to_ready_samples),
        confirmed_to_ready_minutes: Number(waitStats.average_wait_minutes),
        confirmed_to_ready_samples: Number(waitStats.sample_count),
        preparing_stage_available: true,
      },
      payment_verification: {
        ...paymentVerificationCounts,
        balance_payments: paymentBalances.map((row) => ({
          ...row,
          payment_count: Number(row.payment_count),
          amount: Number(row.amount),
          average_verification_minutes: Number(row.average_verification_minutes),
        })),
      },
      pending_orders: pendingOrders,
      pending_gcash: pendingGcash,
      menu_performance: rankedMenu,
      menu_bottom: rankedMenu
        .slice(-10)
        .reverse(),
      heatmap_weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      current_stock: currentStock,
      stock_events: stockEvents.map((row) => ({
        ...row,
        out_events: Number(row.out_events),
      })),
      waiter_calls: waiterCalls,
      waiter_reason_counts: waiterReasonCounts.map((row) => ({
        ...row,
        hour: Number(row.hour),
        call_count: Number(row.call_count),
      })),
      rating_distribution: Array.from({ length: 5 }, (_, index) => {
        const rating = index + 1;
        const row = ratingDistribution.find((entry) => Number(entry.rating) === rating);
        return { rating, review_count: Number(row?.review_count || 0) };
      }),
      recent_reviews: recentReviews,
      review_rate_pct: reviewRatePct,
      order_type_mix: orderTypeMix.map((row) => ({
        ...row,
        order_count: Number(row.order_count),
        revenue: Number(row.revenue),
        average_order_value: Number(row.order_count) > 0
          ? Number(row.revenue) / Number(row.order_count)
          : 0,
      })),
      cancellation_reasons: recentCancelled,
      forecast_status: "Forecast available on the admin overview; this report does not yet expose a date-range forecast comparison.",
    },
    filters: {
      order_type: filters.orderType || "all",
      payment_method: filters.paymentMethod || "all",
    },
    insights: {
      revenue_trend:
        selectedOrderCount === 0
          ? "No confirmed sales were recorded in this period. Start tracking once orders come in."
          : revenueChange === null
            ? "Not enough previous-period sales to compare yet."
            : revenueChange > 0
              ? `Revenue increased ${revenueChange}% versus the previous period.`
              : revenueChange < 0
                ? `Revenue decreased ${Math.abs(revenueChange)}% versus the previous period.`
                : "Revenue was unchanged versus the previous period.",
      leading_product:
        selectedOrderCount === 0
          ? "No confirmed sales were recorded in this period."
          : products[0]
            ? `${products[0].name} led with ${products[0].quantity_sold} sold, generating ${peso(Number(products[0].revenue))}.`
            : "No confirmed sales were recorded in this period.",
      busiest_hour:
        selectedOrderCount === 0
          ? "No order data yet to identify a peak hour."
          : peakHours[0]
            ? `The busiest hour was ${String(peakHours[0].hour).padStart(2, "0")}:00 with ${peakHours[0].order_count} orders.`
            : "There is not enough order data to identify a peak hour.",
    },
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const params = new URL(request.url).searchParams;
    const start = params.get("from") || undefined;
    const end = params.get("to") || undefined;
    const periodParam = params.get("period") || (start || end ? "custom" : "month");
    const orderType = params.get("order_type") || "all";
    const paymentMethod = params.get("payment_method") || "all";
    if (!VALID_PERIODS.has(periodParam as ReportPeriod)) {
      return Response.json(
        { error: "Choose a supported analytics date preset.", success: false },
        { status: 400 }
      );
    }
    if (
      !["all", "dine_in", "take_out"].includes(orderType) ||
      !["all", "gcash", "counter", "cash"].includes(paymentMethod)
    ) {
      return Response.json(
        { error: "Choose valid order type and payment method filters.", success: false },
        { status: 400 }
      );
    }
    if (periodParam === "custom") {
      if (!start || !end || !isValidDate(start) || !isValidDate(end) || start > end) {
        return Response.json(
          { error: "Enter a valid start and end date.", success: false },
          { status: 400 }
        );
      }
      const days =
        Math.round(
          (new Date(`${end}T00:00:00.000Z`).getTime() -
            new Date(`${start}T00:00:00.000Z`).getTime()) /
            86_400_000
        ) + 1;
      if (days > 365) {
        return Response.json(
          { error: "Choose a date range of 365 days or less.", success: false },
          { status: 400 }
        );
      }
    }

    const report = await reportFor({
        period: periodParam as ReportPeriod,
        start,
        end,
        orderType: orderType as ReportFilters["orderType"],
        paymentMethod: paymentMethod as ReportFilters["paymentMethod"],
      }, params.get("include_proofs") !== "0");

    return Response.json({
      ...report,
      generated_by: auth.user?.name || "Administrator",
      success: true,
    });
  } catch (error: unknown) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not build the report.",
        success: false,
      },
      { status: 500 }
    );
  }
}
