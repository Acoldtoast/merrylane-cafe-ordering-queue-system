import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SettingsModel } from "@/lib/models";
import { isCafeNetwork } from "@/lib/network";
import { NetworkHelpClient } from "./NetworkHelpClient";

export const metadata = { title: "Connect to cafe Wi-Fi" };
export const dynamic = "force-dynamic";

function safeNext(next?: string, table?: string) {
  if (next && next.startsWith("/customer") && !next.startsWith("//")) {
    return next;
  }
  return `/customer/welcome?table=${Math.max(1, Number(table) || 7)}`;
}

export default async function NetworkRequiredPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; table?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeNext(params.next, params.table);
  const requestHeaders = await headers();

  // A guest who is already on the cafe network never needs this screen.
  if (isCafeNetwork(requestHeaders)) {
    redirect(nextPath);
  }

  let ssid = "MERRLYLANE-WIFI";
  try {
    ssid = (await SettingsModel.get("wifi_ssid")) || ssid;
  } catch {
    // Settings may not be ready before the database is initialized.
  }

  return <NetworkHelpClient ssid={ssid} nextPath={nextPath} />;
}
