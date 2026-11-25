"use client";

import { errorMessage } from "@/lib/errorMessage";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icons";
import { LoadingDots } from "@/components/LoadingDots";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import { useFeedback } from "@/components/Feedback";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { timeLabel } from "@/lib/format";
import { usePolling } from "@/lib/usePolling";
import { defaultLastOrder, validLastOrder, weeklyScheduleError } from "@/lib/orderingHours";
import { parseServiceChargePct } from "@/lib/serviceCharge";

interface ScheduleDay {
  day: string;
  open: boolean;
  start: string;
  end: string;
  last_order: string;
}

interface Settings {
  cafe_name: string;
  cafe_location: string;
  wifi_ssid: string;
  gcash_number: string;
  gcash_name: string;
  gcash_qr_data_url: string;
  ordering_closed: boolean;
  last_order_time: string;
  weekly_schedule: ScheduleDay[];
  facebook_url: string;
  twitter_url: string;
  tiktok_url: string;
  instagram_url: string;
  social_media_enabled: boolean;
  service_charge_pct: number;
  vat_inclusive: boolean;
}

const TABLE_COUNT = 12;

export function AdminHoursClient() {
  const feedback = useFeedback();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savedSettings, setSavedSettings] = useState<Settings | null>(null);
  const [schedule, setSchedule] = useState<ScheduleDay[]>([]);
  const [savedSchedule, setSavedSchedule] = useState<ScheduleDay[]>([]);
  const [orderingOpen, setOrderingOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");
  const [qrVersion, setQrVersion] = useState(0);
  // Kept as text so a half-typed value ("0.", "-") never rewrites the saved
  // number, and never reaches the API as NaN.
  const [serviceChargeInput, setServiceChargeInput] = useState("0");
  const scheduleError = weeklyScheduleError(schedule);
  // Blank means "no charge" (0); any other value must parse as a finite 0–100.
  const trimmedServiceCharge = serviceChargeInput.trim();
  const serviceChargeParsed = parseServiceChargePct(
    trimmedServiceCharge === "" ? 0 : serviceChargeInput,
    Number.NaN
  );
  const serviceChargeInvalid =
    trimmedServiceCharge !== "" && !Number.isFinite(serviceChargeParsed);
  const serviceChargeIsValid = !serviceChargeInvalid;

  const load = useCallback(async () => {
    try {
      const response = await fetchPortalApi("/api/settings", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Unable to load settings.");
      const nextSchedule = data.settings.weekly_schedule || [];
      const nextSettings = {
        ...data.settings,
        service_charge_pct: parseServiceChargePct(data.settings.service_charge_pct),
      };
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
      setServiceChargeInput(String(nextSettings.service_charge_pct));
      setSchedule(nextSchedule);
      setSavedSchedule(nextSchedule);
      setOrderingOpen(Boolean(data.ordering_open));
      setError("");
    } catch (err: unknown) {
      setError(errorMessage(err, "Unable to load settings."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The origin is only readable in the browser, and awaiting the load keeps
    // both updates off this effect's synchronous path.
    void (async () => {
      await load();
      setOrigin(window.location.origin);
    })();
  }, [load]);

  useEffect(() => {
    // A drawn QR keeps the address it was drawn with. Redraw it after the
    // Wi-Fi address changes, and whenever the admin returns to this tab.
    const refresh = () => setQrVersion((value) => value + 1);
    const timer = setInterval(refresh, 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const refreshOrderingStatus = useCallback(async () => {
    try {
      const response = await fetchPortalApi("/api/settings", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to refresh ordering status.");
      }
      setOrderingOpen(Boolean(data.ordering_open));
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to refresh ordering status."
      );
    }
  }, []);

  usePolling(refreshOrderingStatus, 30_000, {
    immediate: false,
    resources: ["hours", "settings"],
  });

  const save = async (
    extra?: Record<string, unknown>,
    mode: "hours" | "setup" = "hours"
  ) => {
    if (!settings) return;
    if (scheduleError) {
      setError(scheduleError);
      return;
    }
    if (mode === "setup" && serviceChargeInvalid) {
      setError("Enter a service charge from 0 to 100.");
      return;
    }
    setSaving(true);
    setError("");
    const todayName = new Date().toLocaleDateString("en-PH", {
      weekday: "long",
      timeZone: "Asia/Manila",
    });
    const todaySchedule = schedule.find((day) => day.day === todayName);
    const snapshot = {
      cafe_name: settings.cafe_name,
      cafe_location: settings.cafe_location,
      wifi_ssid: settings.wifi_ssid,
      ordering_closed: settings.ordering_closed,
      facebook_url: settings.facebook_url,
      twitter_url: settings.twitter_url,
      tiktok_url: settings.tiktok_url,
      instagram_url: settings.instagram_url,
      social_media_enabled: settings.social_media_enabled,
      service_charge_pct: serviceChargeInvalid
        ? settings.service_charge_pct
        : serviceChargeParsed,
      vat_inclusive: settings.vat_inclusive,
      ...extra,
      weekly_schedule: schedule,
      last_order_time: todaySchedule?.last_order ?? settings.last_order_time,
    };
    const todayHours =
      todaySchedule && todaySchedule.open
        ? `${timeLabel(todaySchedule.start)} – ${timeLabel(todaySchedule.end)}`
        : "Closed all day";

    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snapshot),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not save the schedule.");
        }
        return data;
      },
      {
        loading: {
          title: mode === "setup" ? "Saving your setup…" : "Saving your hours…",
          message:
            mode === "setup"
              ? "Updating your cafe details."
              : "Updating the schedule customers see.",
        },
        success: () =>
          mode === "setup"
            ? {
                eyebrow: "Saved",
                title: "Setup updated",
                message: "Your cafe details are now up to date.",
              }
            : {
                eyebrow: "Saved",
                title: "Hours updated",
                message: "The customer menu now follows this schedule.",
                details: [
                  {
                    label: "Manual pause",
                    value: snapshot.ordering_closed ? "On" : "Off",
                  },
                  { label: `Today · ${todayName}`, value: todayHours },
                  {
                    label: "Today's last order",
                    value: timeLabel(todaySchedule?.last_order),
                  },
                ],
              },
      }
    );
    if (result.ok) await load();
    setSaving(false);
  };

  const toggleOrdering = async (closed: boolean) => {
    setOrderingOpen(!closed);
    await save({ ordering_closed: closed });
  };

  return (
    <>
      {error && <div className="error-strip" style={{ marginBottom: 13 }}>{error}</div>}

      {loading || !settings ? (
        <PortalPageSkeleton area="admin" />
      ) : (
        <div className="hours-layout">
          <div>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Ordering status</h2>
                  <p>Pause new orders instantly if the kitchen needs a moment.</p>
                </div>
                <span className={`ordering-badge ${orderingOpen ? "" : "closed"}`}>
                  <span className="dot" /> {orderingOpen ? "Open" : "Paused"}
                </span>
              </div>
              <div className="panel-body">
                <div className="status-toggle-card">
                  <div>
                    <strong>Accept new orders today</strong>
                    <span>
                      {orderingOpen
                        ? "Customers can place orders right now."
                        : "The menu is visible, but the ordering buttons are disabled."}
                    </span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={!settings.ordering_closed}
                      onChange={(event) => toggleOrdering(!event.target.checked)}
                    />
                    <span className="toggle-track" />
                  </label>
                </div>
              </div>
            </section>

            <section className="panel mt-2">
              <div className="panel-head">
                <div>
                  <h2>Weekly schedule</h2>
                  <p>
                    Changing closing time sets Last order to 30 minutes earlier by default.
                    You can adjust Last order, but it must be before closing.
                  </p>
                </div>
              </div>
              <div className="panel-body">
                <div className="schedule-table-wrap">
                  <table className="schedule-table">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Open</th>
                        <th>Opens</th>
                        <th>Last order</th>
                        <th>Closes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.map((day, index) => (
                        <tr key={day.day}>
                          <td className="schedule-day-name">{day.day}</td>
                          <td className="schedule-open-cell" data-label="Open">
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                checked={day.open}
                                onChange={(event) => {
                                  const next = [...schedule];
                                  next[index] = {
                                    ...day,
                                    open: event.target.checked,
                                  };
                                  setSchedule(next);
                                }}
                                aria-label={`Toggle ${day.day}`}
                              />
                              <span className="toggle-track" />
                            </label>
                          </td>
                          <td data-label="Opens">
                            <input
                              type="time"
                              value={day.start}
                              disabled={!day.open}
                              onChange={(event) => {
                                 const start = event.target.value;
                                 const next = [...schedule];
                                 next[index] = {
                                   ...day,
                                   start,
                                   last_order: validLastOrder(day.last_order, start, day.end)
                                     ? day.last_order
                                     : defaultLastOrder(start, day.end),
                                };
                                setSchedule(next);
                              }}
                              aria-label={`${day.day} opening`}
                            />
                          </td>
                           <td data-label="Last order">
                             <input
                               type="time"
                               value={day.last_order}
                               disabled={!day.open}
                               aria-invalid={!validLastOrder(day.last_order, day.start, day.end)}
                               aria-describedby={scheduleError ? "weekly-schedule-error" : undefined}
                               onChange={(event) => {
                                 const next = [...schedule];
                                 next[index] = { ...day, last_order: event.target.value };
                                 setSchedule(next);
                               }}
                               aria-label={`${day.day} last order cut-off`}
                             />
                           </td>
                           <td data-label="Closes">
                             <input
                               type="time"
                               value={day.end}
                               disabled={!day.open}
                               onChange={(event) => {
                                 const end = event.target.value;
                                 const next = [...schedule];
                                 next[index] = {
                                   ...day,
                                   end,
                                   last_order: defaultLastOrder(day.start, end),
                                 };
                                 setSchedule(next);
                               }}
                               aria-label={`${day.day} closing`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {scheduleError && (
                  <p className="field-error" id="weekly-schedule-error" role="status">{scheduleError}</p>
                )}
                <button
                  type="button"
                  className="btn btn-primary btn-block mt-2"
                  disabled={
                    saving || Boolean(scheduleError) ||
                    JSON.stringify(schedule) === JSON.stringify(savedSchedule)
                  }
                  onClick={() => save()}
                >
                  {saving ? <LoadingDots label="Saving" /> : "Save schedule & hours"}
                </button>
              </div>
            </section>

            <section className="panel mt-2">
              <div className="panel-head">
                <div>
                  <h2>Cafe details and charges</h2>
                  <p>Shown on the welcome screen and used in order totals.</p>
                </div>
              </div>
              <div className="panel-body">
                <div className="modal-form-row">
                  <div className="field">
                    <label className="label" htmlFor="cafe-name">Cafe name</label>
                    <input
                      id="cafe-name"
                      className="input"
                      value={settings.cafe_name}
                      onChange={(event) =>
                        setSettings({ ...settings, cafe_name: event.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="cafe-location">Location</label>
                    <input
                      id="cafe-location"
                      className="input"
                      value={settings.cafe_location}
                      onChange={(event) =>
                        setSettings({ ...settings, cafe_location: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="modal-form-row mt-2">
                  <div className="field">
                    <label className="label" htmlFor="wifi">Wi-Fi network name</label>
                    <input
                      id="wifi"
                      className="input"
                      value={settings.wifi_ssid}
                      onChange={(event) =>
                        setSettings({ ...settings, wifi_ssid: event.target.value })
                      }
                    />
                    <span className="tiny muted">
                      Shown on the welcome and connection screens. Guests on the
                      cafe network go straight to the menu.
                    </span>
                  </div>
                </div>
                <div className="modal-form-row mt-2">
                  <div className="field">
                    <label className="label" htmlFor="social-media-enabled">Social media icons</label>
                    <label className="toggle-switch">
                      <input
                        id="social-media-enabled"
                        type="checkbox"
                        checked={settings.social_media_enabled}
                        onChange={(event) =>
                          setSettings({ ...settings, social_media_enabled: event.target.checked })
                        }
                      />
                      <span className="toggle-track" />
                    </label>
                    <span className="tiny muted">
                      Show clickable social media icons beside the shop logo on the
                      customer ordering page.
                    </span>
                  </div>
                </div>
                <div className="modal-form-row social-links-row">
                  <label className="admin-session-select social-link-field">
                    <span className="label">Facebook</span>
                    <input
                      id="facebook-url"
                      type="url"
                      className="input"
                      placeholder="https://facebook.com/yourpage"
                      value={settings.facebook_url}
                      onChange={(event) =>
                        setSettings({ ...settings, facebook_url: event.target.value })
                      }
                    />
                  </label>
                  <label className="admin-session-select social-link-field">
                    <span className="label">Twitter / X</span>
                    <input
                      id="twitter-url"
                      type="url"
                      className="input"
                      placeholder="https://x.com/yourpage"
                      value={settings.twitter_url}
                      onChange={(event) =>
                        setSettings({ ...settings, twitter_url: event.target.value })
                      }
                    />
                  </label>
                  <label className="admin-session-select social-link-field">
                    <span className="label">TikTok</span>
                    <input
                      id="tiktok-url"
                      type="url"
                      className="input"
                      placeholder="https://tiktok.com/@yourpage"
                      value={settings.tiktok_url}
                      onChange={(event) =>
                        setSettings({ ...settings, tiktok_url: event.target.value })
                      }
                    />
                  </label>
                  <label className="admin-session-select social-link-field">
                    <span className="label">Instagram</span>
                    <input
                      id="instagram-url"
                      type="url"
                      className="input"
                      placeholder="https://instagram.com/yourpage"
                      value={settings.instagram_url}
                      onChange={(event) =>
                        setSettings({ ...settings, instagram_url: event.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="modal-form-row mt-2">
                  <div className="field">
                    <label className="label" htmlFor="service-charge-pct">Service charge (%)</label>
                    <input
                      id="service-charge-pct"
                      className="input"
                      type="text"
                      inputMode="decimal"
                      value={serviceChargeInput}
                      onChange={(event) => {
                        const raw = event.target.value;
                        setServiceChargeInput(raw);
                        const t = raw.trim();
                        const parsed = parseServiceChargePct(
                          t === "" ? 0 : raw,
                          Number.NaN
                        );
                        if (Number.isFinite(parsed)) {
                          setSettings((prev) =>
                            prev ? { ...prev, service_charge_pct: parsed } : prev
                          );
                        }
                      }}
                      onBlur={() => {
                        if (serviceChargeInput.trim() === "") {
                          setServiceChargeInput("0");
                          setSettings((prev) =>
                            prev ? { ...prev, service_charge_pct: 0 } : prev
                          );
                        }
                      }}
                      aria-invalid={!serviceChargeIsValid}
                      placeholder="0"
                    />
                    <span className="tiny muted">
                      {serviceChargeIsValid
                        ? "Added to every order total. Leave 0 if none."
                        : "Enter a number from 0 to 100."}
                    </span>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="vat-inclusive">VAT / tax</label>
                    <label className="toggle-switch">
                      <input
                        id="vat-inclusive"
                        type="checkbox"
                        checked={settings.vat_inclusive}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            vat_inclusive: event.target.checked,
                          })
                        }
                      />
                      <span className="toggle-track" />
                    </label>
                    <span className="tiny muted">
                      Prices are VAT-inclusive when on. Turn off if prices exclude VAT.
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-outline btn-block mt-2"
                  disabled={
                    saving ||
                    JSON.stringify(settings) === JSON.stringify(savedSettings)
                  }
                  onClick={() => save(undefined, "setup")}
                >
                  Save cafe details
                </button>
              </div>
            </section>
          </div>

          <div>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Table QR codes</h2>
                  <p>Print and place one on each table.</p>
                </div>
              </div>
              <div className="panel-body">
                <div className="qr-table-grid">
                  {Array.from({ length: TABLE_COUNT }, (_, index) => index + 1).map(
                    (table) => (
                      <div className="qr-table" key={table}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/qr/${table}?v=${qrVersion}${origin ? `&origin=${encodeURIComponent(origin)}` : ""}`}
                          alt={`QR code for table ${table}`}
                        />
                        <span>Table {String(table).padStart(2, "0")}</span>
                      </div>
                    )
                  )}
                </div>
                <a
                  href="/api/qr/1"
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline btn-block btn-sm mt-2"
                >
                  <Icon name="external" className="icon-sm" /> Open a QR full size
                </a>
                <div className="payment-note" style={{ marginTop: 11 }}>
                  <Icon name="info" />
                  <span>
                    QR codes point to the customer welcome page with the matching table
                    number. They follow this computer&apos;s current Wi-Fi address and
                    redraw themselves when it changes, so they keep working after you
                    move to another network. Set <code>QR_BASE_URL</code> to a stable
                    hostname to keep a saved or printed QR working forever.
                  </span>
                </div>
              </div>
            </section>

          </div>
        </div>
      )}
    </>
  );
}
