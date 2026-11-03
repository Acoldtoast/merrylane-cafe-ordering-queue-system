import { headers } from "next/headers";
import { SettingsModel } from "@/lib/models";
import type { OrderingWindow } from "@/lib/models";
import { isCafeNetwork } from "@/lib/network";
import { WelcomeClient } from "./WelcomeClient";

export const metadata = { title: "Welcome to Merrylane" };
export const dynamic = "force-dynamic";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>;
}) {
  const params = await searchParams;
  const table = Math.max(1, Number(params.table) || 7);
  const requestHeaders = await headers();

  let wifi = "MERLYLANE-WIFI";
  let opening = "09:00";
  let closing = "22:00";
  let lastOrder = "21:00";
  let open = true;
  let ordering: OrderingWindow | null = null;

  try {
    wifi = SettingsModel.get("wifi_ssid") || wifi;
    opening = SettingsModel.get("opening_time") || opening;
    closing = SettingsModel.get("closing_time") || closing;
    lastOrder = SettingsModel.get("last_order_time") || lastOrder;
    ordering = SettingsModel.orderingWindow();
    open = ordering.open;
    const todaySchedule = ordering.schedule.find(
      (day) => day.day === ordering?.today
    );
    if (todaySchedule) {
      opening = todaySchedule.start;
      closing = todaySchedule.end;
      lastOrder = todaySchedule.last_order;
    }
  } catch {
    // The welcome screen still renders before the database is initialized.
  }

  return (
    <WelcomeClient
      initialTable={table}
      initialConnected={isCafeNetwork(requestHeaders)}
      wifiSsid={wifi}
      initialOpening={opening}
      initialClosing={closing}
      initialLastOrder={lastOrder}
      initialOpen={open}
      initialOrdering={ordering}
    />
  );
}
