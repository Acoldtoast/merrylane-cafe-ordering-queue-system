import dgram from "node:dgram";
import { networkInterfaces } from "node:os";

const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const CACHE_MS = 10_000;

// Interface names that belong to virtual/loopback adapters a phone on the cafe
// Wi-Fi cannot route to. Matching is case-insensitive.
const VIRTUAL_IFACE =
  /vethernet|docker|wsl|hyper|virtual|vmware|virtualbox|vpn|tap|tun|wireguard|^wg|loopback|pseudo|bluetooth|npcap|teredo|isatap/i;

function isVirtualInterface(name: string): boolean {
  return VIRTUAL_IFACE.test(name);
}

function preferredScore(name: string): number {
  const lower = name.toLowerCase();
  if (/wi-?fi|wireless|wlan|802\.11/.test(lower)) return 0;
  if (/ethernet|eth\d|lan/.test(lower)) return 1;
  return 2;
}

interface IfaceEntry {
  name: string;
  address: string;
}

function allPrivateInterfaces(): IfaceEntry[] {
  const result: IfaceEntry[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (isVirtualInterface(name)) continue;
    for (const entry of entries ?? []) {
      if (
        entry.family === "IPv4" &&
        !entry.internal &&
        PRIVATE_IPV4.test(entry.address) &&
        !entry.address.startsWith("169.254.")
      ) {
        result.push({ name, address: entry.address });
      }
    }
  }
  return result;
}

// Prefer real (non-virtual) adapters, Wi-Fi first, then Ethernet, then others.
function preferredInterfaceAddress(): string | null {
  const ifaces = allPrivateInterfaces();
  if (ifaces.length === 0) return null;
  const sorted = [...ifaces].sort((a, b) => {
    const scoreDiff = preferredScore(a.name) - preferredScore(b.name);
    if (scoreDiff !== 0) return scoreDiff;
    return a.name.localeCompare(b.name);
  });
  const byRange = (addr: string) => {
    if (addr.startsWith("192.168.")) return 0;
    if (addr.startsWith("10.")) return 1;
    return 2;
  };
  const bestScore = preferredScore(sorted[0].name);
  const candidates = sorted.filter((i) => preferredScore(i.name) === bestScore);
  candidates.sort((a, b) => byRange(a.address) - byRange(b.address));
  return candidates[0]?.address ?? sorted[0].address;
}

function detect(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = dgram.createSocket("udp4");
    const finish = (address: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      // Only trust the routed address if it belongs to a real (non-virtual)
      // adapter. Otherwise fall back to the preferred real adapter.
      if (address) {
        const iface = allPrivateInterfaces().find((i) => i.address === address);
        if (iface) {
          resolve(address);
          return;
        }
      }
      resolve(preferredInterfaceAddress());
    };
    const timer = setTimeout(() => finish(preferredInterfaceAddress()), timeoutMs);
    socket.once("error", () => finish(preferredInterfaceAddress()));
    socket.connect(53, "192.0.2.1", () => {
      const address = socket.address()?.address ?? null;
      finish(
        address &&
          PRIVATE_IPV4.test(address) &&
          !address.startsWith("169.254.")
          ? address
          : preferredInterfaceAddress()
      );
    });
  });
}

let cached: { value: string | null; expiresAt: number } | null = null;

/**
 * Whether this machine currently owns `address`. Used to tell a live admin-page
 * origin from one left over after the Wi-Fi address changed.
 */
export function hasLocalAddress(address: string): boolean {
  const target = address.replace(/^\[|\]$/g, "").toLowerCase();
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .some((entry) => entry.address.toLowerCase() === target);
}

/**
 * The local IPv4 address the OS routes outbound traffic through — normally the
 * Wi-Fi/Ethernet address a phone on the same network can reach. Uses a UDP
 * "connect" so no packet is sent, then falls back to a private interface scan
 * that skips virtual adapters. Cached briefly so a page full of QR images
 * detects only once.
 */
export async function getLocalNetworkAddress(timeoutMs = 1500): Promise<string | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await detect(timeoutMs);
  cached = { value, expiresAt: Date.now() + CACHE_MS };
  return value;
}