import { AdminDashboardClient } from "../AdminDashboardClient";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default function AdminAnalyticsPage() {
  return <AdminDashboardClient mode="analysis" />;
}
