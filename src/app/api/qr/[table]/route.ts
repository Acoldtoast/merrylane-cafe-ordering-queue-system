import QRCode from "qrcode";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params;
  const tableNumber = Math.max(1, Number(table) || 1);
  const url = new URL(request.url);
  const origin = url.searchParams.get("origin") || url.origin;
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
    },
  });
}
