import { ActivityModel, OrderModel, UserModel, verifyPassword } from "@/lib/models";
import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function isValidMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const [year, month] = value.split("-").map(Number);
  return year >= 1000 && month >= 1 && month <= 12;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const { id: rawId } = await context.params;
    const userId = Number(rawId);
    const url = new URL(request.url);
    const date = url.searchParams.get("date") || "";
    const month = url.searchParams.get("month") || date.slice(0, 7);
    if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(userId) || userId <= 0) {
      return Response.json(
        { error: "Choose a valid staff account.", success: false },
        { status: 400 }
      );
    }
    if (
      !isValidDate(date) ||
      date > localDateKey(new Date()) ||
      !isValidMonth(month) ||
      date.slice(0, 7) !== month
    ) {
      return Response.json(
        { error: "Choose a valid date that is not in the future.", success: false },
        { status: 400 }
      );
    }
    const user = await UserModel.byId(userId);
    if (!user || user.role !== "staff") {
      return Response.json(
        { error: "Staff account not found.", success: false },
        { status: 404 }
      );
    }

    const attendance = await UserModel.dutySessionsForDate(userId, date);
    const today = localDateKey(new Date());
    const onDutyToday =
      date === today
        ? attendance.sessions.some((session) => !session.logout_at)
        : (await UserModel.dutySessionsForDate(userId, today)).sessions.some(
            (session) => !session.logout_at
          );
    const attendanceDays = await UserModel.dutySessionsForMonth(userId, month);
    const sales = await ActivityModel.salesForStaffDate(userId, date);
    const monthStart = `${month}-01`;
    const monthEnd = new Date(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)),
      1
    );
    const monthEndExclusive = `${monthEnd.getFullYear()}-${String(
      monthEnd.getMonth() + 1
    ).padStart(2, "0")}-01`;
    const attendanceByDate = new Map(
      attendanceDays.map((day) => [day.date, day])
    );
    const loginDates = await ActivityModel.loginDatesForStaffRange(
      userId,
      monthStart,
      monthEndExclusive
    );
    for (const loginDate of loginDates) {
      if (!attendanceByDate.has(loginDate)) {
        attendanceByDate.set(loginDate, {
          date: loginDate,
          sessions: 1,
          duty_minutes: 0,
        });
      }
    }
    const calendar = [...attendanceByDate.values()].sort((left, right) =>
      left.date.localeCompare(right.date)
    );
    const monthAttendance = calendar.reduce(
      (summary, day) => ({
        duty_days: summary.duty_days + Number(day.sessions > 0),
        duty_minutes: summary.duty_minutes + Number(day.duty_minutes || 0),
      }),
      { duty_days: 0, duty_minutes: 0 }
    );
    const staffMonthSales = await ActivityModel.salesForStaffRange(
      userId,
      monthStart,
      monthEndExclusive
    );
    const cafeMonthSales = await OrderModel.salesTotalsForRange(
      monthStart,
      monthEndExclusive
    );
    const dayTransactions = await OrderModel.salesForDate(date);
    const daySales = {
      amount: dayTransactions.reduce(
        (total, transaction) => total + Number(transaction.amount || 0),
        0
      ),
      transactions: dayTransactions.length,
    };
    return Response.json({
      attendance,
      calendar,
      onDutyToday,
      daySales,
      monthSummary: {
        ...monthAttendance,
        staff_sales: staffMonthSales.amount,
        staff_sales_transactions: staffMonthSales.transactions,
        cafe_sales: cafeMonthSales.amount,
        cafe_sales_transactions: cafeMonthSales.transactions,
      },
      activity: await ActivityModel.forStaffDate(userId, date),
      sales,
      success: true,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to load staff history.",
        success: false,
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error || !auth.user) {
      return auth.error || Response.json(
        { error: "Administrator access is required.", success: false },
        { status: 403 }
      );
    }

    const { id: rawId } = await context.params;
    const userId = Number(rawId);
    if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(userId) || userId <= 0) {
      return Response.json(
        { error: "Choose a valid staff account.", success: false },
        { status: 400 }
      );
    }
    const user = await UserModel.byId(userId);
    if (!user || user.role !== "staff") {
      return Response.json(
        { error: "Staff account not found.", success: false },
        { status: 404 }
      );
    }

    const body = await request.json();
    const date = typeof body.date === "string" ? body.date : "";
    const time = typeof body.time === "string" ? body.time : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const adminPassword =
      typeof body.confirmation_password === "string"
        ? body.confirmation_password
        : "";
    if (
      !isValidDate(date) ||
      date >= localDateKey(new Date()) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
    ) {
      return Response.json(
        { error: "Choose a past date and a valid sign-out time.", success: false },
        { status: 400 }
      );
    }
    if (reason.length < 3 || reason.length > 500 || !adminPassword) {
      return Response.json(
        { error: "Enter a reason and confirm your administrator password.", success: false },
        { status: 400 }
      );
    }
    const admin = await UserModel.byId(auth.user.id);
    if (!admin || !verifyPassword(adminPassword, admin.password_hash)) {
      return Response.json(
        { error: "The administrator password is incorrect.", success: false },
        { status: 403 }
      );
    }

    const correction = await UserModel.correctMissingDutySignOut(userId, date, time);
    if (!correction) {
      return Response.json(
        { error: "No missing sign-out was found for that date and time.", success: false },
        { status: 409 }
      );
    }
    logActivity(auth.user, {
      area: "Accounts",
      action: "staff.attendance_signout_corrected",
      summary: `Recorded ${user.name}'s sign-out for ${date} at ${time}. Reason: ${reason}`,
      entity_type: "user",
      entity_id: user.id,
    });
    return Response.json(
      { correction, success: true },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not correct the sign-out.",
        success: false,
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
