import QRCode from "qrcode";
import { getGuestId } from "@/lib/guest";
import { OrderModel } from "@/lib/models";
import {
  createXenditGcashRequest,
  failXenditPaymentRequest,
  getXenditPaymentRequest,
  getXenditConfig,
  prepareXenditPayment,
  saveXenditPaymentRequest,
  syncXenditPaymentStatus,
  XenditPaymentError,
  type XenditPaymentKind,
} from "@/lib/xenditPayments";

type PaymentRequest = NonNullable<
  Awaited<ReturnType<typeof getXenditPaymentRequest>>
>;

async function presentPayment(
  payment: PaymentRequest,
  includeQr: boolean,
  testMode: boolean
) {
  const qrContent = payment.checkout_qr_string || payment.checkout_url;
  const qrCodeDataUrl =
    includeQr && payment.status === "pending" && qrContent
      ? await QRCode.toDataURL(qrContent, {
          width: 224,
          margin: 1,
          errorCorrectionLevel: "M",
        })
      : null;
  return {
    status: payment.status,
    checkoutUrl: payment.checkout_url,
    mobileUrl: payment.checkout_mobile_url,
    qrCodeDataUrl,
    qrIsPaymentQr: Boolean(payment.checkout_qr_string),
    testMode,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isSafeInteger(orderId) || orderId < 1) {
    return Response.json(
      { error: "A valid order ID is required.", success: false },
      { status: 400 }
    );
  }

  const guestId = await getGuestId();
  if (!guestId || (await OrderModel.guestOwner(orderId)) !== guestId) {
    return Response.json(
      { error: "Order not found.", success: false },
      { status: 404 }
    );
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("payment_kind") || "order";
  if (kind !== "order" && kind !== "balance") {
    return Response.json(
      { error: "Choose an order or balance GCash payment.", success: false },
      { status: 400 }
    );
  }

  try {
    if (url.searchParams.get("refresh") === "1") {
      const config = getXenditConfig();
      await syncXenditPaymentStatus(
        orderId,
        kind as XenditPaymentKind,
        config.secretKey
      );
    }

    const payment = await getXenditPaymentRequest(
      orderId,
      kind as XenditPaymentKind
    );
    return Response.json({
      payment: payment
        ? await presentPayment(
            payment,
            url.searchParams.get("include_qr") === "1",
            process.env.NODE_ENV !== "production"
          )
        : null,
      success: true,
    });
  } catch (error: unknown) {
    if (error instanceof XenditPaymentError) {
      return Response.json(
        { error: error.message, success: false },
        { status: error.status }
      );
    }
    console.error("Could not refresh Xendit GCash payment status.", error);
    return Response.json(
      { error: "Could not refresh payment status. Please try again.", success: false },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isSafeInteger(orderId) || orderId < 1) {
    return Response.json(
      { error: "A valid order ID is required.", success: false },
      { status: 400 }
    );
  }

  const guestId = await getGuestId();
  if (!guestId || (await OrderModel.guestOwner(orderId)) !== guestId) {
    return Response.json(
      { error: "Order not found.", success: false },
      { status: 404 }
    );
  }

  const order = await OrderModel.byId(orderId);
  if (!order) {
    return Response.json(
      { error: "Order not found.", success: false },
      { status: 404 }
    );
  }

  try {
    const body: unknown = await request.json();
    const kind =
      body && typeof body === "object" && "payment_kind" in body
        ? (body.payment_kind === "balance" ? "balance" : body.payment_kind)
        : "order";
    if (kind !== "order" && kind !== "balance") {
      return Response.json(
        { error: "Choose an order or balance GCash payment.", success: false },
        { status: 400 }
      );
    }

    const host = request.headers.get("host") || "";
    const origin = request.headers.get("origin");
    let returnOrigin = `http://${host}`;
    if (origin) {
      try {
        const parsedOrigin = new URL(origin);
        if (parsedOrigin.host === host) returnOrigin = parsedOrigin.origin;
      } catch {
        return Response.json({ error: "Invalid request origin.", success: false }, { status: 400 });
      }
    }
    const config = getXenditConfig(returnOrigin);
    const attempt = await prepareXenditPayment(
      orderId,
      kind as XenditPaymentKind
    );
    if (attempt.status === "pending" && attempt.checkout_url) {
      return Response.json({
        payment: await presentPayment(
          attempt,
          true,
          config.mode === "test"
        ),
        success: true,
      });
    }

    try {
      const checkout = await createXenditGcashRequest({
        secretKey: config.secretKey,
        appUrl: config.appUrl,
        orderId,
        orderNumber: order.order_number ?? order.id,
        tableNumber: order.table_number,
        kind: kind as XenditPaymentKind,
        referenceId: attempt.reference_id,
        amount: Number(attempt.amount),
      });
      await saveXenditPaymentRequest(
        attempt.reference_id,
        checkout.paymentRequestId,
        checkout.checkoutUrl,
        checkout.mobileUrl,
        checkout.qrString
      );
      const savedPayment = await getXenditPaymentRequest(orderId, kind as XenditPaymentKind);
      if (!savedPayment) {
        throw new XenditPaymentError(
          "The GCash checkout was created but could not be loaded. Please retry.",
          500
        );
      }
      return Response.json({
        payment: await presentPayment(savedPayment, true, config.mode === "test"),
        success: true,
      });
    } catch (error: unknown) {
      await failXenditPaymentRequest(attempt.reference_id);
      if (error instanceof XenditPaymentError) {
        return Response.json(
          { error: error.message, success: false },
          { status: error.status }
        );
      }
      console.error("Could not start Xendit GCash checkout.", error);
      return Response.json(
        { error: "Could not start GCash checkout. Please try again.", success: false },
        { status: 502 }
      );
    }
  } catch (error: unknown) {
    if (error instanceof XenditPaymentError) {
      return Response.json(
        { error: error.message, success: false },
        { status: error.status }
      );
    }
    console.error("Could not prepare Xendit GCash checkout.", error);
    return Response.json(
      { error: "Could not prepare GCash checkout. Please try again.", success: false },
      { status: 500 }
    );
  }
}
