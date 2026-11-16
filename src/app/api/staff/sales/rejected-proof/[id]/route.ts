import { OrderModel } from "@/lib/models";
import { requireStaff } from "@/lib/auth";

const DATA_IMAGE_PATTERN =
  /^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireStaff(request);
    if (auth.error) return auth.error;

    const { id } = await params;
    const rejectionId = Number(id);
    if (!Number.isSafeInteger(rejectionId) || rejectionId <= 0) {
      return Response.json(
        { error: "Invalid rejection record.", success: false },
        { status: 400 }
      );
    }

    const proof = await OrderModel.rejectedPaymentProof(rejectionId);
    if (!proof) {
      return Response.json(
        { error: "Rejected payment proof was not found.", success: false },
        { status: 404 }
      );
    }

    const match = DATA_IMAGE_PATTERN.exec(proof);
    if (!match) {
      return Response.json(
        { error: "This proof is stored as an external image.", success: false },
        { status: 415 }
      );
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
        error:
          error instanceof Error
            ? error.message
            : "Could not load rejected payment proof.",
        success: false,
      },
      { status: 500 }
    );
  }
}
