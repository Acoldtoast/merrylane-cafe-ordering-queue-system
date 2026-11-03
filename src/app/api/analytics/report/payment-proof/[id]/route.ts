import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

const DATA_IMAGE_PATTERN =
  /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const id = Number(new URL(request.url).pathname.split("/").at(-1));
    if (!Number.isSafeInteger(id) || id <= 0) {
      return Response.json({ error: "Invalid order ID.", success: false }, { status: 400 });
    }

    const row = getDb()
      .prepare(
        `SELECT payment_proof_url FROM orders
         WHERE id = ? AND payment_method = 'gcash' AND payment_status = 'pending'`
      )
      .get(id) as { payment_proof_url: string | null } | undefined;
    if (!row?.payment_proof_url) {
      return Response.json({ error: "Payment proof was not found.", success: false }, { status: 404 });
    }

    const match = DATA_IMAGE_PATTERN.exec(row.payment_proof_url);
    if (!match) {
      return Response.json({ error: "This proof is stored as an external image.", success: false }, { status: 415 });
    }
    const image = Uint8Array.from(Buffer.from(match[2], "base64"));
    return new Response(image, {
      headers: {
        "Content-Type": `image/${match[1]}`,
        "Content-Length": String(image.byteLength),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not load payment proof.",
        success: false,
      },
      { status: 500 }
    );
  }
}
