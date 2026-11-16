import QRCode from "qrcode";
import { SettingsModel } from "@/lib/models";

export async function GET() {
  const [storedNumber, storedName] = await Promise.all([
    SettingsModel.get("gcash_number"),
    SettingsModel.get("gcash_name"),
  ]);
  const number = storedNumber || "0917 123 4567";
  const name = storedName || "Merrylane Cafe";
  // Demo merchant payload. A live deployment can swap this for the cafe's
  // official GCash QR payload without changing the customer flow.
  const payload = `GCASH|${number.replace(/\s/g, "")}|${name.toUpperCase()}|MERRYLANE`;

  const svg = await QRCode.toString(payload, {
    type: "svg",
    margin: 1,
    width: 360,
    color: { dark: "#163b6b", light: "#ffffff" },
    errorCorrectionLevel: "M",
  });

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
    },
  });
}
