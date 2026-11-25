import { OrderModel, ReviewModel } from "@/lib/models";
import { getUser } from "@/lib/auth";
import { getGuestId } from "@/lib/guest";
import { getDb } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const publicOrder = url.searchParams.get("order");
    if (publicOrder) {
      const guestId = await getGuestId();
      const orderId = Number(publicOrder);
      if (!Number.isSafeInteger(orderId) || orderId < 1 || !guestId ||
          (await OrderModel.guestOwner(orderId)) !== guestId) {
        return Response.json({ error: "Order not found.", success: false }, { status: 404 });
      }
      return Response.json({
        review: (await ReviewModel.byOrder(orderId)) || null,
        success: true,
      });
    }

    const user = await getUser(request);
    if (!user) {
      return Response.json(
        { error: "Please sign in to continue.", success: false },
        { status: 401 }
      );
    }
    if (user.role !== "staff" && user.role !== "admin") {
      return Response.json(
        { error: "Staff or administrator access is required.", success: false },
        { status: 403 }
      );
    }

    return Response.json({
      reviews: await ReviewModel.all(),
      stats: await ReviewModel.stats(),
      success: true,
    });
  } catch (error: unknown) {
    console.error("Could not load reviews.", error);
    return Response.json(
      { error: "Could not load reviews.", success: false },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { order_id, table_number, rating, customer_name, comment, photo_url } =
      body;

    const hasOrder = order_id !== undefined && order_id !== null;
    if ((hasOrder && (!Number.isSafeInteger(Number(order_id)) || Number(order_id) < 1)) ||
        !Number.isSafeInteger(Number(table_number)) || Number(table_number) < 1 ||
        !Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5) {
      return Response.json(
        { error: "A valid table and rating are required.", success: false },
        { status: 400 }
      );
    }
    if (Number(rating) < 1 || Number(rating) > 5) {
      return Response.json(
        { error: "Rating must be between 1 and 5.", success: false },
        { status: 400 }
      );
    }

    const orderId = hasOrder ? Number(order_id) : null;
    if (orderId !== null) {
      const guestId = await getGuestId();
      if (!guestId || (await OrderModel.guestOwner(orderId)) !== guestId) {
        return Response.json({ error: "Order not found.", success: false }, { status: 404 });
      }
      const order = await OrderModel.byId(orderId);
      if (!order || order.status !== "completed" || Number(table_number) !== order.table_number) {
        return Response.json(
          { error: "Reviews are available after your order is completed.", success: false },
          { status: 409 }
        );
      }
    }
    if ((customer_name !== undefined && (typeof customer_name !== "string" || customer_name.length > 80)) ||
        (comment !== undefined && (typeof comment !== "string" || comment.length > 500)) ||
        (photo_url !== undefined && (typeof photo_url !== "string" ||
          !/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo_url)))) {
      return Response.json({ error: "Please check your review details.", success: false }, { status: 400 });
    }

    if (photo_url && photo_url.length > 5_000_000) {
      return Response.json(
        { error: "That photo is too large. Please choose a file under 3 MB.", success: false },
        { status: 413 }
      );
    }

    const db = getDb();
    // Apply the nullable-order migration before entering the transaction.
    if (orderId === null) await ReviewModel.ensureGeneralReviews();
    const id = await db.transaction(async () => {
      if (orderId !== null && await ReviewModel.byOrder(orderId)) return null;
      return ReviewModel.create({
        order_id: orderId,
        table_number: Number(table_number),
        rating: Number(rating),
        customer_name: customer_name?.trim() || undefined,
        comment: comment?.trim() || undefined,
        photo_url: photo_url || undefined,
      });
    });
    if (id === null) {
      return Response.json({ error: "You have already reviewed this order.", success: false }, { status: 409 });
    }

    return Response.json({ id, success: true });
  } catch (error: unknown) {
    console.error("Could not submit review.", error);
    return Response.json(
      { error: "Could not submit your review.", success: false },
      { status: 500 }
    );
  }
}
