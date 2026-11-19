import { OrderModel } from "@/lib/models";
import { getGuestId } from "@/lib/guest";
import { createGcashPaymentRequest, getGcashPaymentRequest } from "@/lib/xendit";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action || "create");

    if (action === "verify") {
      const orderId = Number(body.orderId);
      if (!Number.isInteger(orderId) || orderId <= 0) {
        return Response.json({ error: "A valid order ID is required.", success: false }, { status: 400 });
      }
      const guestId = await getGuestId();
      if (!guestId || (await OrderModel.guestOwner(orderId)) !== guestId) {
        return Response.json({ error: "Order not found.", success: false }, { status: 404 });
      }
      const order = await OrderModel.byId(orderId);
      if (!order || !order.payment_reference) {
        return Response.json({ error: "Payment request not found.", success: false }, { status: 404 });
      }
      const payment = await getGcashPaymentRequest(order.payment_reference);
      if (payment.status !== "SUCCEEDED") {
        return Response.json({ success: true, paid: false, status: payment.status });
      }
      if (order.payment_status !== "verified") {
        const queueNumber = await OrderModel.nextQueueNumber();
        await OrderModel.update(orderId, {
          payment_status: "verified",
          status: "confirmed",
          payment_amount: order.total,
          confirmed_at: order.confirmed_at || new Date().toISOString().slice(0, 19).replace("T", " "),
          queue_number: order.queue_number || queueNumber,
        });
      }
      return Response.json({ success: true, paid: true, status: "SUCCEEDED" });
    }

    const orderId = Number(body.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return Response.json({ error: "A valid order ID is required.", success: false }, { status: 400 });
    }
    const guestId = await getGuestId();
    if (!guestId || (await OrderModel.guestOwner(orderId)) !== guestId) {
      return Response.json({ error: "Order not found.", success: false }, { status: 404 });
    }
    const order = await OrderModel.byId(orderId);
    if (!order) {
      return Response.json({ error: "Order not found.", success: false }, { status: 404 });
    }
    const amount = Number(body.amount || order.total);
    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: "A valid payment amount is required.", success: false }, { status: 400 });
    }
    const origin = new URL(request.url).origin;
    const table = order.table_number;
    const successUrl = `${origin}/customer/payment?table=${table}&order=${orderId}&xendit=success`;
    const failureUrl = `${origin}/customer/payment?table=${table}&order=${orderId}&xendit=failed`;
    const payment = await createGcashPaymentRequest({
      referenceId: `order-${orderId}`,
      amount,
      successReturnUrl: successUrl,
      failureReturnUrl: failureUrl,
      description: `Merrylane Cafe order #${orderId}`,
    });
    if (!payment.redirect_url) {
      return Response.json({ error: "Xendit did not return a payment URL.", success: false }, { status: 502 });
    }
    await OrderModel.update(orderId, {
      payment_reference: payment.payment_request_id,
      payment_amount: amount,
    });
    return Response.json({
      success: true,
      payment_request_id: payment.payment_request_id,
      redirect_url: payment.redirect_url,
      status: payment.status,
    });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not start Xendit payment.", success: false },
      { status: 500 }
    );
  }
}
