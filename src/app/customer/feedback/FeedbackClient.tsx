"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icons";
import { useFeedback } from "@/components/Feedback";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { useCustomer } from "@/components/CustomerProvider";
import { dateTimeLabel } from "@/lib/format";
import type { Order } from "@/lib/types";

const captions = [
  "We'd love to do better.",
  "A little more care next time.",
  "It was okay.",
  "Lovely visit.",
  "Absolutely delightful!",
];

export function FeedbackClient({
  orderId,
  initialTable,
}: {
  orderId: number;
  initialTable: number;
}) {
  const router = useRouter();
  const feedback = useFeedback();
  const { setTable } = useCustomer();
  const [rating, setRating] = useState(0);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [photo, setPhoto] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ratingAttempted, setRatingAttempted] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState(orderId);
  const [choosingOrder, setChoosingOrder] = useState(false);
  const [availableOrders, setAvailableOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [orderError, setOrderError] = useState("");
  const reviewOrderId = selectedOrderId;
  const reviewTable = selectedOrder?.table_number ?? initialTable;

  useEffect(() => {
    setTable(initialTable);
  }, [initialTable, setTable]);

  useEffect(() => {
    if (!choosingOrder) return;
    let cancelled = false;
    async function loadOrders() {
      setLoadingOrders(true);
      setOrderError("");
      try {
        const response = await fetchPortalApi("/api/orders/history");
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.orders)) {
          throw new Error(data.error || "Could not load your orders.");
        }
        if (!cancelled) setAvailableOrders(data.orders.filter((order: Order) => order.status === "completed"));
      } catch (error) {
        if (!cancelled) setOrderError(error instanceof Error ? error.message : "Could not load your orders.");
      } finally {
        if (!cancelled) setLoadingOrders(false);
      }
    }
    void loadOrders();
    return () => { cancelled = true; };
  }, [choosingOrder]);

  const choosePhoto = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      feedback.warning("That file isn't a photo", {
        message: "Choose a JPG, PNG, or other image file.",
      });
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      feedback.warning("That photo is too large", {
        message: "Choose an image under 3 MB so it sends quickly.",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setRatingAttempted(true);
    if (rating === 0) {
      feedback.warning("How was your visit?", {
        message: "Tap one to five stars so we know how the visit felt.",
      });
      return;
    }
    setSubmitting(true);
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi("/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: reviewOrderId || undefined,
            table_number: reviewTable,
            rating,
            customer_name: name.trim() || undefined,
            comment: comment.trim() || undefined,
            photo_url: photo || undefined,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not send your review.");
        }
        return data;
      },
      {
        loading: {
          title: "Sending your note…",
          message: "Passing it to the team behind the counter.",
        },
        success: () => ({
          eyebrow: "Thank you",
          title: "Your note is with us",
          message: `${captions[rating - 1]} The team reads every review.`,
          duration: 3400,
          details: [
            ...(reviewOrderId ? [{ label: "Order", value: `#${String(reviewOrderId).padStart(3, "0")}` }] : []),
            { label: "Rating", value: `${rating} of 5 stars` },
            { label: "Table", value: String(reviewTable).padStart(2, "0") },
            ...(photo ? [{ label: "Photo", value: "Attached" }] : []),
          ],
        }),
      }
    );
    if (result.ok) {
      router.push(`/customer/thanks?${reviewOrderId ? `order=${reviewOrderId}&` : ""}table=${reviewTable}`);
    } else {
      setSubmitting(false);
    }
  };

  return (
    <div className="review-form-card">
      <span className="eyebrow">A note from your table</span>
      <h1>A little feedback goes a long way.</h1>
      <p>
        Tell us about your Merrylane moment. Your note goes straight to the small
        team behind the counter.
      </p>

      <div className="rating-box">
        <small>How was your visit?</small>
        <div
          className="stars"
          role="radiogroup"
          aria-label="Star rating"
          aria-invalid={ratingAttempted && rating === 0}
          aria-describedby={
            ratingAttempted && rating === 0 ? "rating-error" : undefined
          }
        >
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              className={star <= rating ? "on" : ""}
              onClick={() => setRating(star)}
              aria-label={`${star} star${star === 1 ? "" : "s"}`}
              aria-checked={star === rating}
            >
              <Icon name="star" />
            </button>
          ))}
        </div>
        {ratingAttempted && rating === 0 && (
          <span className="field-error" id="rating-error">
            Choose a star rating before submitting.
          </span>
        )}
        <div className="rating-caption">
          {rating ? `${rating} / 5 · ${captions[rating - 1]}` : "Tap to rate your visit"}
        </div>
      </div>

      <div className="feedback-form">
        <div className="field">
          <span className="label">Order <span className="muted">(optional)</span></span>
          {reviewOrderId > 0 ? (
            <div className="upload-row">
              <span>Order #{String(selectedOrder?.order_number ?? reviewOrderId).padStart(3, "0")}</span>
              <button type="button" className="text-link" onClick={() => { setSelectedOrder(null); setSelectedOrderId(0); }}>
                Remove
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-outline btn-block btn-sm" onClick={() => setChoosingOrder((open) => !open)} aria-expanded={choosingOrder}>
              <Icon name="receipt" className="icon-sm" /> {choosingOrder ? "Hide orders" : "Attach a completed order"}
            </button>
          )}
          {choosingOrder && !reviewOrderId && (
            <div className="field">
              {loadingOrders && <span role="status">Loading your orders…</span>}
              {orderError && <span className="field-error" role="alert">{orderError}</span>}
              {!loadingOrders && !orderError && availableOrders.length === 0 && <span className="muted">No completed orders found. You can still submit a general review.</span>}
              {!loadingOrders && availableOrders.length > 0 && (
                <select className="input" aria-label="Choose a completed order" value="" onChange={(event) => {
                  const order = availableOrders.find((entry) => entry.id === Number(event.target.value));
                  if (order) { setSelectedOrder(order); setSelectedOrderId(order.id); setChoosingOrder(false); }
                }}>
                  <option value="">Choose a completed order</option>
                  {availableOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      Order #{String(order.order_number ?? order.id).padStart(3, "0")} · {dateTimeLabel(order.created_at)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
        <div className="field">
          <label className="label" htmlFor="name">
            Your name <span className="muted">(optional)</span>
          </label>
          <input
            id="name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Please keep me anonymous"
            maxLength={80}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="comment">
            Tell us about your Merrylane moment
          </label>
          <textarea
            id="comment"
            className="textarea"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What made you smile? What could we do better?"
            maxLength={500}
          />
        </div>
        <div className="field">
          <span className="label">
            Add a photo <span className="muted">(optional)</span>
          </span>
          <div className="upload-row">
            <label className="upload-small">
              <input
                type="file"
                accept="image/*"
                onChange={(event) => choosePhoto(event.target.files?.[0] || null)}
              />
              <Icon name="image" className="icon-sm" />
              {photo ? "Photo attached" : "Choose a photo"}
            </label>
            {photo && (
              <button
                type="button"
                className="text-link"
                onClick={() => setPhoto("")}
              >
                Remove
              </button>
            )}
          </div>
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt="Review attachment preview"
              style={{
                width: 94,
                height: 68,
                objectFit: "cover",
                borderRadius: 8,
                border: "1px solid var(--line)",
                marginTop: 2,
              }}
            />
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary btn-block feedback-submit"
          disabled={submitting}
          onClick={submit}
        >
          {submitting ? (
            <>
              <span className="spinner spinner-light" style={{ width: 15, height: 15 }} />
              Sending your note…
            </>
          ) : (
            <>
              Submit review <Icon name="arrow-right" className="icon-sm" />
            </>
          )}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-block btn-sm"
          onClick={() => {
            if (window.history.length > 1) router.back();
            else router.push(`/customer/menu?table=${initialTable}`);
          }}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
