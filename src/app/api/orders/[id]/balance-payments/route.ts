import { OrderModel } from "@/lib/models";
import { requireStaff } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return Response.json(
        { error: "A valid order ID is required.", success: false },
        { status: 400 }
      );
    }

    const body = await request.json();
    if (body.payment_method === "counter") {
      const auth = await requireStaff(request);
      if (auth.error) return auth.error;
      const order = await OrderModel.byId(orderId);
      if (!order) {
        return Response.json({ error: "Order not found.", success: false }, { status: 404 });
      }
      const result = await OrderModel.createBalancePayment({
        orderId,
        method: "counter",
        amount: Number(order.balance_due),
        status: "verified",
        receivedBy: auth.user!.id,
      });
      if (!result.ok) {
        return Response.json(
          { error: result.error, success: false },
          { status: result.status }
        );
      }
      return Response.json({
        order: result.order,
        payment: result.payment,
        success: true,
        message: "Additional counter balance marked as paid.",
      });
    }

    if (body.payment_method !== "gcash") {
      return Response.json(
        { error: "Choose GCash or counter payment.", success: false },
        { status: 400 }
      );
    }

    const order = await OrderModel.byId(orderId);
    if (!order) {
      return Response.json({ error: "Order not found.", success: false }, { status: 404 });
    }
    const proof = body.payment_proof_url;
    const reference = String(body.payment_reference || "").trim();
    if (
      typeof proof !== "string" ||
      !/^data:image\/(?:jpeg|png|webp|gif);base64,[a-zA-Z0-9+/]+=*$/.test(proof)
    ) {
      return Response.json(
        { error: "Please attach an image of the additional GCash payment.", success: false },
        { status: 400 }
      );
    }
    if (proof.length > 5_000_000) {
      return Response.json(
        { error: "That image is too large. Please choose a screenshot under 3 MB.", success: false },
        { status: 413 }
      );
    }
    if (!reference || reference.length > 100) {
      return Response.json(
        { error: "Enter the GCash reference number (up to 100 characters).", success: false },
        { status: 400 }
      );
    }
    const result = await OrderModel.createBalancePayment({
      orderId,
      method: "gcash",
      amount: Number(order.balance_due),
      status: "pending",
      paymentReference: reference,
      paymentProofUrl: proof,
    });
    if (!result.ok) {
      return Response.json(
        { error: result.error, success: false },
        { status: result.status }
      );
    }
    return Response.json({
      order: result.order,
      payment: result.payment,
      success: true,
      message: "Additional GCash proof submitted for staff review.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not submit the payment.";
    return Response.json({ error: message, success: false }, { status: 500 });
  }
}
