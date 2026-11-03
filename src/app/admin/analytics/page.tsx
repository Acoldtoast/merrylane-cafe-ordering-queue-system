import { buildAdminOverview } from "@/lib/adminOverview";
import { AdminDashboardClient } from "../AdminDashboardClient";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  const initialData = await buildAdminOverview();
  return <AdminDashboardClient mode="analysis" initialData={initialData} />;
}
