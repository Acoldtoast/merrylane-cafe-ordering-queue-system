import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

const GUEST_COOKIE = "merrylane.guest-id";
const GUEST_ID_PATTERN = /^[a-f0-9]{64}$/;
const TWO_YEARS_IN_SECONDS = 60 * 60 * 24 * 365 * 2;

export async function getGuestId(): Promise<string | null> {
  const cookieStore = await cookies();
  const guestId = cookieStore.get(GUEST_COOKIE)?.value;
  return guestId && GUEST_ID_PATTERN.test(guestId) ? guestId : null;
}

export async function getOrCreateGuestId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(GUEST_COOKIE)?.value;
  if (existing && GUEST_ID_PATTERN.test(existing)) return existing;

  const guestId = randomBytes(32).toString("hex");
  cookieStore.set(GUEST_COOKIE, guestId, {
    httpOnly: true,
    maxAge: TWO_YEARS_IN_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return guestId;
}
