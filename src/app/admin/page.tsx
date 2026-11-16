import { AdminDashboardClient } from "./AdminDashboardClient";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <AdminDashboardClient />;
}
