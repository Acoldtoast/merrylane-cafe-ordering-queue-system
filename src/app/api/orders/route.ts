import {
  MenuItemModel,
  OrderModel,
  SettingsModel,
  type OrderStatus,
} from "@/lib/models";
import { requireStaff } from "@/lib/auth";
import { getGuestId, getOrCreateGuestId } from "@/lib/guest";
import {
  logActivity,
  money,
  orderRef,
  paymentMethodLabel,
} from "@/lib/activityLog";

const SUGAR_LEVELS = new Set(["0%", "25%", "50%", "75%", "100%"]);

function stamp(offsetMinutes = 0) {
  const d = new Date(Date.now() + offsetMinutes * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function manilaDate() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

export async function GET(request: Request) {
  try {
    OrderModel.autoCompleteReadyOrders();
    OrderModel.autoCancelUnpaidCounterOrders();
    const url = new URL(request.url);
    const table = url.searchParams.get("table");
    const status = url.searchParams.get("status");
    const id = url.searchParams.get("id");
    const recentVerified = url.searchParams.get("recent_verified");

    if (id) {
      const orderId = Number(id);
      const owner = OrderModel.guestOwner(orderId);
      const guestId = await getGuestId();
      if (owner && owner !== guestId) {
        return Response.json(
          { error: "Order not found.", success: false },
          { status: 404 }
        );
      }
      const order = OrderModel.byId(orderId);
      return Response.json({ order, success: true });
    }

    if (table) {
      return Response.json({
        orders: OrderModel.byTable(Number(table), 8),
        success: true,
      });
    }

    const auth = await requireStaff(request);
    if (auth.error) return auth.error;

    if (url.searchParams.get("board") === "1") {
      const today = manilaDate();
      return Response.json({
        orders: OrderModel.staffBoard(today),
        stats: OrderModel.todayStats(today),
        success: true,
      });
    }

    if (recentVerified === "1") {
      const page = Number(url.searchParams.get("page") || "1");
      if (!Number.isSafeInteger(page) || page < 1) {
        return Response.json(
          { error: "Choose a valid recent payments page.", success: false },
          { status: 400 }
        );
      }
      const pageSize = 10;
      const dateParam = url.searchParams.get("date");
      const businessDay = url.searchParams.get("business_day") === "1";
      if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        return Response.json(
          { error: "Choose a valid day.", success: false },
          { status: 400 }
        );
      }
      const serviceDate = dateParam
        ? dateParam
        : businessDay
          ? SettingsModel.paymentBusinessDate()
          : undefined;
      const result = OrderModel.recentVerified(
        pageSize,
        (page - 1) * pageSize,
        serviceDate
      );
      return Response.json({
        orders: result.orders,
        total: result.total,
        autoCancelledOrders: serviceDate
          ? OrderModel.unpaidTimeoutCancellationsForDate(serviceDate)
          : [],
        page,
        page_size: pageSize,
        date: serviceDate || null,
        success: true,
      });
    }

    const statuses = status ? (status.split(",") as OrderStatus[]) : undefined;
    return Response.json({
      orders: OrderModel.list(statuses),
      stats: OrderModel.todayStats(manilaDate()),
      success: true,
    });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load orders.", success: false },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      table_number,
      order_type,
      payment_method,
      customer_name,
      remarks,
      items,
    }: {
      table_number: number;
      order_type: "dine_in" | "take_out";
      payment_method: "gcash" | "counter";
      customer_name: string;
      remarks?: string;
      items: {
        menuItemId: number;
        quantity: number;
        variantIds?: number[];
        extraIds?: number[];
        addonIds?: number[];
        sugarLevel?: string;
        note?: string;
      }[];
    } = body;

    const customerName =
      typeof customer_name === "string" ? customer_name.trim() : "";
    if (!customerName || customerName.length > 80) {
      return Response.json(
        {
          error: "Enter your name (up to 80 characters) so staff can call you.",
          success: false,
        },
        { status: 400 }
      );
    }
    if (
      !table_number ||
      !order_type ||
      !payment_method ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return Response.json(
        { error: "Your cart is empty or missing order details.", success: false },
        { status: 400 }
      );
    }

    if (!SettingsModel.isOrderingOpen()) {
      return Response.json(
        {
          error:
            "Ordering is currently closed. Please ask a staff member for help.",
          success: false,
        },
        { status: 403 }
      );
    }

    const priced: {
      item: NonNullable<ReturnType<typeof MenuItemModel.byId>>;
      quantity: number;
      variantName: string;
      extras: { id: number; name: string; price_modifier: number }[];
      sugarLevel: string | null;
      note: string | null;
      unitPrice: number;
    }[] = [];

    for (const line of items) {
      const quantity =
        line.quantity === undefined ? 1 : Number(line.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1) {
        return Response.json(
          { error: "Each item quantity must be a whole number greater than zero.", success: false },
          { status: 400 }
        );
      }
      const menuItem = MenuItemModel.byId(Number(line.menuItemId));
      if (!menuItem || !menuItem.is_active) {
        return Response.json(
          { error: "An item in your cart is no longer available.", success: false },
          { status: 400 }
        );
      }
      if (
        menuItem.stock_status === "out" ||
        (menuItem.stock_tracking_enabled && menuItem.stock_count <= 0)
      ) {
        return Response.json(
          {
            error: `${menuItem.name} is currently out of stock. Please remove it from your cart.`,
            success: false,
          },
          { status: 400 }
        );
      }

      const selectedVariants = (line.variantIds || [])
        .map((variantId) =>
          menuItem.variants.find((variant) => variant.id === Number(variantId))
        )
        .filter(Boolean);

      // Keep only one option per variant group (Temperature, Size, etc.)
      const byGroup = new Map<string, (typeof selectedVariants)[number]>();
      for (const variant of selectedVariants) {
        if (variant) byGroup.set(variant.variant_type, variant);
      }
      const finalVariants = Array.from(byGroup.values());
      const selectedExtras = (line.addonIds || line.extraIds || [])
        .map((extraId) => menuItem.extras.find((extra) => extra.id === Number(extraId)))
        .filter(Boolean) as {
        id: number;
        name: string;
        price_modifier: number;
      }[];

      const sugarLevel =
        line.sugarLevel && SUGAR_LEVELS.has(String(line.sugarLevel))
          ? String(line.sugarLevel)
          : null;
      const note = line.note ? String(line.note).trim().slice(0, 180) : null;

      const unitPrice =
        Number(menuItem.price) +
        finalVariants.reduce(
          (sum, variant) => sum + Number(variant?.price_modifier || 0),
          0
        ) +
        selectedExtras.reduce((sum, extra) => sum + Number(extra.price_modifier), 0);

      priced.push({
        item: menuItem,
        quantity,
        variantName: finalVariants
          .map((variant) => variant?.name)
          .filter(Boolean)
          .join(" · "),
        extras: selectedExtras,
        sugarLevel,
        note,
        unitPrice,
      });
    }

    const subtotal = priced.reduce(
      (sum, line) => sum + line.unitPrice * line.quantity,
      0
    );
    const servicePct = Number(SettingsModel.get("service_charge_pct") || 0);
    const serviceCharge = Math.round(subtotal * (servicePct / 100) * 100) / 100;
    const total = Math.round((subtotal + serviceCharge) * 100) / 100;

    const guestId = await getOrCreateGuestId();
    const result = OrderModel.createWithStockDeduction({
      order: {
        table_number: Number(table_number),
        order_type,
        payment_method,
        customer_name: customerName,
        subtotal,
        service_charge: serviceCharge,
        total,
        remarks: remarks?.trim() || undefined,
        status: payment_method === "gcash" ? "payment_pending" : "pending",
        guest_id: guestId,
      },
      items: priced.map((line) => ({
        menu_item_id: line.item.id,
        name: line.item.name,
        variant_name: line.variantName || undefined,
        extras: JSON.stringify(line.extras),
        sugar_level: line.sugarLevel,
        note: line.note,
        quantity: line.quantity,
        price_at_time: line.unitPrice,
      })),
    });
    if (!result.ok) {
      return Response.json(
        { error: result.error, success: false },
        { status: result.status }
      );
    }

    return Response.json({
      orderId: result.orderId,
      total,
      status: payment_method === "gcash" ? "payment_pending" : "pending",
      success: true,
    });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create the order.", success: false },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireStaff(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const id = Number(body.id);
    if (!id) {
      return Response.json(
        { error: "Order ID is required.", success: false },
        { status: 400 }
      );
    }

    const order = OrderModel.byId(id);
    if (!order) {
      return Response.json(
        { error: "Order not found.", success: false },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = {};
    let nextStatus = body.status as OrderStatus | undefined;
    if (nextStatus === "cancelled") {
      if (
        order.status === "cancelled" ||
        order.payment_status === "verified" ||
        !["pending", "payment_pending"].includes(order.status)
      ) {
        return Response.json(
          {
            error: "Only orders awaiting payment can be cancelled from Payment checks.",
            success: false,
          },
          { status: 409 }
        );
      }
      if (!OrderModel.cancelUnpaidByStaff(id)) {
        return Response.json(
          { error: "This order can no longer be cancelled.", success: false },
          { status: 409 }
        );
      }
      logActivity(auth.user, {
        area: "Payments",
        action: "order.cancelled",
        summary: `Cancelled unpaid ${orderRef(order)}`,
        entity_type: "order",
        entity_id: id,
      });
      return Response.json({
        order: OrderModel.byId(id),
        success: true,
        message: "Order cancelled.",
      });
    }

    const prepMinutes =
      body.prep_minutes === undefined || body.prep_minutes === null
        ? undefined
        : Number(body.prep_minutes);
    if (
      prepMinutes !== undefined &&
      (!Number.isFinite(prepMinutes) || prepMinutes < 0 || prepMinutes > 240)
    ) {
      return Response.json(
        { error: "Preparation time must be between 0 and 240 minutes.", success: false },
        { status: 400 }
      );
    }

    if (
      body.payment_status &&
      !["pending", "verified", "rejected"].includes(String(body.payment_status))
    ) {
      return Response.json(
        { error: "Unknown payment status.", success: false },
        { status: 400 }
      );
    }

    if (body.payment_status) {
      updates.payment_status = body.payment_status;
      if (body.payment_status === "verified") {
        if (order.payment_method === "counter") {
          const cashReceived = Number(body.cash_received);
          if (!Number.isFinite(cashReceived) || cashReceived < order.total) {
            return Response.json(
              {
                error: `Enter at least ${money(order.total)} received from the customer.`,
                success: false,
              },
              { status: 400 }
            );
          }
          const roundedCash = Math.round(cashReceived * 100) / 100;
          updates.payment_amount = order.total;
          updates.cash_received = roundedCash;
          updates.change_given =
            Math.round((roundedCash - order.total) * 100) / 100;
        }
        // GCash verification needs the receipt the staff member is checking.
        if (order.payment_method === "gcash" && !order.payment_proof_url) {
          return Response.json(
            {
              error:
                "The customer has not uploaded a GCash receipt yet, so this payment cannot be verified.",
              success: false,
            },
            { status: 400 }
          );
        }
        if (order.payment_method === "counter") {
          updates.payment_amount = order.total;
        } else if (order.payment_amount == null) {
          updates.payment_amount = order.total;
        }
        if (!nextStatus) nextStatus = "preparing";
      }
      if (body.payment_status === "rejected") {
        updates.payment_status = "rejected";
        nextStatus =
          order.payment_method === "gcash" ? "payment_pending" : "pending";
      }
    }

    if (nextStatus) {
      updates.status = nextStatus;
      if (nextStatus === "confirmed") {
        const paymentStatus =
          (updates.payment_status as string) || order.payment_status;
        if (paymentStatus !== "verified") {
          return Response.json(
            {
              error: "Verify the payment before confirming the order.",
              success: false,
            },
            { status: 400 }
          );
        }
        if (!order.queue_number && body.queue_number === undefined) {
          updates.queue_number = OrderModel.nextQueueNumber();
        }
        updates.confirmed_at = order.confirmed_at || stamp();
      }
      if (nextStatus === "preparing") {
        const paymentStatus = (updates.payment_status as string) || order.payment_status;
        if (paymentStatus !== "verified") {
          return Response.json(
            {
              error: "Verify the payment before the order starts preparing.",
              success: false,
            },
            { status: 400 }
          );
        }
        if (!order.confirmed_at) {
          updates.confirmed_at = stamp();
          updates.queue_number = order.queue_number || OrderModel.nextQueueNumber();
        }
        updates.preparing_at = order.preparing_at || stamp();
      }
      if (nextStatus === "ready") {
        updates.ready_at = stamp();
        if (!order.confirmed_at) {
          updates.confirmed_at = stamp();
          updates.queue_number = order.queue_number || OrderModel.nextQueueNumber();
        }
      }
      if (nextStatus === "completed") {
        updates.completed_at = stamp();
      }
    }

    // Grab-style ETA: the accepting staff member sets how many minutes the
    // drink will take, and the customer sees an estimated ready time.
    if (prepMinutes !== undefined) {
      updates.prep_minutes = prepMinutes;
      updates.estimated_ready_at = stamp(prepMinutes);
    } else if (
      (nextStatus === "confirmed" || nextStatus === "preparing") &&
      !order.prep_minutes
    ) {
      updates.prep_minutes = 15;
      updates.estimated_ready_at = stamp(15);
    }

    if (body.queue_number !== undefined) {
      updates.queue_number = Number(body.queue_number);
    }

    OrderModel.update(id, updates);
    const updated = OrderModel.byId(id) || order;

    if (updates.payment_status === "verified") {
      logActivity(auth.user, {
        area: "Payments",
        action: "payment.verified",
        summary: `Verified ${paymentMethodLabel(
          updated.payment_method
        )} payment for ${orderRef(updated)} · ${money(
          updated.payment_amount ?? updated.total
        )}`,
        entity_type: "order",
        entity_id: id,
      });
    } else if (updates.payment_status === "rejected") {
      logActivity(auth.user, {
        area: "Payments",
        action: "payment.rejected",
        summary: `Rejected the GCash receipt for ${orderRef(updated)}`,
        entity_type: "order",
        entity_id: id,
      });
    }

    if (nextStatus) {
      const minutes = updates.prep_minutes ?? updated.prep_minutes ?? null;
      const summaries: Partial<Record<OrderStatus, string>> = {
        confirmed: `Confirmed ${orderRef(updated)}${
          minutes ? ` · ${minutes} min prep` : ""
        }`,
        preparing: `Started preparing ${orderRef(updated)}${
          minutes ? ` · ${minutes} min` : ""
        }`,
        ready: `Marked ${orderRef(updated)} ready`,
        completed: `Completed ${orderRef(updated)}`,
      };
      const summary = summaries[nextStatus];
      if (summary) {
        logActivity(auth.user, {
          area: "Orders",
          action: `order.${nextStatus}`,
          summary,
          entity_type: "order",
          entity_id: id,
        });
      }
    }

    return Response.json({
      order: updated,
      success: true,
      message: "Order updated.",
    });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not update the order.", success: false },
      { status: 500 }
    );
  }
}
