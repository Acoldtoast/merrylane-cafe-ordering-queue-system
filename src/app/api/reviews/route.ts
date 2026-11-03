import { OrderModel, ReviewModel } from "@/lib/models";
import { getUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const publicOrder = url.searchParams.get("order");
    if (publicOrder) {
      return Response.json({
        review: ReviewModel.byOrder(Number(publicOrder)) || null,
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
      reviews: ReviewModel.all(),
      stats: ReviewModel.stats(),
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
    const body = await request.json();
    const { order_id, table_number, rating, customer_name, comment, photo_url } =
      body;

    if (!order_id || !table_number || !rating) {
      return Response.json(
        { error: "Order, table and rating are required.", success: false },
        { status: 400 }
      );
    }
    if (Number(rating) < 1 || Number(rating) > 5) {
      return Response.json(
        { error: "Rating must be between 1 and 5.", success: false },
        { status: 400 }
      );
    }

    const order = OrderModel.byId(Number(order_id));
    if (!order) {
      return Response.json(
        { error: "Order not found.", success: false },
        { status: 404 }
      );
    }

    if (photo_url && photo_url.length > 5_000_000) {
      return Response.json(
        { error: "That photo is too large. Please choose a file under 3 MB.", success: false },
        { status: 413 }
      );
    }

    const id = ReviewModel.create({
      order_id: Number(order_id),
      table_number: Number(table_number),
      rating: Number(rating),
      customer_name: customer_name || undefined,
      comment: comment || undefined,
      photo_url: photo_url || undefined,
    });

    return Response.json({ id, success: true });
  } catch (error: any) {
    return Response.json(
      { error: error.message, success: false },
      { status: 500 }
    );
  }
}
