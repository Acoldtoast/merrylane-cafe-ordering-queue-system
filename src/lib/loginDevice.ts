import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

export const LOGIN_DEVICE_COOKIE = "merrylane-login-device";

const DEVICE_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface LoginDeviceContext {
  id: string;
  shouldSetCookie: boolean;
}

export function getLoginDeviceContext(
  request: NextRequest
): LoginDeviceContext {
  const cookie = request.cookies.get(LOGIN_DEVICE_COOKIE)?.value;
  if (cookie && UUID_PATTERN.test(cookie)) {
    return { id: cookie, shouldSetCookie: false };
  }
  return { id: randomUUID(), shouldSetCookie: true };
}

export function setLoginDeviceCookie(
  response: NextResponse,
  device: LoginDeviceContext
): NextResponse {
  if (device.shouldSetCookie) {
    response.cookies.set(LOGIN_DEVICE_COOKIE, device.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
    });
  }
  return response;
}
