import {
  OrderModel,
  SettingsModel,
  WAITER_DAILY_ATTEMPT_LIMIT,
  WaiterRequestModel,
  waiterCooldownAfterAttempt,
} from "@/lib/models";
import { requireStaff } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { getGuestId, getOrCreateGuestId } from "@/lib/guest";

function waitLabel(seconds: number) {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  if (minutes <= 0) return `${remainder} second${remainder === 1 ? "" : "s"}`;
  if (remainder === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"} ${remainder} second${
    remainder === 1 ? "" : "s"
  }`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const table = url.searchParams.get("table");
    if (table) {
      const tableNumber = Number(table);
      if (!Number.isInteger(tableNumber) || tableNumber < 1) {
        return Response.json(
          { error: "Choose a valid table.", success: false },
          { status: 400 }
        );
      }
      const guestId = await getGuestId();
      const [attempts, requests] = await Promise.all([
        WaiterRequestModel.attemptStatus(guestId, tableNumber),
        WaiterRequestModel.listByTable(tableNumber),
      ]);
      return Response.json({
        requests,
        cooldown: {
          active: attempts.cooldown_active,
          retry_after_seconds: attempts.retry_after_seconds,
          request: attempts.latest_request || null,
        },
        attempts,
        daily_limit: WAITER_DAILY_ATTEMPT_LIMIT,
        success: true,
      });
    }

    const auth = await requireStaff(request);
    if (auth.error) return auth.error;
    await WaiterRequestModel.resolveAcknowledgedOlderThan(25);
    const [requestsByTable, stats] = await Promise.all([
      WaiterRequestModel.activeByTable(),
      WaiterRequestModel.stats(),
    ]);
    return Response.json({
      requestsByTable,
      stats,
      success: true,
    });
  } catch (error: unknown) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load waiter requests.",
        success: false,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const ordering = await SettingsModel.orderingWindow();
    if (!ordering.open) {
      return Response.json(
        {
          error: "Waiter service is unavailable while the cafe is closed.",
          shop_closed: true,
          success: false,
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { table_number, order_id, request_type, message } = body;
    if (!table_number || !request_type) {
      return Response.json(
        { error: "Table number and a reason are required.", success: false },
        { status: 400 }
      );
    }

    const tableNumber = Number(table_number);
    if (!Number.isInteger(tableNumber) || tableNumber < 1) {
      return Response.json(
        { error: "Choose a valid table.", success: false },
        { status: 400 }
      );
    }

    const guestId = await getOrCreateGuestId();
    const isFollowUp = request_type === "Order follow-up";
    let attemptNumber: number | undefined;

    if (!isFollowUp) {
      const attempts = await WaiterRequestModel.attemptStatus(guestId, tableNumber);

      if (attempts.remaining <= 0) {
        return Response.json(
          {
            error:
              "You've used all 3 waiter calls for today. Please ask a team member directly if you still need help.",
            daily_limit_reached: true,
            retry_after_seconds: 0,
            attempts,
            daily_limit: WAITER_DAILY_ATTEMPT_LIMIT,
            success: false,
          },
          { status: 429 }
        );
      }

      if (attempts.cooldown_active) {
        return Response.json(
          {
            error: `Please wait ${waitLabel(
              attempts.retry_after_seconds
            )} before calling your waiter again.`,
            retry_after_seconds: attempts.retry_after_seconds,
            request: attempts.latest_request || null,
            attempts,
            daily_limit: WAITER_DAILY_ATTEMPT_LIMIT,
            success: false,
          },
          { status: 429 }
        );
      }

      attemptNumber = attempts.next_attempt || 1;
    }

    if (isFollowUp) {
      const orderId = Number(order_id);
      if (!Number.isInteger(orderId)) {
        return Response.json(
          { error: "A valid table and order are required.", success: false },
          { status: 400 }
        );
      }
      const order = await OrderModel.byId(orderId);
      if (
        !order ||
        order.table_number !== tableNumber ||
        !["pending", "payment_pending", "confirmed", "preparing", "ready"].includes(
          order.status
        )
      ) {
        return Response.json(
          { error: "This order cannot be followed up right now.", success: false },
          { status: 400 }
        );
      }
      const existing = await WaiterRequestModel.activeFollowUp(orderId);
      if (existing) {
        return Response.json({ id: existing.id, request: existing, success: true });
      }
    }

    const id = await WaiterRequestModel.create({
      table_number: tableNumber,
      order_id: order_id ? Number(order_id) : undefined,
      guest_id: guestId,
      attempt_no: attemptNumber,
      request_type: String(request_type).slice(0, 60),
      message: message || "",
    });
    const [createdRequest, attempts] = await Promise.all([
      WaiterRequestModel.byId(id),
      WaiterRequestModel.attemptStatus(guestId, tableNumber),
    ]);
    return Response.json({
      id,
      request: createdRequest,
      retry_after_seconds: isFollowUp
        ? 0
        : waiterCooldownAfterAttempt(attemptNumber || 1),
      attempts,
      daily_limit: WAITER_DAILY_ATTEMPT_LIMIT,
      success: true,
    });
  } catch (error: unknown) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not create the waiter request.",
        success: false,
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireStaff(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    if (!body.id || !body.status) {
      return Response.json(
        { error: "Request ID and status are required.", success: false },
        { status: 400 }
      );
    }
    const id = Number(body.id);
    const status = body.status;
    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !["acknowledged", "resolved"].includes(status)
    ) {
      return Response.json(
        { error: "Choose a valid request and action.", success: false },
        { status: 400 }
      );
    }
    const updated = await WaiterRequestModel.update(id, { status });
    if (!updated) {
      return Response.json(
        { error: "This request has already changed or is no longer active.", success: false },
        { status: 409 }
      );
    }
    const requestRow = await WaiterRequestModel.byId(id);
    if (requestRow) {
      logActivity(auth.user, {
        area: "Requests",
        action: `request.${status}`,
        summary: `${status === "acknowledged" ? "Acknowledged" : "Resolved"} ${
          requestRow.request_type
        } for Table ${String(requestRow.table_number).padStart(2, "0")}`,
        entity_type: "waiter_request",
        entity_id: id,
      });
    }
    return Response.json({ success: true });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not update the request.", success: false },
      { status: 500 }
    );
  }
}
