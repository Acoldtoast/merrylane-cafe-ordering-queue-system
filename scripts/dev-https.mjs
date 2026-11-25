import dgram from "node:dgram";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const VIRTUAL_IFACE =
  /vethernet|docker|wsl|hyper|virtual|vmware|virtualbox|vpn|tap|tun|wireguard|^wg|loopback|pseudo|bluetooth|npcap|teredo|isatap/i;
const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function isVirtualInterface(name) {
  return VIRTUAL_IFACE.test(name);
}

function preferredScore(name) {
  const lower = name.toLowerCase();
  if (/wi-?fi|wireless|wlan|802\.11/.test(lower)) return 0;
  if (/ethernet|eth\d|lan/.test(lower)) return 1;
  return 2;
}

function allPrivateInterfaces() {
  const result = [];
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

function preferredInterfaceAddress() {
  const ifaces = allPrivateInterfaces();
  if (ifaces.length === 0) return null;
  const sorted = [...ifaces].sort((a, b) => {
    const scoreDiff = preferredScore(a.name) - preferredScore(b.name);
    if (scoreDiff !== 0) return scoreDiff;
    return a.name.localeCompare(b.name);
  });
  const byRange = (addr) => {
    if (addr.startsWith("192.168.")) return 0;
    if (addr.startsWith("10.")) return 1;
    return 2;
  };
  const bestScore = preferredScore(sorted[0].name);
  const candidates = sorted.filter((i) => preferredScore(i.name) === bestScore);
  candidates.sort((a, b) => byRange(a.address) - byRange(b.address));
  return candidates[0]?.address ?? sorted[0].address ?? null;
}

const socket = dgram.createSocket("udp4");

socket.on("error", (error) => {
  console.error(`Could not determine the Wi-Fi address: ${error.message}`);
  socket.close();
  process.exitCode = 1;
});

socket.connect(53, "192.0.2.1", () => {
  const routed = socket.address()?.address ?? null;
  socket.close();
  let address = null;
  if (routed && PRIVATE_IPV4.test(routed) && !routed.startsWith("169.254.")) {
    const iface = allPrivateInterfaces().find((i) => i.address === routed);
    if (iface) address = routed;
  }
  if (!address) address = preferredInterfaceAddress();
  if (!address) {
    console.error("No active local IPv4 address found. Connect to the café Wi-Fi and try again.");
    process.exitCode = 1;
    return;
  }
  const local = allPrivateInterfaces().some((i) => i.address === address);
  if (!local) {
    console.error("No active local IPv4 address found. Connect to the café Wi-Fi and try again.");
    process.exitCode = 1;
    return;
  }
  console.log(`Phone address: https://${address}:3112`);
  console.log("The phone must trust the development certificate authority before its camera will work.");
  const child = spawn(process.execPath, [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    "--experimental-https",
    "--hostname",
    address,
    "-p",
    "3112",
  ], { stdio: "inherit" });
  child.on("error", (error) => {
    console.error(`Could not start HTTPS: ${error.message}`);
    process.exitCode = 1;
  });
    child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
});
