import { MenuItemModel, StockModel } from "@/lib/models";
import { requireStaff } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { errorMessage } from "@/lib/errorMessage";

export async function GET(request: Request) {
  try {
    const auth = await requireStaff(request);
    if (auth.error) return auth.error;
    return Response.json({ items: await MenuItemModel.all(), success: true });
  } catch (error: unknown) {
    return Response.json(
      { error: errorMessage(error, "Could not update menu availability."), success: false },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireStaff(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const id = Number(body.id);
    if (!id) {
      return Response.json(
        { error: "Menu item ID is required.", success: false },
        { status: 400 }
      );
    }

    const existing = await MenuItemModel.byId(id);
    if (!existing) {
      return Response.json(
        { error: "Menu item not found.", success: false },
        { status: 404 }
      );
    }

    const validStatuses = new Set(["available", "low", "out"]);
    const requestedStatus = body.stock_status ?? existing.stock_status;
    if (!validStatuses.has(requestedStatus)) {
      return Response.json(
        { error: "Choose a valid stock status.", success: false },
        { status: 400 }
      );
    }
    const trackingEnabled =
      typeof body.stock_tracking_enabled === "boolean"
        ? body.stock_tracking_enabled
        : body.stock_count === null || body.stock_count === ""
          ? false
          : body.stock_count !== undefined
            ? true
            : Boolean(existing.stock_tracking_enabled);
    const rawStockCount =
      body.stock_count === undefined ? existing.stock_count : body.stock_count;
    // A limited (tracked) item must carry an explicit count. Reject an empty
    // count when tracking is being turned on, so a crafted request cannot
    // create a "limited but countless" item.
    if (
      trackingEnabled &&
      body.manual_out !== true &&
      (rawStockCount === undefined ||
        rawStockCount === null ||
        rawStockCount === "") &&
      body.stock_tracking_enabled === true
    ) {
      return Response.json(
        { error: "Enter the number of portions left for a limited item.", success: false },
        { status: 400 }
      );
    }
    const stockCount = trackingEnabled ? Number(rawStockCount) : null;
    if (
      trackingEnabled &&
      (!Number.isSafeInteger(stockCount) || Number(stockCount) < 0)
    ) {
      return Response.json(
        { error: "On-hand stock must be a whole number of zero or more.", success: false },
        { status: 400 }
      );
    }
    if (trackingEnabled && stockCount === 0 && requestedStatus !== "out") {
      return Response.json(
        { error: "An item with zero stock must be marked sold out.", success: false },
        { status: 400 }
      );
    }
    const stockScope = body.stock_scope ?? existing.stock_scope ?? "today";
    if (!["today", "until_changed"].includes(stockScope)) {
      return Response.json(
        { error: "Choose whether the sold-out status is for today or until changed.", success: false },
        { status: 400 }
      );
    }
    if (
      body.manual_out !== undefined &&
      typeof body.manual_out !== "boolean"
    ) {
      return Response.json(
        { error: "Choose whether to mark this item sold out manually.", success: false },
        { status: 400 }
      );
    }
    const lowStockThreshold =
      body.low_stock_threshold === undefined
        ? existing.low_stock_threshold
        : Number(body.low_stock_threshold);
    if (
      !Number.isSafeInteger(lowStockThreshold) ||
      lowStockThreshold < 0
    ) {
      return Response.json(
        { error: "The low-portion threshold must be a whole number of zero or more.", success: false },
        { status: 400 }
      );
    }

    await StockModel.update(
      id,
      {
        stock_status: requestedStatus,
        stock_note: body.stock_note,
        stock_scope: stockScope,
        stock_count: stockCount,
        stock_tracking_enabled: trackingEnabled,
        manual_out: body.manual_out,
        low_stock_threshold: lowStockThreshold,
      },
      auth.user!.id
    );

    const item = await MenuItemModel.byId(id);
    const stockLabel =
      item?.stock_status === "out"
        ? "sold out"
        : item?.stock_status === "low"
          ? "low stock"
          : "available";
    logActivity(auth.user, {
      area: "Stock",
      action: body.stock_status ? `stock.${body.stock_status}` : "stock.updated",
      summary:
        body.stock_status !== undefined
          ? `Marked ${item?.name || "a menu item"} ${stockLabel}`
          : body.stock_count !== undefined
            ? `Set ${item?.name || "a menu item"} stock to ${item?.stock_count ?? 0}`
            : body.stock_note !== undefined
              ? `Updated the stock note for ${item?.name || "a menu item"}`
              : `Updated stock for ${item?.name || "a menu item"}`,
      entity_type: "menu_item",
      entity_id: id,
    });
    return Response.json({ success: true, item });
  } catch (error: unknown) {
    return Response.json(
      { error: errorMessage(error, "Could not update menu availability."), success: false },
      { status: 500 }
    );
  }
}
