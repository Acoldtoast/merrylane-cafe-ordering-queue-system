import {
  handleXenditWebhook,
  verifyXenditCallbackToken,
  XenditPaymentError,
} from "@/lib/xenditPayments";

const MAX_WEBHOOK_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const callbackToken = process.env.XENDIT_WEBHOOK_TOKEN;
  if (!callbackToken) {
    return Response.json(
      { error: "Xendit webhook verification is not configured.", success: false },
      { status: 503 }
    );
  }
  if (
    !verifyXenditCallbackToken(
      request.headers.get("x-callback-token"),
      callbackToken
    )
  ) {
    return Response.json(
      { error: "Unauthorized webhook.", success: false },
      { status: 401 }
    );
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES) {
    return Response.json(
      { error: "Webhook payload is too large.", success: false },
      { status: 413 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json(
      { error: "Invalid webhook JSON.", success: false },
      { status: 400 }
    );
  }

  try {
    const result = await handleXenditWebhook(payload);
    if (result.action === "retry") {
      return Response.json(
        { error: "Payment request details are still being saved.", success: false },
        { status: 503 }
      );
    }
    if (result.action === "unapplied") {
      console.error("Xendit captured a payment that could not be applied.", result);
    }
    return Response.json({ received: true, success: true });
  } catch (error: unknown) {
    if (error instanceof XenditPaymentError) {
      return Response.json(
        { error: error.message, success: false },
        { status: error.status }
      );
    }
    console.error("Could not process Xendit payment webhook.", error);
    return Response.json(
      { error: "Could not process the payment webhook.", success: false },
      { status: 500 }
    );
  }
}
