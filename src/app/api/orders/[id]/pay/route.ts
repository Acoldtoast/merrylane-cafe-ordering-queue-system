import { OrderModel } from "@/lib/models";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    const order = await OrderModel.byId(orderId);
    if (!order) {
      return Response.json(
        { error: "Order not found.", success: false },
        { status: 404 }
      );
    }
    if (order.payment_method !== "gcash") {
      return Response.json(
        { error: "This order is not paid through GCash.", success: false },
        { status: 400 }
      );
    }
    if (
      order.payment_status === "verified" ||
      !["pending", "payment_pending"].includes(order.status)
    ) {
      return Response.json(
        {
          error:
            "This payment has already been handled. Please ask a staff member for help.",
          success: false,
        },
        { status: 400 }
      );
    }

    const body = await request.json();
    const proof = body.payment_proof_url;
    const reference = String(body.payment_reference || "").trim();

    if (!proof || typeof proof !== "string") {
      return Response.json(
        { error: "Please attach a screenshot of your GCash receipt.", success: false },
        { status: 400 }
      );
    }
    if (!proof.startsWith("data:image/") && !proof.startsWith("http")) {
      return Response.json(
        { error: "The uploaded file must be an image.", success: false },
        { status: 400 }
      );
    }
    if (!reference) {
      return Response.json(
        { error: "Please enter the GCash reference number.", success: false },
        { status: 400 }
      );
    }
    if (await OrderModel.gcashReferenceIsInUse(reference, orderId)) {
      return Response.json(
        {
          error: "That GCash reference has already been submitted for another payment.",
          success: false,
        },
        { status: 409 }
      );
    }
    if (proof.length > 5_000_000) {
      return Response.json(
        { error: "That image is too large. Please use a file under 3 MB.", success: false },
        { status: 413 }
      );
    }

    await OrderModel.update(orderId, {
      payment_proof_url: proof,
      payment_reference: reference,
      payment_amount: order.total,
      payment_status: "pending",
      status: "payment_pending",
    });

    return Response.json({
      order: await OrderModel.byId(orderId),
      success: true,
      message: "Payment proof submitted. Staff will verify it shortly.",
    });
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not submit the GCash payment.",
        success: false,
      },
      { status: 500 }
    );
  }
}
