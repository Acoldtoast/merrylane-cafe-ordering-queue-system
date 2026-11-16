import { NextResponse } from "next/server";
import { SettingsModel } from "@/lib/models";

export async function GET() {
  const [
    facebookUrl,
    twitterUrl,
    tiktokUrl,
    instagramUrl,
    socialMediaEnabled,
  ] = await Promise.all([
    SettingsModel.get("facebook_url"),
    SettingsModel.get("twitter_url"),
    SettingsModel.get("tiktok_url"),
    SettingsModel.get("instagram_url"),
    SettingsModel.get("social_media_enabled"),
  ]);

  return NextResponse.json({
    facebook_url: facebookUrl || "",
    twitter_url: twitterUrl || "",
    tiktok_url: tiktokUrl || "",
    instagram_url: instagramUrl || "",
    social_media_enabled: socialMediaEnabled !== "false",
  });
}
