import { NextResponse } from "next/server";
import { SettingsModel } from "@/lib/models";
import { cached } from "@/lib/serverCache";

export async function GET() {
  const payload = await cached("settings:cafe", 30_000, async () => {
    // One query for the whole settings row set instead of five round trips
    // through PGlite's single connection.
    const values = await SettingsModel.object();
    return {
      facebook_url: values.facebook_url || "",
      twitter_url: values.twitter_url || "",
      tiktok_url: values.tiktok_url || "",
      instagram_url: values.instagram_url || "",
      social_media_enabled: values.social_media_enabled !== "false",
    };
  });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "private, max-age=15, stale-while-revalidate=30",
    },
  });
}
