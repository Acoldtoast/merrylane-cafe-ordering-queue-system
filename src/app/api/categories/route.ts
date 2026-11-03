import { CategoryModel } from "@/lib/models";
import { requireAdmin } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 40) {
      return Response.json(
        { error: "Category name is required and must be 40 characters or fewer.", success: false },
        { status: 400 }
      );
    }
    if (CategoryModel.hasName(name)) {
      return Response.json(
        { error: "A category with this name already exists.", success: false },
        { status: 409 }
      );
    }

    const slug =
      name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `category-${Date.now()}`;
    const id = CategoryModel.create(name, slug, CategoryModel.nextDisplayOrder());
    const category = CategoryModel.byId(id);
    return Response.json({ category, success: true });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not create category.", success: false },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const id = Number(body.id);
    const replacementId =
      body.replacement_id === undefined ? undefined : Number(body.replacement_id);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json(
        { error: "A valid category is required.", success: false },
        { status: 400 }
      );
    }
    if (
      replacementId !== undefined &&
      (!Number.isInteger(replacementId) || replacementId <= 0)
    ) {
      return Response.json(
        { error: "Choose a valid replacement category.", success: false },
        { status: 400 }
      );
    }

    CategoryModel.remove(id, replacementId);
    return Response.json({ success: true });
  } catch (error: any) {
    const status = /not found/i.test(error.message) ? 404 : 400;
    return Response.json(
      { error: error.message || "Could not remove category.", success: false },
      { status }
    );
  }
}
