import { OrderModel, ReviewModel } from "@/lib/models";
import { getGuestId } from "@/lib/guest";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orderId = Number(id);
  const owner = OrderModel.guestOwner(orderId);
  const guestId = await getGuestId();
  if (owner && owner !== guestId) {
    return Response.json(
      { error: "Order not found.", success: false },
      { status: 404 }
    );
  }
  const order = OrderModel.byId(orderId);
  if (!order) {
    return Response.json(
      { error: "Order not found.", success: false },
      { status: 404 }
    );
  }
  return Response.json({
    order,
    review: ReviewModel.byOrder(order.id) || null,
    success: true,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return Response.json(
      { error: "Order not found.", success: false },
      { status: 404 }
    );
  }

  const guestId = await getGuestId();
  if (!guestId || OrderModel.guestOwner(orderId) !== guestId) {
    return Response.json(
      { error: "Order not found.", success: false },
      { status: 404 }
    );
  }

  if (!OrderModel.cancelUnpaidForGuest(orderId, guestId)) {
    const order = OrderModel.byId(orderId);
    if (!order) {
      return Response.json(
        { error: "Order not found.", success: false },
        { status: 404 }
      );
    }
    return Response.json(
      {
        error: "This order can no longer be cancelled because payment was confirmed or preparation has started.",
        success: false,
      },
      { status: 409 }
    );
  }

  return Response.json({
    order: OrderModel.byId(orderId),
    success: true,
    message: "Order cancelled.",
  });
}
