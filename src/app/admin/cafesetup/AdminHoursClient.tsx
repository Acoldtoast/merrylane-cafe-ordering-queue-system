"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { adminNav } from "@/components/portalNav";
import { Icon } from "@/components/Icons";
import { LoadingDots } from "@/components/LoadingDots";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import { useFeedback } from "@/components/Feedback";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { timeLabel } from "@/lib/format";
import { usePolling } from "@/lib/usePolling";

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
}

const TABLE_COUNT = 12;

function cutoffWithinClosingTime(
  lastOrder: string,
  start: string,
  end: string
): string {
  const toMinutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return Number.isFinite(hour) && Number.isFinite(minute)
      ? hour * 60 + minute
      : null;
  };
  const cutoffMinutes = toMinutes(lastOrder);
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (
    cutoffMinutes === null ||
    startMinutes === null ||
    endMinutes === null
  ) {
    return lastOrder;
  }

  const overnight = endMinutes !== 0 && endMinutes <= startMinutes;
  const closesAt =
    endMinutes === 0
      ? 24 * 60
      : overnight
        ? endMinutes + 24 * 60
        : endMinutes;
  let cutoffAt = cutoffMinutes;
  if (overnight && cutoffAt < startMinutes) cutoffAt += 24 * 60;
  if (endMinutes === 0 && cutoffAt === 0) cutoffAt = 24 * 60;
  cutoffAt = Math.min(cutoffAt, closesAt);
  const normalized = cutoffAt % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60
  ).padStart(2, "0")}`;
}

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

  const handleGcashQrFile = (file: File | null) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      feedback.warning("That image won't work", {
        message: "Choose a PNG, JPG, or WebP file for the GCash QR.",
      });
      return;
    }
    if (file.size > 1024 * 1024) {
      feedback.warning("That QR image is too large", {
        message: "Use an image that is 1 MB or smaller.",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") {
        feedback.error("Couldn't read that image", {
          message: "Try choosing the GCash QR file again.",
        });
        return;
      }
      setSettings((current) =>
        current ? { ...current, gcash_qr_data_url: dataUrl } : current
      );
      setError("");
    };
    reader.onerror = () =>
      feedback.error("Couldn't read that image", {
        message: "Try choosing the GCash QR file again.",
      });
    reader.readAsDataURL(file);
  };

  const load = useCallback(async () => {
    try {
      const response = await fetchPortalApi("/api/settings", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Unable to load settings.");
      const nextSchedule = data.settings.weekly_schedule || [];
      setSettings(data.settings);
      setSavedSettings(data.settings);
      setSchedule(nextSchedule);
      setSavedSchedule(nextSchedule);
      setOrderingOpen(Boolean(data.ordering_open));
      setError("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    setOrigin(window.location.origin);
  }, [load]);

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
    setSaving(true);
    setError("");
    const todayName = new Date().toLocaleDateString("en-PH", {
      weekday: "long",
      timeZone: "Asia/Manila",
    });
    const todaySchedule = schedule.find((day) => day.day === todayName);
    const snapshot = {
      ...settings,
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
                    Set daily opening, closing, and last-order times. Customers
                    get a one-time warning in the final 30 minutes.
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
                        <th>Closes</th>
                        <th>Last order</th>
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
                                const next = [...schedule];
                                next[index] = {
                                  ...day,
                                  start: event.target.value,
                                  last_order: cutoffWithinClosingTime(
                                    day.last_order,
                                    event.target.value,
                                    day.end
                                  ),
                                };
                                setSchedule(next);
                              }}
                              aria-label={`${day.day} opening`}
                            />
                          </td>
                          <td data-label="Closes">
                            <input
                              type="time"
                              value={day.end}
                              disabled={!day.open}
                              onChange={(event) => {
                                const next = [...schedule];
                                next[index] = {
                                  ...day,
                                  end: event.target.value,
                                  last_order: cutoffWithinClosingTime(
                                    day.last_order,
                                    day.start,
                                    event.target.value
                                  ),
                                };
                                setSchedule(next);
                              }}
                              aria-label={`${day.day} closing`}
                            />
                          </td>
                          <td data-label="Last order">
                            <input
                              type="time"
                              value={day.last_order}
                              disabled={!day.open}
                              onChange={(event) => {
                                const next = [...schedule];
                                next[index] = {
                                  ...day,
                                  last_order: cutoffWithinClosingTime(
                                    event.target.value,
                                    day.start,
                                    day.end
                                  ),
                                };
                                setSchedule(next);
                              }}
                              aria-label={`${day.day} last order cut-off`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-block mt-2"
                  disabled={
                    saving ||
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
                  <h2>Cafe details</h2>
                  <p>Shown on the welcome screen and GCash payment page.</p>
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
                <div className="gcash-payment-settings mt-2">
                  <div className="field">
                    <label className="label" htmlFor="gcash-number">GCash number</label>
                    <input
                      id="gcash-number"
                      className="input"
                      value={settings.gcash_number}
                      onChange={(event) =>
                        setSettings({ ...settings, gcash_number: event.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="gcash-name">GCash account name</label>
                    <input
                      id="gcash-name"
                      className="input"
                      value={settings.gcash_name}
                      onChange={(event) =>
                        setSettings({ ...settings, gcash_name: event.target.value })
                      }
                    />
                  </div>
                  <div className="field gcash-qr-settings-field">
                    <span className="label">GCash QR image</span>
                    <div className="gcash-qr-settings">
                      {settings.gcash_qr_data_url ? (
                        <Image
                          className="gcash-qr-settings-preview"
                          src={settings.gcash_qr_data_url}
                          alt="Uploaded GCash QR preview"
                          width={112}
                          height={112}
                          unoptimized
                        />
                      ) : (
                        <div className="gcash-qr-settings-fallback">
                          Using the generated QR code
                        </div>
                      )}
                      <div>
                        <label className="btn btn-outline btn-sm">
                          <Icon name="upload" className="icon-sm" />
                          {settings.gcash_qr_data_url ? "Change QR image" : "Upload QR image"}
                          <input
                            className="gcash-qr-settings-input"
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(event) => {
                              handleGcashQrFile(event.target.files?.[0] || null);
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        {settings.gcash_qr_data_url && (
                          <button
                            type="button"
                            className="text-link"
                            onClick={() =>
                              setSettings({ ...settings, gcash_qr_data_url: "" })
                            }
                          >
                            Remove custom QR
                          </button>
                        )}
                      </div>
                    </div>
                    <span className="tiny muted">
                      PNG, JPG or WebP · 1 MB maximum. Save cafe details to apply changes.
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
                          src={`/api/qr/${table}${origin ? `?origin=${encodeURIComponent(origin)}` : ""}`}
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
                    number. They adapt to the address currently used to open this admin
                    page.
                  </span>
                </div>
              </div>
            </section>

            <section className="panel mt-2">
              <div className="panel-head">
                <div>
                  <h2>Service hours</h2>
                  <p>What guests see this week.</p>
                </div>
              </div>
              <div className="panel-body">
                <div className="hours-list">
                  {schedule.map((day) => (
                    <div className={`hours-line ${day.open ? "" : "closed"}`} key={day.day}>
                      <span>{day.day}</span>
                      <strong>
                        {day.open
                          ? `${timeLabel(day.start)} – ${timeLabel(day.end)}`
                          : "Closed"}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="status-toggle-card mt-2" style={{ marginBottom: 0 }}>
                  <div>
                    <strong>
                      {orderingOpen ? "Accepting orders" : "Not accepting orders"}
                    </strong>
                    <span>
                      Today&apos;s last order:{" "}
                      {timeLabel(
                        schedule.find(
                          (day) =>
                            day.day ===
                            new Date().toLocaleDateString("en-PH", {
                              weekday: "long",
                              timeZone: "Asia/Manila",
                            })
                        )?.last_order
                      )}
                    </span>
                  </div>
                  <Icon name="clock" className="icon-lg" />
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
