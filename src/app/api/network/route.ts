import { SettingsModel } from "@/lib/models";
import {
  WIFI_SKIP_COOKIE,
  clientIp,
  hasWifiSkipCookie,
  isCafeNetwork,
} from "@/lib/network";

export const dynamic = "force-dynamic";

async function currentSsid() {
  try {
    return (await SettingsModel.get("wifi_ssid")) || "MERLYLANE-WIFI";
  } catch {
    return "MERLYLANE-WIFI";
  }
}

export async function GET(request: Request) {
  return Response.json(
    {
      connected: isCafeNetwork(request.headers),
      skipped: hasWifiSkipCookie(request.headers),
      ssid: await currentSsid(),
      ip: clientIp(request.headers),
      success: true,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.action !== "skip") {
      return Response.json(
        { error: "Unknown network action.", success: false },
        { status: 400 }
      );
    }

    const response = Response.json({ skipped: true, success: true });
    // Session cookie: "Skip for now" opens the menu until the browser closes.
    response.headers.append(
      "Set-Cookie",
      `${WIFI_SKIP_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax`
    );
    return response;
  } catch {
    return Response.json(
      { error: "Could not skip the network check.", success: false },
      { status: 500 }
    );
  }
}
