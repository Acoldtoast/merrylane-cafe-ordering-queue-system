import { AddonModel } from "@/lib/models";
import { errorMessage } from "@/lib/errorMessage";
import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { invalidateCache } from "@/lib/serverCache";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const { id } = await params;
    const addonId = Number(id);
    const addon = await AddonModel.byId(addonId);
    if (!addon) {
      return Response.json(
        { error: "Add-on not found.", success: false },
        { status: 404 }
      );
    }

    const body = await request.json();
    if (body.name !== undefined && !String(body.name).trim()) {
      return Response.json(
        { error: "The add-on name cannot be empty.", success: false },
        { status: 400 }
      );
    }

    await AddonModel.update(addonId, {
      name: body.name !== undefined ? String(body.name).trim() : undefined,
      price_modifier:
        body.price_modifier !== undefined ? Number(body.price_modifier) : undefined,
      is_active: body.is_active !== undefined ? Boolean(body.is_active) : undefined,
      display_order:
        body.display_order !== undefined ? Number(body.display_order) : undefined,
    });
    const updated = await AddonModel.byId(addonId);
    logActivity(auth.user, {
      area: "Add-ons",
      action: "addon.updated",
      summary: `Updated add-on ${updated?.name || addon.name}`,
      entity_type: "addon",
      entity_id: addonId,
    });
    invalidateCache("menu");
    return Response.json({ addon: updated, success: true });
  } catch (error: unknown) {
    const duplicate = /UNIQUE/i.test(errorMessage(error, ""));
    return Response.json(
      {
        error: duplicate
          ? "An add-on with that name already exists."
          : errorMessage(error, "Could not update the add-on."),
        success: false,
      },
      { status: duplicate ? 409 : 500 }
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
    const addonId = Number(id);
    const addon = await AddonModel.byId(addonId);
    await AddonModel.remove(addonId);
    logActivity(auth.user, {
      area: "Add-ons",
      action: "addon.deleted",
      summary: `Removed add-on ${addon?.name || `#${addonId}`}`,
      entity_type: "addon",
      entity_id: addonId,
    });
    invalidateCache("menu");
    return Response.json({ success: true });
  } catch (error: unknown) {
    return Response.json(
      { error: errorMessage(error, "Could not remove the add-on."), success: false },
      { status: 500 }
    );
  }
}
