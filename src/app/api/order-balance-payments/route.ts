import { OrderModel } from "@/lib/models";
import { requireStaff } from "@/lib/auth";
import {
  logActivity,
  money,
  orderRef,
} from "@/lib/activityLog";

function manilaDate(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

export async function GET(request: Request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  return Response.json({
    payments: await OrderModel.pendingBalancePayments(manilaDate()),
    success: true,
  });
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireStaff(request);
    if (auth.error) return auth.error;
    const body = await request.json();
    const id = Number(body.id);
    const status = body.status;
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      !["verified", "rejected"].includes(status)
    ) {
      return Response.json(
        { error: "A valid payment and decision are required.", success: false },
        { status: 400 }
      );
    }
    const result = await OrderModel.decideBalancePayment(
      id,
      status,
      auth.user!.id
    );
    if (!result.ok) {
      return Response.json(
        { error: result.error, success: false },
        { status: result.status }
      );
    }
    logActivity(auth.user, {
      area: "Payments",
      action: status === "verified" ? "balance.verified" : "balance.rejected",
      summary:
        status === "verified"
          ? `Verified additional GCash balance for ${orderRef(
              result.order
            )} · ${money(result.payment?.amount)}`
          : `Rejected the additional GCash receipt for ${orderRef(
              result.order
            )}`,
      entity_type: "order",
      entity_id: result.order?.id ?? null,
    });
    return Response.json({
      order: result.order,
      payment: result.payment,
      success: true,
      message:
        status === "verified"
          ? "Additional GCash balance verified."
          : "Additional GCash receipt rejected.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not review the payment.";
    return Response.json({ error: message, success: false }, { status: 500 });
  }
}
