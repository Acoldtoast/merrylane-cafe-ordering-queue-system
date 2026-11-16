import { AdminDashboardClient } from "../AdminDashboardClient";

export const metadata = { title: "Business Analysis" };
export const dynamic = "force-dynamic";

export default function AdminAnalysisPage() {
  return <AdminDashboardClient mode="analysis" />;
}
