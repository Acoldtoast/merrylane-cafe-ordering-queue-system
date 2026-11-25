import { CategoryModel } from "@/lib/models";
import { errorMessage } from "@/lib/errorMessage";
import { requireAdmin } from "@/lib/auth";
import { invalidateCache } from "@/lib/serverCache";

export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const orderedIds =
      body && typeof body === "object" ? body.orderedIds : undefined;
    if (
      !Array.isArray(orderedIds) ||
      !orderedIds.every(
        (id: unknown) => typeof id === "number" && Number.isSafeInteger(id) && id > 0
      )
    ) {
      return Response.json(
        { error: "Provide a valid category order.", success: false },
        { status: 400 }
      );
    }

    await CategoryModel.setDisplayOrder(orderedIds);
    invalidateCache("menu");
    return Response.json({ success: true });
  } catch (error: unknown) {
    const message = errorMessage(error, "Could not save category order.");
    return Response.json(
      { error: message, success: false },
      { status: message.startsWith("Category order must") ? 400 : 500 }
    );
  }
}

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
    if (await CategoryModel.hasName(name)) {
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
    const displayOrder = await CategoryModel.nextDisplayOrder();
    const id = await CategoryModel.create(name, slug, displayOrder);
    const category = await CategoryModel.byId(id);
    invalidateCache("menu");
    return Response.json({ category, success: true });
  } catch (error: unknown) {
    return Response.json(
      { error: errorMessage(error, "Could not create category."), success: false },
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

    await CategoryModel.remove(id, replacementId);
    invalidateCache("menu");
    return Response.json({ success: true });
  } catch (error: unknown) {
    const status = /not found/i.test(errorMessage(error, "")) ? 404 : 400;
    return Response.json(
      { error: errorMessage(error, "Could not remove category."), success: false },
      { status }
    );
  }
}
