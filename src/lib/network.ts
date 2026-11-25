/**
 * Cafe network detection.
 *
 * Browsers do not expose the Wi-Fi SSID to web apps, so the server checks the
 * address the request arrived on instead. Phones connected to the cafe router
 * reach the app through the cafe's private LAN address (or a private client IP
 * forwarded by a local reverse proxy), which is a reliable "same network"
 * signal without asking guests to type anything.
 */

export const WIFI_SKIP_COOKIE = "merrylane_wifi_skip";

const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function normalizeIp(raw: string | null | undefined): string {
  if (!raw) return "";
  let ip = raw.split(",")[0].trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip.startsWith("[")) ip = ip.slice(1, ip.indexOf("]"));
  return ip;
}

export function isPrivateAddress(raw: string | null | undefined): boolean {
  const ip = normalizeIp(raw);
  if (!ip) return false;
  if (ip === "::1" || ip === "127.0.0.1" || ip === "localhost") return true;
  if (PRIVATE_IPV4.test(ip)) return true;
  // IPv6 unique-local (fd00::/8, fc00::/8) and link-local addresses.
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  if (/^fe80:/i.test(ip)) return true;
  return false;
}

export function clientIp(headers: Headers): string {
  return normalizeIp(
    headers.get("x-forwarded-for") ||
      headers.get("x-real-ip") ||
      headers.get("cf-connecting-ip")
  );
}

/**
 * Client-reported address. X-Forwarded-For / X-Real-IP / CF-Connecting-IP and
 * the Host header are trivial to forge, so this must never be used for access
 * control. It is only used for informational displays.
 */
export function reportedClientIp(headers: Headers): string {
  return clientIp(headers);
}

export function requestHostname(headers: Headers): string {
  const raw = (headers.get("x-forwarded-host") || headers.get("host") || "").trim();
  const first = raw.split(",")[0].trim();
  if (!first) return "";
  if (first.startsWith("[")) {
    const end = first.indexOf("]");
    return (end > 0 ? first.slice(1, end) : first.slice(1)).toLowerCase();
  }
  return first.split(":")[0].toLowerCase();
}

/**
 * Trusted cafe-network check. `connectionIp` is the socket remote address seen
 * by the server (e.g. `request.ip` in middleware) — the only address an
 * attacker cannot forge. Direct internet access arrives from a public address
 * and is blocked; cafe LAN access arrives via the local router's private
 * address and is allowed.
 */
export function isCafeNetworkFromIp(connectionIp: string): boolean {
  return isPrivateAddress(connectionIp);
}

/**
 * Header-based cafe network hint. Kept for UI-level hinting in Server
 * Components where the socket address is unavailable. NOT an access control:
 * X-Forwarded-For and Host are client-supplied and forgeable.
 */
export function isCafeNetwork(headers: Headers): boolean {
  if (isPrivateAddress(clientIp(headers))) return true;

  const host = requestHostname(headers);
  if (!host) return false;
  if (isPrivateAddress(host)) return true;
  if (/\.(local|lan|home|internal)$/i.test(host)) return true;
  return false;
}

export function hasWifiSkipCookie(headers: Headers): boolean {
  const cookie = headers.get("cookie") || "";
  return cookie
    .split(";")
    .some((part) => part.trim() === `${WIFI_SKIP_COOKIE}=1`);
}
