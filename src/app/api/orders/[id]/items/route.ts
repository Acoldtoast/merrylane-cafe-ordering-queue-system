import { MenuItemModel, OrderModel } from "@/lib/models";
import { requireStaff } from "@/lib/auth";
import { logActivity, orderRef } from "@/lib/activityLog";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireStaff(request);
    if (auth.error) return auth.error;

    const { id } = await params;
    const orderId = Number(id);
    const body = await request.json();
    const menuItemId = Number(body.menuItemId);
    const quantity = Number(body.quantity);
    const variantIds = Array.isArray(body.variantIds)
      ? body.variantIds.map(Number)
      : [];
    const extraIds = Array.isArray(body.extraIds)
      ? body.extraIds.map(Number)
      : [];
    const sugarLevel =
      typeof body.sugarLevel === "string" ? body.sugarLevel : null;
    const note = typeof body.note === "string" ? body.note : "";

    if (
      !Number.isInteger(orderId) ||
      orderId <= 0 ||
      !Number.isInteger(menuItemId) ||
      menuItemId <= 0 ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 20 ||
      [...variantIds, ...extraIds].some(
        (value) => !Number.isInteger(value) || value <= 0
      ) ||
      (sugarLevel !== null &&
        !["0%", "25%", "50%", "75%", "100%"].includes(sugarLevel)) ||
      note.length > 180
    ) {
      return Response.json(
        { error: "Choose an item, valid options, and a quantity from 1 to 20.", success: false },
        { status: 400 }
      );
    }

    const result = OrderModel.addStaffItem({
      orderId,
      menuItemId,
      quantity,
      variantIds,
      extraIds,
      sugarLevel,
      note,
      userId: auth.user!.id,
    });
    if (!result.ok) {
      return Response.json(
        { error: result.error, success: false },
        { status: result.status }
      );
    }

    const item = MenuItemModel.byId(menuItemId);
    logActivity(auth.user, {
      area: "Orders",
      action: "order.item_added",
      summary: `Added ${quantity} × ${item?.name || "an item"} to ${orderRef(
        result.order
      )}`,
      entity_type: "order",
      entity_id: orderId,
    });

    return Response.json({
      order: result.order,
      success: true,
      message: "Item added to the order.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not add the item.";
    return Response.json({ error: message, success: false }, { status: 500 });
  }
}
