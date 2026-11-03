import { buildAdminOverview } from "@/lib/adminOverview";
import { AdminDashboardClient } from "./AdminDashboardClient";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const initialData = await buildAdminOverview();
  return <AdminDashboardClient initialData={initialData} />;
}
