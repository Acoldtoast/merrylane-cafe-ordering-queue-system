import { AddonModel } from "@/lib/models";
import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const includeInactive = url.searchParams.get("all") === "1";

    if (includeInactive) {
      const auth = await requireAdmin(request);
      if (auth.error) return auth.error;
    }

    return Response.json({
      addons: AddonModel.all(includeInactive),
      success: true,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message, success: false },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name) {
      return Response.json(
        { error: "Give the add-on a name.", success: false },
        { status: 400 }
      );
    }

    const id = AddonModel.create({
      name,
      price_modifier: Number(body.price_modifier) || 0,
      is_active: body.is_active !== false,
      display_order: Number(body.display_order) || 0,
    });
    logActivity(auth.user, {
      area: "Add-ons",
      action: "addon.created",
      summary: `Created add-on ${name}`,
      entity_type: "addon",
      entity_id: id,
    });
    return Response.json({ id, addon: AddonModel.byId(id), success: true });
  } catch (error: any) {
    const duplicate = /UNIQUE/i.test(error.message || "");
    return Response.json(
      {
        error: duplicate
          ? "An add-on with that name already exists."
          : error.message,
        success: false,
      },
      { status: duplicate ? 409 : 500 }
    );
  }
}
