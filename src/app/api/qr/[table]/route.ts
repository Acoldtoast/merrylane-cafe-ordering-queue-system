import QRCode from "qrcode";
import { getLocalNetworkAddress, hasLocalAddress } from "@/lib/localAddress";
import { networkInterfaces } from "node:os";
import { isIpLiteral, qrBaseOrigin, usableBaseUrl } from "@/lib/qrOrigin";

// The base address depends on the current network, so never cache the image.
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params;
  const tableNumber = Math.max(1, Number(table) || 1);
  const url = new URL(request.url);
  const requestedOrigin = url.searchParams.get("origin");
  const configuredBase = process.env.QR_BASE_URL ?? null;
  const requested = usableBaseUrl(requestedOrigin);
  const requestedOriginIsCurrent = requested ? hasLocalAddress(requested.hostname) : false;

  /*
   * Detection is only needed when the QR would otherwise use a loopback or an
   * address this machine no longer owns; a configured base or a live address
   * (including a domain) is already the answer.
   */
  const needsDetection =
    !usableBaseUrl(configuredBase) &&
    (!requested || (isIpLiteral(requested.hostname) && !requestedOriginIsCurrent));
  let detectedAddress = needsDetection ? await getLocalNetworkAddress() : null;
  // Last-resort fallback: if no real (non-virtual) adapter was found, use any
  // private IPv4 the OS reports rather than encoding `localhost`, which a phone
  // on another device can never reach (ERR_CONNECTION_REFUSED).
  if (needsDetection && !detectedAddress) {
    const anyPrivate = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .map((entry) => entry.address)
      .find((address) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address));
    detectedAddress = anyPrivate ?? null;
  }

  const origin = qrBaseOrigin({
    requestUrl: url,
    requestedOrigin,
    configuredBase,
    detectedAddress,
    requestedOriginIsCurrent,
  });
  const target = `${origin}/customer/welcome?table=${tableNumber}`;

  const svg = await QRCode.toString(target, {
    type: "svg",
    margin: 1,
    width: 320,
    color: { dark: "#39271d", light: "#fffcf7" },
    errorCorrectionLevel: "M",
  });

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
      // Lets support (and the admin page) see the address a QR really encodes.
      "X-QR-Target": target,
    },
  });
}
