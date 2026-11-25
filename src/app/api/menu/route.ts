import {
  AddonModel,
  MenuItemModel,
  normalizeVariantGroups,
} from "@/lib/models";
import { requireAdmin } from "@/lib/auth";
import { menuImageValidationError } from "@/lib/menuImage";
import { logActivity } from "@/lib/activityLog";
import { invalidateCache } from "@/lib/serverCache";
import { readMenuCatalog } from "@/lib/portalReadData";
import { errorMessage } from "@/lib/errorMessage";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const includeInactive = url.searchParams.get("all") === "1";

    if (includeInactive) {
      const auth = await requireAdmin(request);
      if (auth.error) return auth.error;
    }

    const payload = await readMenuCatalog(includeInactive);
    return Response.json(payload, {
      headers: {
        "Cache-Control": includeInactive
          ? "private, no-store"
          : "private, max-age=5, stale-while-revalidate=20",
      },
    });
  } catch (error: unknown) {
    return Response.json(
      { error: errorMessage(error, "Could not save the menu changes."), success: false },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    if (!body.name || !body.category_id || body.price === undefined) {
      return Response.json(
        { error: "Name, category and price are required.", success: false },
        { status: 400 }
      );
    }
    const stockTrackingEnabled =
      body.stock_tracking_enabled === false ||
      body.stock_count === undefined ||
      body.stock_count === null ||
      body.stock_count === ""
        ? false
        : true;
    const stockCount = stockTrackingEnabled ? Number(body.stock_count) : 0;
    const stockStatus = body.stock_status ?? "available";
    if (
      stockTrackingEnabled &&
      (!Number.isSafeInteger(stockCount) || stockCount < 0)
    ) {
      return Response.json(
        { error: "Stock on hand must be a whole number of zero or more.", success: false },
        { status: 400 }
      );
    }
    if (!["available", "low", "out"].includes(stockStatus)) {
      return Response.json(
        { error: "Choose a valid stock status.", success: false },
        { status: 400 }
      );
    }
    if (stockTrackingEnabled && stockCount === 0 && stockStatus !== "out") {
      return Response.json(
        { error: "An item with zero stock must be marked sold out.", success: false },
        { status: 400 }
      );
    }
    const imageError = menuImageValidationError(body.image_url);
    if (imageError) {
      return Response.json({ error: imageError, success: false }, { status: 400 });
    }
    let variants: ReturnType<typeof normalizeVariantGroups> = [];
    if (body.variants !== undefined) {
      try {
        variants = normalizeVariantGroups(body.variants);
      } catch (error: unknown) {
        return Response.json(
          { error: errorMessage(error, "Could not save the menu changes."), success: false },
          { status: 400 }
        );
      }
    }
    const id = await MenuItemModel.create({
      name: String(body.name).trim(),
      description: typeof body.description === "string" ? body.description.trim() : "",
      price: Number(body.price),
      category_id: Number(body.category_id),
      is_best_seller: Boolean(body.is_best_seller),
      stock_count: stockCount,
      stock_tracking_enabled: stockTrackingEnabled,
      stock_status: stockStatus,
      stock_note: body.stock_note || null,
      image_url: typeof body.image_url === "string" ? body.image_url : "",
    });
    if (body.variants !== undefined) {
      await MenuItemModel.setVariants(id, variants);
    }
    if (Array.isArray(body.addonIds)) {
      await AddonModel.setForItem(id, body.addonIds);
    }
    logActivity(auth.user, {
      area: "Menu",
      action: "menu.created",
      summary: `Added ${String(body.name).trim()} to the menu`,
      entity_type: "menu_item",
      entity_id: id,
    });
    invalidateCache("menu");
    return Response.json({
      id,
      item: await MenuItemModel.byId(id),
      success: true,
    });
  } catch (error: unknown) {
    return Response.json(
      { error: errorMessage(error, "Could not save the menu changes."), success: false },
      { status: 500 }
    );
  }
}
