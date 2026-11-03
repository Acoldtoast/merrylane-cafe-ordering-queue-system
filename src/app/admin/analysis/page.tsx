import { buildAdminOverview } from "@/lib/adminOverview";
import { AdminDashboardClient } from "../AdminDashboardClient";

export const metadata = { title: "Business Analysis" };
export const dynamic = "force-dynamic";

export default async function AdminAnalysisPage() {
  const initialData = await buildAdminOverview();
  return <AdminDashboardClient mode="analysis" initialData={initialData} />;
}
