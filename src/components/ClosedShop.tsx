import Link from "next/link";
import { Icon } from "./Icons";
import { timeLabel } from "@/lib/format";
import type { OrderingWindow } from "@/lib/models";

/**
 * The customer-facing "we're closed" screen. Shown instead of the menu or
 * checkout whenever the weekly schedule says ordering is unavailable.
 */
export function ClosedShop({
  ordering,
  table,
  compact = false,
}: {
  ordering: OrderingWindow;
  table: number;
  compact?: boolean;
}) {
  const opensAt = timeLabel(ordering.opens_at);
  const nextOpening = ordering.next_opening;
  const nextOpeningLabel = nextOpening
    ? `${nextOpening.day} at ${timeLabel(nextOpening.start)}`
    : null;

  const todaySchedule = ordering.schedule.find(
    (day) => day.day === ordering.today
  );
  const todayOpen = Boolean(todaySchedule?.open);
  const todayHours =
    todaySchedule && todayOpen
      ? `${timeLabel(todaySchedule.start)} – ${timeLabel(todaySchedule.end)}`
      : "Closed all day";

  let message: string;
  switch (ordering.reason) {
    case "manual":
      message =
        "We've paused new orders for a little while. Please check back soon — the team is still here.";
      break;
    case "before-open":
      message = nextOpeningLabel
        ? `We open ${nextOpeningLabel}. Come back then and we'll get your cup started.`
        : `We open today at ${opensAt}. Come back then and we'll get your cup started.`;
      break;
    case "after-cutoff":
    case "after-close":
      message = nextOpeningLabel
        ? `That's us for today. Ordering opens again on ${nextOpeningLabel}.`
        : `That's us for today. Ordering opens again at ${opensAt}.`;
      break;
    default:
      message = nextOpeningLabel
        ? `It's our day off. We'll be back on ${nextOpeningLabel}.`
        : `It's our day off. We'll be back at ${opensAt}.`;
  }

  return (
    <div className={`state-page ${compact ? "closed-shop-compact" : ""}`}>
      <div className="state-card closed-shop">
        <div className="closed-shop-art" aria-hidden="true">
          <span className="closed-shop-steam" />
          <Icon name="sad" size={40} />
        </div>
        <span className="eyebrow" style={{ color: "var(--brown)" }}>
          Doors closed
        </span>
        <h1 style={{ marginTop: 9 }}>Sorry, the shop is closed.</h1>
        <p>{message}</p>

        <div className="closed-shop-hours">
          <div>
            <span>Today · {ordering.today}</span>
            <b>{todayHours}</b>
          </div>
          <div>
            <span>Next opening</span>
            <b>
              {nextOpening
                ? `${nextOpening.day} · ${timeLabel(
                    nextOpening.start
                  )}`
                : "Check back soon"}
            </b>
          </div>
          {todayOpen && ordering.last_order_at && (
            <div>
              <span>Last order</span>
              <b>{timeLabel(ordering.last_order_at)}</b>
            </div>
          )}
        </div>

        <p className="closed-shop-note">
          <Icon name="info" size={12} /> You can&apos;t place an order right now.
          Table {String(table).padStart(2, "0")} will be waiting when we reopen.
        </p>

        <div className="closed-shop-actions">
          <Link
            href={`/customer/hours?table=${table}`}
            className="btn btn-primary btn-block"
          >
            See cafe hours
          </Link>
          <Link
            href={`/customer/welcome?table=${table}`}
            className="btn btn-outline btn-block"
          >
            Back to welcome
          </Link>
        </div>
      </div>
    </div>
  );
}
