import { getGuestId } from "@/lib/guest";
import { OrderModel } from "@/lib/models";

export async function GET() {
  try {
    const guestId = await getGuestId();
    return Response.json({
      orders: guestId ? OrderModel.byGuest(guestId) : [],
      success: true,
    });
  } catch (error: unknown) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not load order history.",
        success: false,
      },
      { status: 500 }
    );
  }
}
