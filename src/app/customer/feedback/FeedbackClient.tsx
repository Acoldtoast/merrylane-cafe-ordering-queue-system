"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icons";
import { useFeedback } from "@/components/Feedback";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { useCustomer } from "@/components/CustomerProvider";

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

  useEffect(() => {
    setTable(initialTable);
  }, [initialTable, setTable]);

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
            order_id: orderId,
            table_number: initialTable,
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
            { label: "Order", value: `#${String(orderId).padStart(3, "0")}` },
            { label: "Rating", value: `${rating} of 5 stars` },
            { label: "Table", value: String(initialTable).padStart(2, "0") },
            ...(photo ? [{ label: "Photo", value: "Attached" }] : []),
          ],
        }),
      }
    );
    if (result.ok) {
      router.push(`/customer/thanks?order=${orderId}&table=${initialTable}`);
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
              className={star <= rating ? "on" : ""}
              onClick={() => setRating(star)}
              aria-label={`${star} star${star === 1 ? "" : "s"}`}
              aria-pressed={star <= rating}
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
        <Link
          href={`/customer/status?id=${orderId}&table=${initialTable}`}
          className="btn btn-ghost btn-block btn-sm"
        >
          Maybe later
        </Link>
      </div>
    </div>
  );
}
