import { AddonModel, MenuItemModel, normalizeVariantGroups } from "@/lib/models";
import { requireAdmin } from "@/lib/auth";
import { menuImageValidationError } from "@/lib/menuImage";
import { logActivity } from "@/lib/activityLog";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = await MenuItemModel.byId(Number(id));
  if (!item) {
    return Response.json({ error: "Menu item not found.", success: false }, { status: 404 });
  }
  return Response.json({ item, success: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const { id } = await params;
    const itemId = Number(id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return Response.json({ error: "Menu item not found.", success: false }, { status: 404 });
    }
    const existing = await MenuItemModel.byId(itemId);
    if (!existing) {
      return Response.json({ error: "Menu item not found.", success: false }, { status: 404 });
    }
    const body = await request.json();
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
    const stockCount = trackingEnabled ? Number(rawStockCount) : null;
    const stockStatus = body.stock_status ?? existing.stock_status;
    if (
      trackingEnabled &&
      (!Number.isSafeInteger(stockCount) || Number(stockCount) < 0)
    ) {
      return Response.json(
        { error: "Stock on hand must be a whole number of zero or more.", success: false },
        { status: 400 }
      );
    }
    if (
      body.stock_status !== undefined &&
      !["available", "low", "out"].includes(body.stock_status)
    ) {
      return Response.json(
        { error: "Choose a valid stock status.", success: false },
        { status: 400 }
      );
    }
    if (trackingEnabled && stockCount === 0 && stockStatus !== "out") {
      return Response.json(
        { error: "An item with zero stock must be marked sold out.", success: false },
        { status: 400 }
      );
    }
    const imageError = menuImageValidationError(body.image_url);
    if (imageError) {
      return Response.json({ error: imageError, success: false }, { status: 400 });
    }
    // Sold out means zero on hand: marking an item sold out clears the count,
    // and a positive count always lands on low/available.
    const finalStockCount =
      trackingEnabled && stockStatus === "out" ? 0 : stockCount;
    const finalStockStatus = trackingEnabled
      ? finalStockCount !== null && finalStockCount <= 0
        ? "out"
        : finalStockCount !== null &&
            finalStockCount <= existing.low_stock_threshold
          ? "low"
          : "available"
      : stockStatus === "out"
        ? "out"
        : "available";
    let variants: ReturnType<typeof normalizeVariantGroups> | undefined;
    if (body.variants !== undefined) {
      try {
        variants = normalizeVariantGroups(body.variants);
      } catch (error: any) {
        return Response.json(
          { error: error.message, success: false },
          { status: 400 }
        );
      }
    }
    await MenuItemModel.update(itemId, {
      ...body,
      stock_count: finalStockCount,
      stock_tracking_enabled: trackingEnabled,
      stock_status: finalStockStatus,
    });
    if (variants !== undefined) {
      await MenuItemModel.setVariants(itemId, variants);
    }
    if (Array.isArray(body.addonIds)) {
      await AddonModel.setForItem(itemId, body.addonIds);
    }
    const updated = await MenuItemModel.byId(itemId);
    const changed = [];
    if (body.name !== undefined && body.name !== existing.name) changed.push("name");
    if (body.price !== undefined && Number(body.price) !== Number(existing.price)) changed.push(`price ${existing.price} → ${body.price}`);
    if (body.category_id !== undefined && Number(body.category_id) !== Number(existing.category_id)) changed.push("category");
    if (body.is_best_seller !== undefined && Boolean(body.is_best_seller) !== Boolean(existing.is_best_seller)) changed.push("best seller");
    if (body.is_active !== undefined && Boolean(body.is_active) !== Boolean(existing.is_active)) changed.push("availability");
    if (trackingEnabled !== Boolean(existing.stock_tracking_enabled)) changed.push("stock tracking");
    if (finalStockStatus !== existing.stock_status) changed.push(`stock status ${existing.stock_status} → ${finalStockStatus}`);
    if (trackingEnabled && Number(finalStockCount) !== Number(existing.stock_count)) changed.push(`stock count ${existing.stock_count ?? 0} → ${finalStockCount ?? 0}`);
    if (variants !== undefined) changed.push("variants");
    if (Array.isArray(body.addonIds)) changed.push("add-ons");
    logActivity(auth.user, {
      area: "Menu",
      action: "menu.updated",
      summary: `Updated menu item ${updated?.name || `#${itemId}`}${changed.length ? ` · changed: ${changed.join(", ")}` : ""}`,
      entity_type: "menu_item",
      entity_id: itemId,
    });
    return Response.json({ item: updated, success: true });
  } catch (error: any) {
    return Response.json(
      { error: error.message, success: false },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const { id } = await params;
    const itemId = Number(id);
    const item = await MenuItemModel.byId(itemId);
    await MenuItemModel.delete(itemId);
    logActivity(auth.user, {
      area: "Menu",
      action: "menu.deleted",
      summary: `Removed ${item?.name || `menu item #${itemId}`} from the menu`,
      entity_type: "menu_item",
      entity_id: itemId,
    });
    return Response.json({ success: true });
  } catch (error: any) {
    return Response.json(
      { error: error.message, success: false },
      { status: 500 }
    );
  }
}
