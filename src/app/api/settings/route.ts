import { SettingsModel } from "@/lib/models";
import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

const SETTING_LABELS: Record<string, string> = {
  cafe_name: "cafe name",
  cafe_location: "location",
  wifi_ssid: "Wi-Fi name",
  gcash_number: "GCash number",
  gcash_name: "GCash name",
  gcash_qr_data_url: "GCash QR",
  ordering_closed: "ordering status",
  last_order_time: "last order time",
  opening_time: "opening time",
  closing_time: "closing time",
  service_charge_pct: "service charge",
  vat_inclusive: "VAT setting",
  days_operating: "operating days",
};

const MAX_GCASH_QR_BYTES = 1024 * 1024;
const GCASH_QR_DATA_URL =
  /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

function isValidGcashQr(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === "") return true;
  if (value.length > Math.ceil((MAX_GCASH_QR_BYTES * 4) / 3) + 64) return false;

  const match = GCASH_QR_DATA_URL.exec(value);
  if (!match) return false;

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_GCASH_QR_BYTES) return false;

  if (match[1] === "png") {
    return bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }
  if (match[1] === "jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  );
}

export async function GET() {
  try {
    const values = SettingsModel.object();
    const ordering = SettingsModel.orderingWindow();
    const todaySchedule = ordering.schedule.find((day) => day.day === ordering.today);
    return Response.json({
      settings: {
        cafe_name: values.cafe_name || "Merrylane Cafe",
        cafe_location: values.cafe_location || "Lipa City, Batangas",
        wifi_ssid: values.wifi_ssid || "MERLYLANE-WIFI",
        gcash_number: values.gcash_number || "0917 123 4567",
        gcash_name: values.gcash_name || "Merrylane Cafe",
        gcash_qr_data_url: values.gcash_qr_data_url || "",
        ordering_closed: values.ordering_closed === "true",
        last_order_time:
          ordering.last_order_at ||
          todaySchedule?.last_order ||
          values.last_order_time ||
          "21:00",
        opening_time: todaySchedule?.start || values.opening_time || "09:00",
        closing_time: todaySchedule?.end || values.closing_time || "22:00",
        service_charge_pct: Number(values.service_charge_pct || 0),
        vat_inclusive: values.vat_inclusive !== "false",
        days_operating:
          values.days_operating ||
          "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
        weekly_schedule: ordering.schedule,
      },
      ordering_open: ordering.open,
      last_order_warning: ordering.last_order_warning,
      success: true,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message, success: false },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    if (
      Object.prototype.hasOwnProperty.call(body, "gcash_qr_data_url") &&
      !isValidGcashQr(body.gcash_qr_data_url)
    ) {
      return Response.json(
        {
          error: "GCash QR must be a PNG, JPG, or WebP image no larger than 1 MB.",
          success: false,
        },
        { status: 400 }
      );
    }
    const allowed = new Set([
      "cafe_name",
      "cafe_location",
      "wifi_ssid",
      "gcash_number",
      "gcash_name",
      "gcash_qr_data_url",
      "ordering_closed",
      "last_order_time",
      "opening_time",
      "closing_time",
      "service_charge_pct",
      "vat_inclusive",
      "days_operating",
    ]);

    const updatesManualPause =
      Object.prototype.hasOwnProperty.call(body, "ordering_closed");
    const pausesOrdering =
      updatesManualPause && String(body.ordering_closed) === "true";
    if (
      pausesOrdering &&
      SettingsModel.get("ordering_closed") !== "true"
    ) {
      SettingsModel.paymentBusinessDate();
    }

    for (const [key, value] of Object.entries(body)) {
      if (!allowed.has(key)) continue;
      SettingsModel.set(
        key,
        typeof value === "boolean" ? String(value) : String(value ?? "")
      );
    }

    if (Array.isArray(body.weekly_schedule)) {
      SettingsModel.set("weekly_schedule", JSON.stringify(body.weekly_schedule));
    }
    if (
      updatesManualPause &&
      !pausesOrdering &&
      String(body.ordering_closed) === "false"
    ) {
      SettingsModel.paymentBusinessDate();
    }

    const changed = [
      ...new Set(
        [
          ...Object.keys(body)
            .filter((key) => allowed.has(key))
            .map((key) => SETTING_LABELS[key] || key),
          ...(Array.isArray(body.weekly_schedule) ? ["weekly hours"] : []),
        ].filter(Boolean)
      ),
    ];
    if (changed.length) {
      logActivity(auth.user, {
        area: "Settings",
        action: "settings.updated",
        summary: `Updated cafe settings · ${changed.join(", ")}`,
        entity_type: "settings",
        entity_id: null,
      });
    }

    return Response.json({
      success: true,
      message: "Settings saved.",
      ordering_open: SettingsModel.isOrderingOpen(),
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message, success: false },
      { status: 500 }
    );
  }
}
