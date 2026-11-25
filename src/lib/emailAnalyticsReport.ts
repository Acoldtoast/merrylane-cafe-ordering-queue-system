import { getDb } from "@/lib/db";
import { ensureOrderColumns } from "@/lib/models";

const SALES_STATUSES = "'ready','completed'";

interface EmailAnalyticsProduct {
  name: string;
  quantity_sold: number;
  revenue: number;
}

export interface EmailAnalyticsReport {
  summary: {
    revenue: number;
    vat_amount: number;
    net_sales: number;
    order_count: number;
    average_order_value: number;
    average_rating: number;
    review_count: number;
    items_out_of_stock: number;
    cancelled_orders: number;
  };
  products: EmailAnalyticsProduct[];
  insights: {
    revenue_trend: string;
    leading_product: string;
    busiest_hour: string;
  };
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function buildAnalyticsReportForEmail(
  start: string,
  end: string
): Promise<EmailAnalyticsReport> {
  if (!isValidDate(start) || !isValidDate(end) || start > end) {
    throw new Error("The requested email report date range is invalid.");
  }

  await ensureOrderColumns();
  const db = getDb();
  const dayCount =
    (Date.parse(`${end}T00:00:00.000Z`) -
      Date.parse(`${start}T00:00:00.000Z`)) /
      86_400_000 +
    1;
  const previousStart = shiftDate(start, -dayCount);
  const previousEnd = shiftDate(start, -1);
  const summary = (await db
    .prepare(
      `SELECT COUNT(*) AS order_count,
              COALESCE(SUM(total), 0) AS revenue,
              COALESCE(SUM(vat_amount), 0) AS vat_amount,
              COALESCE(AVG(total), 0) AS average_order_value
       FROM orders
       WHERE status IN (${SALES_STATUSES}) AND ready_at IS NOT NULL
         AND payment_status = 'verified'
         AND DATE(created_at) >= ? AND DATE(created_at) <= ?`
    )
    .get(start, end)) as {
    order_count: number;
    revenue: number;
    vat_amount: number;
    average_order_value: number;
  };
  const previous = (await db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) AS revenue
       FROM orders
       WHERE status IN (${SALES_STATUSES}) AND ready_at IS NOT NULL
         AND payment_status = 'verified'
         AND DATE(created_at) >= ? AND DATE(created_at) <= ?`
    )
    .get(previousStart, previousEnd)) as { revenue: number };
  const products = (await db
    .prepare(
      `SELECT oi.name,
              SUM(oi.quantity) AS quantity_sold,
              COALESCE(SUM(oi.price_at_time * oi.quantity), 0) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status IN (${SALES_STATUSES}) AND o.ready_at IS NOT NULL
         AND o.payment_status = 'verified'
         AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?
       GROUP BY oi.menu_item_id, oi.name
       ORDER BY quantity_sold DESC, revenue DESC`
    )
    .all(start, end)) as unknown as EmailAnalyticsProduct[];
  const peakHour = await db
    .prepare(
      `SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour,
              COUNT(*) AS order_count
       FROM orders
       WHERE status IN (${SALES_STATUSES}) AND ready_at IS NOT NULL
         AND payment_status = 'verified'
         AND DATE(created_at) >= ? AND DATE(created_at) <= ?
       GROUP BY hour
       ORDER BY order_count DESC, hour
       LIMIT 1`
    )
    .get(start, end) as { hour: number; order_count: number } | undefined;
  const ratings = await db
    .prepare(
      `SELECT COALESCE(AVG(r.rating), 0) AS average_rating,
              COUNT(*) AS review_count
       FROM reviews r
       JOIN orders o ON o.id = r.order_id
       WHERE DATE(o.created_at) >= ? AND DATE(o.created_at) <= ?`
    )
    .get(start, end) as { average_rating: number; review_count: number };
  const stock = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM menu_items
       WHERE is_active = 1 AND stock_tracking_enabled = 1 AND stock_status = 'out'`
    )
    .get() as { count: number };
  const cancellations = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM orders
       WHERE status = 'cancelled'
         AND DATE(created_at) >= ? AND DATE(created_at) <= ?`
    )
    .get(start, end) as { count: number };

  const revenueChange =
    Number(previous.revenue) > 0
      ? Math.round(
          ((Number(summary.revenue) - Number(previous.revenue)) /
            Number(previous.revenue)) *
            100
        )
      : null;

  return {
    summary: {
      revenue: Number(summary.revenue),
      vat_amount: Number(summary.vat_amount || 0),
      net_sales:
        Math.round(
          (Number(summary.revenue) - Number(summary.vat_amount || 0)) * 100
        ) / 100,
      order_count: Number(summary.order_count),
      average_order_value: Number(summary.average_order_value),
      average_rating: Number(ratings.average_rating),
      review_count: Number(ratings.review_count),
      items_out_of_stock: Number(stock.count),
      cancelled_orders: Number(cancellations.count),
    },
    products: products.map((product) => ({
      ...product,
      quantity_sold: Number(product.quantity_sold),
      revenue: Number(product.revenue),
    })),
    insights: {
      revenue_trend:
        revenueChange === null
          ? "Not enough previous-period sales to compare."
          : revenueChange > 0
            ? `Revenue increased ${revenueChange}% versus the previous period.`
            : revenueChange < 0
              ? `Revenue decreased ${Math.abs(revenueChange)}% versus the previous period.`
              : "Revenue was unchanged versus the previous period.",
      leading_product: products[0]
        ? `${products[0].name} led with ${Number(products[0].quantity_sold)} sold.`
        : "No served sales were recorded in this period.",
      busiest_hour: peakHour
        ? `The busiest hour was ${String(peakHour.hour).padStart(2, "0")}:00 with ${peakHour.order_count} orders.`
        : "There is not enough order data to identify a peak hour.",
    },
  };
}
