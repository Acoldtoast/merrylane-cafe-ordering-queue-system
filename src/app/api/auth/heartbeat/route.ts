import { SignJWT } from "jose";
import { NextResponse } from "next/server";
import { JWT_SECRET, requireAdmin } from "@/lib/auth";

const ADMIN_IDLE_SECONDS = 5 * 60;

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error || !auth.user) {
    return auth.error || Response.json(
      { error: "Administrator access is required.", success: false },
      { status: 403 }
    );
  }

  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_IDLE_SECONDS;
  const token = await new SignJWT({
    userId: auth.user.id,
    role: "admin",
    rememberForToday: false,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(JWT_SECRET));

  const response = NextResponse.json({ success: true });
  response.cookies.set("auth-admin-token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ADMIN_IDLE_SECONDS,
    path: "/",
  });
  return response;
}
