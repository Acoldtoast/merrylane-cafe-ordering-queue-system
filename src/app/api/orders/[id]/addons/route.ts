import { AddonModel, OrderModel } from "@/lib/models";
import { requireStaff } from "@/lib/auth";
import { logActivity, orderRef } from "@/lib/activityLog";

/**
 * Staff-added add-ons. Used when a guest asks for pearl, nata, an extra shot,
 * and so on after the order was already sent to the counter.
 */
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
    const orderItemId = Number(body.orderItemId);
    const addonId = Number(body.addonId);
    const quantity = body.quantity === undefined ? 1 : Number(body.quantity);

    if (
      !Number.isInteger(orderId) ||
      orderId <= 0 ||
      !Number.isInteger(orderItemId) ||
      orderItemId <= 0 ||
      !Number.isInteger(addonId) ||
      addonId <= 0 ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1
    ) {
      return Response.json(
        { error: "Choose an order item, add-on, and a positive whole quantity.", success: false },
        { status: 400 }
      );
    }

    const result = await OrderModel.addStaffAddon({
      orderId,
      orderItemId,
      addonId,
      quantity,
      userId: auth.user!.id,
    });
    if (!result.ok) {
      return Response.json(
        { error: result.error, success: false },
        { status: result.status }
      );
    }

    const addon = await AddonModel.byId(addonId);
    logActivity(auth.user, {
      area: "Orders",
      action: "order.addon_added",
      summary: `Added ${quantity > 1 ? `${quantity} × ` : ""}${
        addon?.name || "an add-on"
      } to ${orderRef(result.order)}`,
      entity_type: "order",
      entity_id: orderId,
    });

    return Response.json({
      order: result.order,
      success: true,
      message: "Add-on added to the order.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not add the add-on.";
    return Response.json({ error: message, success: false }, { status: 500 });
  }
}
