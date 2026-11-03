import { OrderModel } from "@/lib/models";
import { requireStaff } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const auth = await requireStaff(request);
    if (auth.error) return auth.error;

    const date = new URL(request.url).searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json(
        { error: "Choose a valid sales date.", success: false },
        { status: 400 }
      );
    }
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      return Response.json(
        { error: "Choose a valid sales date.", success: false },
        { status: 400 }
      );
    }
    const transactions = OrderModel.salesForDate(date);
    const cancelledOrders = OrderModel.cancelledForDate(date);
    const transactionId = new URL(request.url).searchParams.get("transaction_id");
    if (transactionId) {
      const transaction = transactions.find(
        (entry) => entry.transaction_id === transactionId
      );
      if (!transaction) {
        return Response.json(
          { error: "Verified payment not found for this date.", success: false },
          { status: 404 }
        );
      }
      const order = OrderModel.byId(transaction.order_id);
      if (!order) {
        return Response.json(
          { error: "The order for this payment could not be found.", success: false },
          { status: 404 }
        );
      }
      return Response.json({ date, order, transaction, success: true });
    }

    return Response.json({ date, transactions, cancelledOrders, success: true });
  } catch (error: unknown) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not load daily sales.",
        success: false,
      },
      { status: 500 }
    );
  }
}
