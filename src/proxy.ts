import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import {
  hasWifiSkipCookie,
  isCafeNetwork,
} from "@/lib/network";
import { getJwtSecret } from "@/lib/auth";

async function readSession(request: NextRequest, expectedRole: "admin" | "staff") {
  // Fail closed when signing is not configured.
  const key = new TextEncoder().encode(getJwtSecret());
  const tokens = [
    request.cookies.get(`auth-${expectedRole}-token`)?.value,
    request.cookies.get("auth-token")?.value,
  ];
  for (const token of tokens) {
    if (!token) continue;
    try {
      const { payload } = await jwtVerify(token, key);
      if (payload.role !== expectedRole) continue;
      return { userId: Number(payload.userId), role: expectedRole };
    } catch {
      continue;
    }
  }
  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next") || pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // Staff and administrator areas require a signed session.
  if (pathname.startsWith("/staff") || pathname.startsWith("/admin")) {
    const expectedRole = pathname.startsWith("/admin") ? "admin" : "staff";
    const session = await readSession(request, expectedRole);
    if (!session) {
      const login = new URL("/login", request.url);
      login.searchParams.set("next", pathname);
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  // Customer ordering is restricted to the cafe network. Guests can use the
  // "Skip for now" option on the connection screen, which sets a session cookie.
  if (!pathname.startsWith("/customer")) {
    return NextResponse.next();
  }

  // This is a convenience prompt, not an access-control boundary: users can
  // skip it and forwarded headers may be supplied by the client.
  if (
    hasWifiSkipCookie(request.headers) ||
    isCafeNetwork(request.headers)
  ) {
    return NextResponse.next();
  }

  const networkHelp = new URL("/network-required", request.url);
  networkHelp.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(networkHelp);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon-192.png|favicon-512.png|fonts|api).*)",
  ],
};
