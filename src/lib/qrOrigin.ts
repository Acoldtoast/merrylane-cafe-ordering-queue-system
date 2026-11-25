const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.replace(/^\[|\]$/g, "").toLowerCase());
}

/**
 * A base URL the phone can actually reach. Loopback addresses are rejected:
 * a QR printed with `localhost` sends the phone to itself, not this server.
 */
export function usableBaseUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (isLoopbackHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

/**
 * Origin encoded into a table QR code.
 *
 * Priority: an explicitly configured stable base (`QR_BASE_URL`), then the
 * address the admin page was opened with, then the server's current LAN
 * address. The last one makes QRs work when the admin is opened on
 * `localhost`, and it re-detects on every request so it follows Wi-Fi changes.
 */
export function qrBaseOrigin(input: {
  requestUrl: URL;
  requestedOrigin?: string | null;
  configuredBase?: string | null;
  detectedAddress?: string | null;
  /**
   * False when the admin page's origin is an address this machine no longer
   * owns, which is what an admin tab left open across a Wi-Fi change sends.
   */
  requestedOriginIsCurrent?: boolean;
}): string {
  const configured = usableBaseUrl(input.configuredBase);
  if (configured) return configured.origin;

  const requested = usableBaseUrl(input.requestedOrigin);
  /*
   * A bare IP is only a good answer while this machine still owns it. After a
   * Wi-Fi change an open admin tab keeps sending the old address, and a QR
   * pointing at it opens a dead page on the phone. A hostname (domain or
   * tunnel) stays valid, so it is kept as given.
   */
  const staleIp =
    requested !== null &&
    isIpLiteral(requested.hostname) &&
    input.requestedOriginIsCurrent === false;
  if (requested && !staleIp) return requested.origin;

  if (input.detectedAddress) {
    const scheme = input.requestUrl.protocol === "https:" ? "https" : "http";
    const port = input.requestUrl.port;
    return `${scheme}://${input.detectedAddress}${port ? `:${port}` : ""}`;
  }

  return requested?.origin ?? input.requestUrl.origin;
}
