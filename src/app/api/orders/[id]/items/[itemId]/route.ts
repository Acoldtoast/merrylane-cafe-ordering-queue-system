import { OrderModel } from "@/lib/models";
import { requireStaff } from "@/lib/auth";
import { logActivity, orderRef } from "@/lib/activityLog";

const SUGAR_LEVELS = new Set(["0%", "25%", "50%", "75%", "100%"]);

function validIds(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((id) => Number.isSafeInteger(id) && id > 0) &&
    new Set(value).size === value.length
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const auth = await requireStaff(request);
    if (auth.error) return auth.error;

    const { id, itemId } = await params;
    const orderId = Number(id);
    const orderItemId = Number(itemId);
    const body = await request.json();
    const quantity = Number(body.quantity);
    const variantIds = body.variantIds ?? [];
    const extraIds = body.extraIds ?? [];
    const sugarLevel =
      typeof body.sugarLevel === "string" ? body.sugarLevel : null;
    const note = typeof body.note === "string" ? body.note : "";

    if (
      !Number.isSafeInteger(orderId) ||
      orderId <= 0 ||
      !Number.isSafeInteger(orderItemId) ||
      orderItemId <= 0 ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      !validIds(variantIds) ||
      !validIds(extraIds) ||
      (sugarLevel !== null && !SUGAR_LEVELS.has(sugarLevel)) ||
      note.length > 180
    ) {
      return Response.json(
        { error: "Enter valid options, notes, and a positive whole quantity.", success: false },
        { status: 400 }
      );
    }

    const result = await OrderModel.updateStaffOrderItem({
      orderId,
      orderItemId,
      quantity,
      variantIds,
      extraIds,
      sugarLevel,
      note,
    });
    if (!result.ok) {
      return Response.json(
        { error: result.error, success: false },
        { status: result.status }
      );
    }

    const updatedItem = result.order.items?.find((item) => item.id === orderItemId);
    logActivity(auth.user, {
      area: "Orders",
      action: "order.item_updated",
      summary: `Updated ${updatedItem?.quantity || quantity} × ${
        updatedItem?.name || "an item"
      } on ${orderRef(result.order)}`,
      entity_type: "order",
      entity_id: orderId,
    });
    return Response.json({
      order: result.order,
      success: true,
      message: "Order item updated.",
    });
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not update the order item.",
        success: false,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const auth = await requireStaff(request);
    if (auth.error) return auth.error;

    const { id, itemId } = await params;
    const orderId = Number(id);
    const orderItemId = Number(itemId);
    if (
      !Number.isSafeInteger(orderId) ||
      orderId <= 0 ||
      !Number.isSafeInteger(orderItemId) ||
      orderItemId <= 0
    ) {
      return Response.json(
        { error: "A valid order item is required.", success: false },
        { status: 400 }
      );
    }

    const result = await OrderModel.removeStaffOrderItem({
      orderId,
      orderItemId,
    });
    if (!result.ok) {
      return Response.json(
        { error: result.error, success: false },
        { status: result.status }
      );
    }
    logActivity(auth.user, {
      area: "Orders",
      action: "order.item_removed",
      summary: `Removed an item from ${orderRef(result.order)}`,
      entity_type: "order",
      entity_id: orderId,
    });
    return Response.json({
      order: result.order,
      success: true,
      message: "Order item removed.",
    });
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not remove the order item.",
        success: false,
      },
      { status: 500 }
    );
  }
}
