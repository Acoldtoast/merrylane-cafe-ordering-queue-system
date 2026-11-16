import {
  ActivityModel,
  ForecastModel,
  MenuItemModel,
  OrderModel,
  ReviewModel,
  SalesModel,
  WaiterRequestModel,
  type ActivityLog,
} from "./models";
import type { Order, Review } from "./types";

export interface AdminBestSellingItem {
  menu_item_id: number | null;
  name: string;
  total_quantity: number;
  total_revenue: number;
  is_best_seller: number | null;
  is_active: number | null;
  stock_status: "available" | "low" | "out" | null;
  stock_count: number | null;
}

export interface AdminForecastPoint {
  date: string;
  label: string;
  actual: number | null;
  forecast: number;
}

export interface AdminOverviewData {
  overview: {
    total_revenue: number;
    total_orders: number;
    all_time_revenue: number;
    all_time_orders: number;
    avg_prep_time: number;
    avg_rating: number;
  };
  stats: {
    orders: number;
    revenue: number;
    preparing: number;
    ready: number;
    awaiting: number;
    revenue_delta: number;
    pending_payments: number;
    waiter_requests: number;
    avg_rating: number;
  };
  reviews: {
    avg_rating: number;
    total_reviews: number;
    positive_pct: number;
    recent: Review[];
  };
  requests: {
    pending: number;
    acknowledged: number;
    resolved_today: number;
  };
  best_selling: { name: string; total_quantity: number; total_revenue: number }[];
  weekly_best_selling: AdminBestSellingItem[];
  monthly_best_selling: AdminBestSellingItem[];
  best_seller_periods: { week_start: string; month_start: string };
  inventory_review: {
    id: number;
    name: string;
    category_name: string;
    stock_count: number;
    stock_tracking_enabled: boolean | number;
    stock_status: "available" | "low" | "out";
    stock_note: string | null;
  }[];
  peak_hours: { hour: number; order_count: number; revenue: number }[];
  daily_sales: { date: string; total_orders: number; revenue: number }[];
  reporting_date: string;
  forecast: {
    points: AdminForecastPoint[];
    average_daily: number;
    projected_week: number;
    confidence: string;
  };
  recent_orders: Order[];
  recent_activity: ActivityLog[];
}

function manilaDate() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

async function computeAdminOverview(): Promise<AdminOverviewData> {
  const overview = await SalesModel.overview();
  const todayDate = manilaDate();
  const today = await OrderModel.todayStats(todayDate);
  const daily = await SalesModel.dailySales(13, todayDate);
  const bestSelling = await SalesModel.bestSellingItems(8);
  const reviews = await ReviewModel.stats();
  const inventoryReview = (await MenuItemModel.all())
    .filter((item) => item.is_active)
    .map((item) => ({
      id: item.id,
      name: item.name,
      category_name: item.category_name || "Menu",
      stock_count: item.stock_count,
      stock_tracking_enabled: item.stock_tracking_enabled,
      stock_status: item.stock_status,
      stock_note: item.stock_note,
    }));
  const todayUtc = new Date(`${todayDate}T00:00:00.000Z`);
  const mondayOffset = (todayUtc.getUTCDay() + 6) % 7;
  const weekStart = shiftDate(todayDate, -mondayOffset);
  const monthStart = `${todayDate.slice(0, 7)}-01`;
  const nextMonthStart = new Date(`${monthStart}T00:00:00.000Z`);
  nextMonthStart.setUTCMonth(nextMonthStart.getUTCMonth() + 1);
  const weeklyBestSelling = await SalesModel.bestSellingItemsBetween(
    weekStart,
    shiftDate(weekStart, 7)
  );
  const monthlyBestSelling = await SalesModel.bestSellingItemsBetween(
    monthStart,
    nextMonthStart.toISOString().slice(0, 10)
  );
  const peakHours = await SalesModel.peakHours();
  const forecast = await ForecastModel.nextSevenDays();
  const requests = await WaiterRequestModel.stats();
  const pendingPayments = await OrderModel.pendingPaymentCount();

  const yesterdayDate = shiftDate(todayDate, -1);
  const todayRevenue =
    daily.find((item) => item.date === todayDate)?.revenue || 0;
  const yesterdayRevenue =
    daily.find((item) => item.date === yesterdayDate)?.revenue || 0;
  const revenueDelta =
    yesterdayRevenue > 0
      ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
      : 0;

  return {
    overview: {
      ...overview,
      total_revenue: today.revenue,
      total_orders: today.orders,
      all_time_revenue: overview.total_revenue,
      all_time_orders: overview.total_orders,
      avg_rating: reviews.avg_rating,
    },
    stats: {
      ...today,
      revenue_delta: revenueDelta,
      pending_payments: pendingPayments,
      waiter_requests: requests.pending,
      avg_rating: reviews.avg_rating,
    },
    reviews: {
      ...reviews,
      // The overview never renders customer photos; stripping the data URLs
      // keeps the server-rendered payload small and the dashboard fast.
      recent: (await ReviewModel.all(6)).map((review) => ({
        ...review,
        photo_url: null,
      })),
    },
    requests,
    best_selling: bestSelling,
    weekly_best_selling: weeklyBestSelling,
    monthly_best_selling: monthlyBestSelling,
    inventory_review: inventoryReview,
    best_seller_periods: {
      week_start: weekStart,
      month_start: monthStart,
    },
    peak_hours: peakHours,
    daily_sales: daily,
    reporting_date: todayDate,
    forecast,
    // Payment proofs are base64 data URLs that can be megabytes each. The
    // overview only shows an item count, so blank them out before the data
    // crosses from the server render to the client.
    recent_orders: (await OrderModel.list(undefined, 8)).map((order) => ({
      ...order,
      payment_proof_url: null,
    })),
    recent_activity: await ActivityModel.recent(6),
  };
}

// The dashboard is polled by every open admin tab. A very short cache keeps
// simultaneous loads (login + polling, two tabs, React dev double-mounts)
// from recomputing the same numbers while keeping the view effectively live.
const CACHE_MS = 4000;
let cached: { data: AdminOverviewData; expires: number } | null = null;
let inFlight: Promise<AdminOverviewData> | null = null;

export async function buildAdminOverview(
  options: { fresh?: boolean } = {}
): Promise<AdminOverviewData> {
  if (!options.fresh && cached && cached.expires > Date.now()) {
    return cached.data;
  }
  if (inFlight) return inFlight;

  inFlight = Promise.resolve().then(async () => {
    // PGlite rows may use null prototypes; round-trip through JSON so the same
    // payload can be cached and passed from a Server Component to the client.
    const data = JSON.parse(
      JSON.stringify(await computeAdminOverview())
    ) as AdminOverviewData;
    cached = { data, expires: Date.now() + CACHE_MS };
    return data;
  });

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
