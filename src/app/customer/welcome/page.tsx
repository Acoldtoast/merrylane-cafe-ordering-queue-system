import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SettingsModel } from "@/lib/models";
import type { OrderingWindow } from "@/lib/models";
import { isCafeNetwork } from "@/lib/network";
import { INTRO_SEEN_COOKIE } from "@/lib/introSeen";
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

  // New phones see the intro page once; after that the QR opens the menu flow.
  const introSeen = (await cookies()).get(INTRO_SEEN_COOKIE)?.value;
  if (!introSeen) redirect(`/start?table=${table}`);

  let wifi = "MERLYLANE-WIFI";
  let opening = "09:00";
  let closing = "22:00";
  let lastOrder = "21:00";
  let open = true;
  let ordering: OrderingWindow | null = null;

  try {
    [wifi, opening, closing, lastOrder] = await Promise.all([
      SettingsModel.get("wifi_ssid").then((value) => value || wifi),
      SettingsModel.get("opening_time").then((value) => value || opening),
      SettingsModel.get("closing_time").then((value) => value || closing),
      SettingsModel.get("last_order_time").then((value) => value || lastOrder),
    ]);
    ordering = await SettingsModel.orderingWindow();
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
