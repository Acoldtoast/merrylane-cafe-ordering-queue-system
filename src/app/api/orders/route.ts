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
import type { DiscountRecipient } from "@/lib/orderDiscount";

const SUGAR_LEVELS = new Set(["0%", "25%", "50%", "75%", "100%"]);
const DATA_IMAGE_PATTERN =
  /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

// Order reads poll this route. Sweeping every unpaid order on each poll burns
// PGlite's single connection, so run it at most once a minute per process.
let lastAutoCancelAt = 0;

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

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
    if (Date.now() - lastAutoCancelAt >= 60_000) {
      lastAutoCancelAt = Date.now();
      await OrderModel.autoCancelUnpaidOrders();
    }
    const url = new URL(request.url);
    const table = url.searchParams.get("table");
    const status = url.searchParams.get("status");
    const id = url.searchParams.get("id");
    const recentVerified = url.searchParams.get("recent_verified");

    if (id) {
      const orderId = Number(id);
      const owner = await OrderModel.guestOwner(orderId);
      const guestId = await getGuestId();
      if (!guestId || owner !== guestId) {
        return Response.json(
          { error: "Order not found.", success: false },
          { status: 404 }
        );
      }
      const order = await OrderModel.byId(orderId);
      return Response.json({ order, success: true });
    }

    if (table) {
      const auth = await requireStaff(request);
      if (auth.error) return auth.error;
      return Response.json({
        orders: await OrderModel.byTable(Number(table), 8),
        success: true,
      });
    }

    const auth = await requireStaff(request);
    if (auth.error) return auth.error;

    if (url.searchParams.get("board") === "1") {
      const today = manilaDate();
      return Response.json({
        orders: await OrderModel.staffBoard(today),
        stats: await OrderModel.todayStats(today),
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
          ? manilaDate()
          : undefined;
      const result = await OrderModel.recentVerified(
        pageSize,
        (page - 1) * pageSize,
        serviceDate
      );
      return Response.json({
        orders: result.orders,
        total: result.total,
        autoCancelledOrders: serviceDate
          ? await OrderModel.unpaidTimeoutCancellationsForDate(serviceDate)
          : [],
        page,
        page_size: pageSize,
        date: serviceDate || null,
        success: true,
      });
    }

    const statuses = status ? (status.split(",") as OrderStatus[]) : undefined;
    return Response.json({
      orders: statuses
        ? await OrderModel.listForDate(statuses, manilaDate())
        : await OrderModel.list(),
      stats: await OrderModel.todayStats(manilaDate()),
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
    const preview = body.preview === true;
    const xendit = body.xendit === true;
    const paymentProof =
      typeof body.payment_proof_url === "string"
        ? body.payment_proof_url.trim()
        : "";
    const paymentReference =
      typeof body.payment_reference === "string"
        ? body.payment_reference.trim()
        : "";

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
    if (preview && payment_method !== "gcash") {
      return Response.json(
        { error: "Only GCash checkouts can be previewed.", success: false },
        { status: 400 }
      );
    }
    if (payment_method === "gcash" && !preview && (paymentProof || paymentReference)) {
      if (!paymentProof || !(DATA_IMAGE_PATTERN.test(paymentProof) || isHttpUrl(paymentProof))) {
        return Response.json(
          { error: "Attach a valid GCash payment proof before submitting.", success: false },
          { status: 400 }
        );
      }
      if (!paymentReference) {
        return Response.json(
          { error: "Enter the GCash reference number shown on your receipt.", success: false },
          { status: 400 }
        );
      }
      if (paymentProof.length > 5_000_000) {
        return Response.json(
          { error: "That image is too large. Please use a file under 3 MB.", success: false },
          { status: 413 }
        );
      }
      if (await OrderModel.gcashReferenceIsInUse(paymentReference)) {
        return Response.json(
          {
            error: "That GCash reference has already been submitted for another payment.",
            success: false,
          },
          { status: 409 }
        );
      }
    }

    if (!(await SettingsModel.isOrderingOpen())) {
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
      item: NonNullable<Awaited<ReturnType<typeof MenuItemModel.byId>>>;
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
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
        return Response.json(
          { error: "Each item quantity must be a whole number between 1 and 20.", success: false },
          { status: 400 }
        );
      }
      const menuItem = await MenuItemModel.byId(Number(line.menuItemId));
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
    const servicePct = Number(
      (await SettingsModel.get("service_charge_pct")) || 0
    );
    const serviceCharge = Math.round(subtotal * (servicePct / 100) * 100) / 100;
    const total = Math.round((subtotal + serviceCharge) * 100) / 100;
    if (preview) {
      const requestedByItem = new Map<number, number>();
      for (const line of priced) {
        requestedByItem.set(
          line.item.id,
          (requestedByItem.get(line.item.id) || 0) + line.quantity
        );
      }
      for (const [menuItemId, quantity] of requestedByItem) {
        const item = priced.find((line) => line.item.id === menuItemId)?.item;
        if (
          item?.stock_tracking_enabled &&
          item.stock_count < quantity
        ) {
          return Response.json(
            {
              error: `Only ${item.stock_count} ${item.name} left. Update your cart quantity and try again.`,
              success: false,
            },
            { status: 409 }
          );
        }
      }
      return Response.json({
        subtotal,
        service_charge: serviceCharge,
        total,
        success: true,
      });
    }

    const guestId = await getOrCreateGuestId();
    const result = await OrderModel.createWithStockDeduction({
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
        payment_proof_url:
          payment_method === "gcash" && paymentProof ? paymentProof : null,
        payment_reference:
          payment_method === "gcash" && paymentReference ? paymentReference : null,
        payment_amount:
          payment_method === "gcash" && paymentProof ? total : null,
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
      orderNumber:
        (await OrderModel.byId(result.orderId))?.order_number ?? result.orderId,
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

    const order = await OrderModel.byId(id);
    if (!order) {
      return Response.json(
        { error: "Order not found.", success: false },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = {};
    let nextStatus = body.status as OrderStatus | undefined;
    if (nextStatus === "completed") {
      if (!(await OrderModel.completeServedByStaff(id))) {
        return Response.json(
          { error: "Only paid orders served at least one hour ago can be completed by staff.", success: false },
          { status: 409 }
        );
      }
      logActivity(auth.user, {
        area: "Orders",
        action: "order.completed_by_staff",
        summary: `Staff completed ${orderRef(order)} after waiting for customer confirmation`,
        entity_type: "order",
        entity_id: id,
      });
      return Response.json({ order: await OrderModel.byId(id), success: true, message: "Order completed by staff." });
    }
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
      if (!(await OrderModel.cancelUnpaidByStaff(id))) {
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
        order: await OrderModel.byId(id),
        success: true,
        message: "Order cancelled.",
      });
    }

    if (body.discounts !== undefined) {
      if (
        order.payment_status === "verified" ||
        !["pending", "payment_pending"].includes(order.status)
      ) {
        return Response.json(
          { error: "Discounts can only be added before payment is verified.", success: false },
          { status: 409 }
        );
      }
      if (
        order.payment_method === "gcash" &&
        order.payment_status !== "rejected" &&
        order.payment_proof_url
      ) {
        return Response.json(
          {
            error: "Apply the discount before the customer submits GCash payment proof.",
            success: false,
          },
          { status: 409 }
        );
      }
      if (!Array.isArray(body.discounts) || body.discounts.length > 10) {
        return Response.json(
          { error: "Add up to 10 valid discount IDs.", success: false },
          { status: 400 }
        );
      }
      const recipients: DiscountRecipient[] = [];
      const seenIds = new Set<string>();
      for (const entry of body.discounts) {
        const type = String(entry?.type || "");
        const idNumber =
          typeof entry?.id_number === "string" ? entry.id_number.trim() : "";
        const name = typeof entry?.name === "string" ? entry.name.trim() : "";
        if (
          !["staff", "senior", "pwd", "other"].includes(type) ||
          !idNumber ||
          idNumber.length > 40 ||
          !name ||
          name.length > 80
        ) {
          return Response.json(
            {
              error: "Each discount needs a valid type, ID number, and name (up to 80 characters).",
              success: false,
            },
            { status: 400 }
          );
        }
        const normalizedId = idNumber.toLowerCase();
        if (seenIds.has(normalizedId)) {
          return Response.json(
            { error: "Each discount ID can only be used once on an order.", success: false },
            { status: 400 }
          );
        }
        seenIds.add(normalizedId);
        recipients.push({
          type: type as DiscountRecipient["type"],
          id_number: idNumber,
          name,
        });
      }

      const discounts = await OrderModel.calculateDiscounts(id, recipients);
      const discountAmount =
        Math.round(
          discounts.reduce((sum, discount) => sum + discount.discount_amount, 0) *
            100
        ) / 100;
      updates.discount_amount = discountAmount;
      updates.discounts_json = discounts.length ? JSON.stringify(discounts) : null;
      updates.total =
        Math.round(
          (Number(order.subtotal) +
            Number(order.service_charge) -
            discountAmount) *
            100
        ) / 100;
      if (order.payment_method === "gcash" && order.payment_status === "rejected") {
        updates.payment_proof_url = null;
        updates.payment_reference = null;
        updates.payment_amount = null;
      }
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
        const payableTotal = Number(updates.total ?? order.total);
        if (order.payment_method === "counter") {
          const cashReceived = Number(body.cash_received);
          if (!Number.isFinite(cashReceived) || cashReceived < payableTotal) {
            return Response.json(
              {
                error: `Enter at least ${money(payableTotal)} received from the customer.`,
                success: false,
              },
              { status: 400 }
            );
          }
          const roundedCash = Math.round(cashReceived * 100) / 100;
          updates.payment_amount = payableTotal;
          updates.cash_received = roundedCash;
          updates.change_given =
            Math.round((roundedCash - payableTotal) * 100) / 100;
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
          updates.payment_amount = payableTotal;
        } else if (order.payment_amount == null) {
          updates.payment_amount = payableTotal;
        }
        if (!nextStatus) {
          nextStatus = order.payment_method === "gcash" ? "confirmed" : "preparing";
        }
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
          updates.queue_number = await OrderModel.nextQueueNumber(manilaDate());
        }
        updates.confirmed_at = order.confirmed_at || stamp();
      }
      if (nextStatus === "preparing") {
        if (
          order.payment_method === "gcash" &&
          order.payment_status !== "verified"
        ) {
          return Response.json(
            {
              error:
                "Verify the GCash payment first, then start preparation from the order board.",
              success: false,
            },
            { status: 409 }
          );
        }
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
          updates.queue_number =
            order.queue_number || await OrderModel.nextQueueNumber(manilaDate());
        }
        updates.preparing_at = order.preparing_at || stamp();
      }
      if (nextStatus === "ready") {
        updates.ready_at = stamp();
        if (!order.confirmed_at) {
          updates.confirmed_at = stamp();
          updates.queue_number =
            order.queue_number || await OrderModel.nextQueueNumber(manilaDate());
        }
      }
    }

    // Grab-style ETA: the accepting staff member sets how many minutes the
    // drink will take, and the customer sees an estimated ready time.
    if (prepMinutes !== undefined) {
      updates.prep_minutes = prepMinutes;
      updates.estimated_ready_at = stamp(prepMinutes);
    } else if (nextStatus === "preparing" && !order.prep_minutes) {
      updates.prep_minutes = 15;
      updates.estimated_ready_at = stamp(15);
    }

    if (body.queue_number !== undefined) {
      updates.queue_number = Number(body.queue_number);
    }

    if (updates.payment_status === "rejected") {
      await OrderModel.rejectPayment(id, updates, stamp(), auth.user.name);
    } else {
      await OrderModel.update(id, updates);
    }
    const updated = (await OrderModel.byId(id)) || order;

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
