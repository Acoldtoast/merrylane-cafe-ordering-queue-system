import { SignJWT } from "jose";
import { NextResponse } from "next/server";
import {
  getAdminIdleTimeoutMinutes,
  JWT_SECRET,
  requireAdmin,
} from "@/lib/auth";
import { UserModel } from "@/lib/models";

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error || !auth.user) {
    return auth.error || Response.json(
      { error: "Administrator access is required.", success: false },
      { status: 403 }
    );
  }

  const sessionId = (await UserModel.byId(auth.user.id))?.session_id;
  const idleTimeoutSeconds = (await getAdminIdleTimeoutMinutes()) * 60;
  const tokenBuilder = new SignJWT({
    userId: auth.user.id,
    role: "admin",
    sid: sessionId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt();
  if (idleTimeoutSeconds > 0) {
    tokenBuilder.setExpirationTime(
      Math.floor(Date.now() / 1000) + idleTimeoutSeconds
    );
  }
  const token = await tokenBuilder.sign(new TextEncoder().encode(JWT_SECRET));

  const response = NextResponse.json({ success: true });
  response.cookies.set("auth-admin-token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    ...(idleTimeoutSeconds > 0 ? { maxAge: idleTimeoutSeconds } : {}),
    path: "/",
  });
  return response;
}
