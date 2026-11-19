import { OrderModel } from "@/lib/models";
import { getGuestId } from "@/lib/guest";

function stamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return Response.json(
        { error: "A valid order is required.", success: false },
        { status: 400 }
      );
    }

    const guestId = await getGuestId();
    if (!guestId || (await OrderModel.guestOwner(orderId)) !== guestId) {
      return Response.json({ error: "Order not found.", success: false }, { status: 404 });
    }
    const body = await request.json();
    const tableNumber = Number(body.table_number);
    const order = await OrderModel.byId(orderId);
    if (!order || order.table_number !== tableNumber) {
      return Response.json(
        { error: "Order not found for this table.", success: false },
        { status: 404 }
      );
    }
    if (order.status === "completed") {
      return Response.json({ order, success: true });
    }
    if (order.status !== "ready") {
      return Response.json(
        { error: "You can confirm receipt after your order has been served.", success: false },
        { status: 409 }
      );
    }

    await OrderModel.update(orderId, {
      status: "completed",
      completed_at: stamp(),
    });
    return Response.json({
      order: await OrderModel.byId(orderId),
      success: true,
    });
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not confirm order receipt.",
        success: false,
      },
      { status: 500 }
    );
  }
}
