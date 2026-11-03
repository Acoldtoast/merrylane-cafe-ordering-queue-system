"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { adminNav } from "@/components/portalNav";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { useFeedback } from "@/components/Feedback";
import type { Review } from "@/lib/types";
import { dateTimeLabel, fullDate, smartDateTime } from "@/lib/format";

interface ReviewStats {
  avg_rating: number;
  total_reviews: number;
  positive_pct: number;
}

export function AdminReviewsClient() {
  const feedback = useFeedback();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [stats, setStats] = useState<ReviewStats>({
    avg_rating: 0,
    total_reviews: 0,
    positive_pct: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "5" | "4" | "low">("all");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/reviews", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Unable to load reviews.");
      setReviews(data.reviews || []);
      if (data.stats) setStats(data.stats);
      setSelectedId((current) => current || data.reviews?.[0]?.id || null);
      setError("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return reviews;
    if (filter === "low") return reviews.filter((review) => review.rating <= 3);
    return reviews.filter((review) => review.rating === Number(filter));
  }, [reviews, filter]);

  const selected =
    reviews.find((review) => review.id === selectedId) || filtered[0] || null;

  const drawAndDownload = async () => {
    if (!selected) return;
    setExporting(true);
    await feedback.run(
      async () => {
        if (document.fonts?.ready) await document.fonts.ready;
        const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1080;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is unavailable in this browser.");

      const gradient = ctx.createRadialGradient(880, 140, 30, 540, 540, 900);
      gradient.addColorStop(0, "#5a3d2b");
      gradient.addColorStop(0.55, "#38261c");
      gradient.addColorStop(1, "#241811");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1080, 1080);

      ctx.strokeStyle = "rgba(200,162,116,0.16)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(1010, 1010, 300, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(1010, 1010, 210, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(200,162,116,0.28)";
      ctx.beginPath();
      ctx.arc(120, 940, 150, 0, Math.PI * 2);
      ctx.stroke();

      // Brand mark
      ctx.fillStyle = "#c8a274";
      roundRect(ctx, 92, 88, 78, 78, 20);
      ctx.fill();
      ctx.fillStyle = "#38261c";
      ctx.font = "700 40px Georgia, 'Times New Roman', serif";
      ctx.textAlign = "center";
      ctx.fillText("m", 131, 142);

      ctx.textAlign = "left";
      ctx.fillStyle = "#fff6e8";
      ctx.font = "600 40px Georgia, 'Times New Roman', serif";
      ctx.fillText("merrylane", 190, 130);
      ctx.fillStyle = "rgba(255,246,232,0.48)";
      ctx.font = "700 17px 'Segoe UI', Arial, sans-serif";
      ctx.fillText("LIPA CITY · EST. 2021", 192, 157);

      // Stars
      ctx.fillStyle = "#c8a274";
      ctx.font = "34px 'Segoe UI Symbol', Arial, sans-serif";
      const stars = "★★★★★".slice(0, selected.rating) + "☆☆☆☆☆".slice(0, 5 - selected.rating);
      ctx.fillText(stars, 92, 310);

      ctx.fillStyle = "rgba(255,246,232,0.42)";
      ctx.font = "700 19px 'Segoe UI', Arial, sans-serif";
      ctx.fillText("A NOTE FROM OUR TABLE", 94, 358);

      // Quote
      const quote = selected.comment?.trim() || "A lovely cup, and an even lovelier visit.";
      ctx.fillStyle = "#fff6e8";
      wrapText(ctx, `“${quote}”`, 92, 460, 880, 76, "500 56px Georgia, 'Times New Roman', serif");

      // Divider
      ctx.strokeStyle = "rgba(200,162,116,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(92, 852);
      ctx.lineTo(560, 852);
      ctx.stroke();

      ctx.fillStyle = "#fff6e8";
      ctx.font = "600 30px Georgia, 'Times New Roman', serif";
      ctx.fillText(selected.customer_name || "A Merrylane guest", 92, 916);

      ctx.fillStyle = "rgba(255,246,232,0.5)";
      ctx.font = "500 20px 'Segoe UI', Arial, sans-serif";
      ctx.fillText(
        `Table ${String(selected.table_number).padStart(2, "0")} · ${fullDate(selected.created_at)}`,
        92,
        952
      );

      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(200,162,116,0.82)";
      ctx.font = "600 22px Georgia, 'Times New Roman', serif";
      ctx.fillText("merrylane cafe", 988, 952);

        const link = document.createElement("a");
        link.download = `merrylane-review-${selected.id}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        return {
          guest: selected.customer_name || "A Merrylane guest",
          rating: selected.rating,
          table: selected.table_number,
          file: link.download,
        };
      },
      {
        loading: {
          title: "Preparing the promo image…",
          message: "Drawing a 1080 × 1080 card with the review and brand.",
        },
        success: (info) => ({
          eyebrow: "Downloaded",
          title: "Promo image is ready",
          message: "Check your downloads folder for the PNG.",
          details: [
            { label: "Guest", value: info.guest },
            { label: "Rating", value: `${info.rating} of 5 stars` },
            { label: "Table", value: String(info.table).padStart(2, "0") },
            { label: "File", value: info.file },
          ],
        }),
      }
    );
    setExporting(false);
  };

  return (
    <PortalShell
      area="admin"
      title="Kind words, kept."
      subtitle="Every review from every table — and a shareable promo image for the ones worth framing."
      contextLabel="Admin · Reviews"
      contextTitle={`${stats.total_reviews} reviews · ${stats.avg_rating || 0} average`}
      nav={adminNav}
    >
      {error && <div className="error-strip" style={{ marginBottom: 13 }}>{error}</div>}

      <div className="stat-grid three">
        <div className="stat-card dark">
          <div className="stat-label">
            <Icon name="star" /> Average rating
          </div>
          <div className="stat-value">{stats.avg_rating ? stats.avg_rating.toFixed(1) : "—"}</div>
          <div className="stat-bottom">
            <span>Out of 5 stars</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Icon name="reviews" /> Total reviews
          </div>
          <div className="stat-value">{stats.total_reviews}</div>
          <div className="stat-bottom">
            <span>From completed visits</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <Icon name="heart" /> Positive
          </div>
          <div className="stat-value">{stats.positive_pct}%</div>
          <div className="stat-bottom">
            <span>4 stars and above</span>
          </div>
        </div>
      </div>

      <div className="review-export-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>All reviews</h2>
              <p>Newest first · choose one to turn into a promo image.</p>
            </div>
            <div className="tabs">
              {(
                [
                  ["all", "All"],
                  ["5", "5★"],
                  ["4", "4★"],
                  ["low", "≤3★"],
                ] as ["all" | "5" | "4" | "low", string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`tab ${filter === key ? "active" : ""}`}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-body">
            {loading ? (
              <div className="loading-block">
                <span className="spinner" /> Loading reviews…
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-panel" style={{ border: 0 }}>
                <div className="empty-icon">
                  <Icon name="reviews" />
                </div>
                <h3>No reviews here yet.</h3>
                Ask guests to leave a note from their order status page.
              </div>
            ) : (
              filtered.map((review) => (
                <div
                  className="review-card"
                  key={review.id}
                  style={{
                    cursor: "pointer",
                    background:
                      selected?.id === review.id ? "rgba(200,162,116,0.07)" : undefined,
                    borderRadius: 8,
                    paddingLeft: 8,
                    paddingRight: 8,
                  }}
                  onClick={() => setSelectedId(review.id)}
                >
                  <span className="avatar">
                    {(review.customer_name || "Guest")
                      .split(" ")
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div className="review-card-body">
                    <div className="review-card-head">
                      <div>
                        <strong>{review.customer_name || "Anonymous guest"}</strong>
                        <div className="review-stars">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Icon
                              key={star}
                              name="star"
                              style={{ opacity: star <= review.rating ? 1 : 0.22 }}
                            />
                          ))}
                          <small>
                            Table {String(review.table_number).padStart(2, "0")}
                          </small>
                        </div>
                      </div>
                      <time dateTime={review.created_at} title={dateTimeLabel(review.created_at)}>
                        {smartDateTime(review.created_at)}
                      </time>
                    </div>
                    <p>{review.comment || "No written note."}</p>
                    <div className="review-card-foot">
                      <span className="badge badge-cream">
                        Order #{String(review.order_id).padStart(3, "0")}
                      </span>
                      {review.photo_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="review-photo-thumb"
                          src={review.photo_url}
                          alt="Guest photo"
                        />
                      )}
                      {selected?.id === review.id && (
                        <span className="badge badge-amber">Selected for export</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Promo preview</h2>
                <p>Perfect for an Instagram story or poster.</p>
              </div>
            </div>
            <div className="panel-body">
              <div className="export-preview">
                <div className="export-brand">
                  <Brand href="" onDark />
                </div>
                <div className="export-preview-stars">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Icon
                      key={star}
                      name="star"
                      style={{ opacity: star <= (selected?.rating || 0) ? 1 : 0.2 }}
                    />
                  ))}
                </div>
                <div className="export-quote">
                  “
                  {selected?.comment?.trim() ||
                    "A lovely cup, and an even lovelier visit."}
                  ”
                </div>
                <div className="export-author">
                  {selected?.customer_name || "A Merrylane guest"} · Table{" "}
                  {selected ? String(selected.table_number).padStart(2, "0") : "—"}
                </div>
              </div>

              <div className="export-select">
                <label htmlFor="export-review">Review to export</label>
                <select
                  id="export-review"
                  className="select"
                  value={selected?.id || ""}
                  onChange={(event) => setSelectedId(Number(event.target.value))}
                >
                  {reviews.map((review) => (
                    <option key={review.id} value={review.id}>
                      {review.rating}★ · {review.customer_name || "Anonymous"} · Table{" "}
                      {review.table_number}
                    </option>
                  ))}
                </select>
              </div>

              <div className="export-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!selected || exporting}
                  onClick={drawAndDownload}
                >
                  {exporting ? (
                    "Preparing image…"
                  ) : (
                    <>
                      <Icon name="download" className="icon-sm" /> Download promo image
                    </>
                  )}
                </button>
              </div>

              <div className="payment-note" style={{ marginTop: 12 }}>
                <Icon name="image" />
                <span>
                  Exports a 1080 × 1080 PNG with the Merrylane brand, star rating,
                  quote, table, and date. Nothing is uploaded anywhere.
                </span>
              </div>
            </div>
          </div>

          <div className="panel mt-2">
            <div className="panel-head">
              <div>
                <h2>Rating mix</h2>
                <p>How guests are feeling.</p>
              </div>
            </div>
            <div className="panel-body">
              <div className="hours-list">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = reviews.filter((review) => review.rating === star).length;
                  const pct = reviews.length ? Math.round((count / reviews.length) * 100) : 0;
                  return (
                    <div className="list-row" key={star} style={{ padding: "7px 0" }}>
                      <span className="favorite-rank">{star}★</span>
                      <div
                        style={{
                          flex: 1,
                          height: 6,
                          borderRadius: 99,
                          background: "var(--cream-deep)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background: "var(--tan)",
                            borderRadius: 99,
                          }}
                        />
                      </div>
                      <span className="favorite-qty">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>
    </PortalShell>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  font: string
) {
  ctx.font = font;
  const words = text.split(" ");
  let line = "";
  let cursorY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY);
      line = word;
      cursorY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cursorY);
}
