"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { adminNav } from "@/components/portalNav";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { useFeedback } from "@/components/Feedback";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { usePolling } from "@/lib/usePolling";
import type { Review } from "@/lib/types";
import { dateTimeLabel, fullDate, smartDateTime } from "@/lib/format";

interface ReviewStats {
  avg_rating: number;
  total_reviews: number;
  positive_pct: number;
}

export function AdminReviewsClient() {
  const pathname = usePathname();
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
      const response = await fetchPortalApi("/api/reviews", { cache: "no-store" });
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
  usePolling(load, 30_000, {
    immediate: false,
    enabled: pathname === "/admin/reviews",
    resources: ["reviews"],
  });

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
        const [reviewPhoto, brandLogo] = await Promise.all([
          selected.photo_url ? loadReviewPhoto(selected.photo_url) : Promise.resolve(null),
          loadBrandLogo(),
        ]);
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

        ctx.drawImage(brandLogo, 92, 80, 360, 158);

        // Stars
        ctx.fillStyle = "#c8a274";
        ctx.font = "34px 'Segoe UI Symbol', Arial, sans-serif";
        const stars = "★★★★★".slice(0, selected.rating) + "☆☆☆☆☆".slice(0, 5 - selected.rating);
        ctx.fillText(stars, 92, 310);

        ctx.fillStyle = "rgba(255,246,232,0.42)";
        ctx.font = "700 19px 'Segoe UI', Arial, sans-serif";
        ctx.fillText("A NOTE FROM OUR TABLE", 94, 358);

        // Keep the text in the left column when a photo uses the open right side.
        const quote = selected.comment?.trim() || "A lovely cup, and an even lovelier visit.";
        ctx.fillStyle = "#fff6e8";
        wrapText(
          ctx,
          `“${quote}”`,
          92,
          460,
          reviewPhoto ? 420 : 880,
          76,
          "500 56px Georgia, 'Times New Roman', serif",
          5
        );

        if (reviewPhoto) {
          drawImageContain(ctx, reviewPhoto, 570, 320, 418, 480, 14);
        }

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
          message: "Drawing the review, brand, and photo if one was attached.",
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

  if (loading) return <PortalPageSkeleton area="admin" />;

  return (
    <>
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
            {filtered.length === 0 ? (
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
                        {review.order_id == null ? "General review" : `Order #${String(review.order_id).padStart(3, "0")}`}
                      </span>
                      {review.photo_url && (
                        <ReviewPhoto
                          key={review.id}
                          className="review-photo-thumb"
                          src={review.photo_url}
                          alt="Photo shared with this review"
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
              <div className={`export-preview${selected?.photo_url ? " has-photo" : ""}`}>
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
                {selected?.photo_url && (
                  <ReviewPhoto
                    key={selected.id}
                    className="export-photo"
                    src={selected.photo_url}
                    alt="Guest photo included with this review"
                  />
                )}
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
                  quote, guest photo when available, table, and date. Nothing is uploaded anywhere.
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
    </>
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

function ReviewPhoto({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) {
  const [unavailable, setUnavailable] = useState(false);
  if (unavailable) {
    return (
      <div
        className={`${className} review-photo-unavailable`}
        role="img"
        aria-label={`${alt} could not be displayed`}
      >
        Photo unavailable
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={src}
      alt={alt}
      onError={() => setUnavailable(true)}
    />
  );
}

function loadReviewPhoto(source: string): Promise<HTMLImageElement> {
  return loadCanvasImage(
    source,
    "The photo attached to this review could not be loaded."
  );
}

function loadBrandLogo(): Promise<HTMLImageElement> {
  return loadCanvasImage(
    "/merrylane-logo-white.png",
    "The Merrylane logo could not be loaded."
  );
}

function loadCanvasImage(
  source: string,
  failureMessage: string
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (/^https?:\/\//i.test(source)) image.crossOrigin = "anonymous";
    image.onload = () => {
      if (image.naturalWidth === 0 || image.naturalHeight === 0) {
        reject(new Error("The image is invalid."));
      } else {
        resolve(image);
      }
    };
    image.onerror = () => reject(new Error(failureMessage));
    image.src = source;
  });
}

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;

  ctx.save();
  roundRect(ctx, drawX, drawY, drawWidth, drawHeight, radius);
  ctx.clip();
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  font: string,
  maxLines: number
) {
  ctx.font = font;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let truncated = false;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
      line = word;
    } else {
      line = test;
    }
  }
  if (!truncated && line) lines.push(line);
  if (truncated && lines.length > 0) {
    let lastLine = lines[lines.length - 1];
    while (
      lastLine.length > 0 &&
      ctx.measureText(`${lastLine}…`).width > maxWidth
    ) {
      lastLine = lastLine.slice(0, -1).trimEnd();
    }
    lines[lines.length - 1] = `${lastLine}…`;
  }
  lines.forEach((value, index) => {
    ctx.fillText(value, x, y + index * lineHeight);
  });
  return y + Math.max(0, lines.length - 1) * lineHeight;
}
