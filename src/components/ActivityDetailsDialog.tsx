"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/Icons";
import { dateTimeLabel } from "@/lib/format";
import {
  activityActionLabel,
  activityActionTone,
  activityAreaTone,
  activityDescription,
  activityRoleLabel,
  splitActivitySummary,
  type ActivityLogItem,
} from "./ActivityFeed";

const ENTITY_LABELS: Record<string, string> = {
  user: "User account",
  order: "Order",
  menu_item: "Menu item",
  addon: "Add-on",
  stock: "Stock item",
  settings: "Cafe settings",
};

function relatedRecordLabel(entityType: string | null | undefined) {
  if (!entityType) return "None recorded";
  const knownLabel = Object.prototype.hasOwnProperty.call(
    ENTITY_LABELS,
    entityType
  )
    ? ENTITY_LABELS[entityType]
    : null;
  if (knownLabel) return knownLabel;

  return entityType
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ActivityDetailsDialog({
  log,
  onClose,
  returnFocusTo,
}: {
  log: ActivityLogItem;
  onClose: () => void;
  returnFocusTo: HTMLButtonElement | null;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { reason } = splitActivitySummary(log.summary);
  const description = activityDescription(log.summary, log.action);

  useEffect(() => {
    closeButtonRef.current?.focus();
    return () => {
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    };
  }, [returnFocusTo]);

  return (
    <div className="modal-backdrop">
      <section
        className="modal activity-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-detail-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const focusable =
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary'
            );
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first) {
            event.preventDefault();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="modal-head activity-detail-head">
          <div className="activity-detail-heading">
            <span className={`activity-badge ${activityAreaTone(log.area)}`}>
              {log.area}
            </span>
            <h2 id="activity-detail-title">Activity details</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close activity details"
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body activity-detail-body">
          <section className="activity-detail-cards">
            <div className="activity-detail-card">
              <p className="activity-detail-label">Action</p>
              <span className={`activity-badge ${activityActionTone(log.action)}`}>
                {activityActionLabel(log.action)}
              </span>
            </div>
            <div className="activity-detail-card">
              <p className="activity-detail-label">Who and when</p>
              <p className="activity-detail-value">{log.actor_name}</p>
              <p className="activity-detail-secondary">
                {activityRoleLabel(log.actor_role)} ·{" "}
                <time dateTime={log.created_at}>
                  {dateTimeLabel(log.created_at)}
                </time>
              </p>
            </div>
            <div className="activity-detail-card">
              <p className="activity-detail-label">Related record</p>
              <p className="activity-detail-value">
                {relatedRecordLabel(log.entity_type)}
                {log.entity_id != null ? ` #${log.entity_id}` : ""}
              </p>
            </div>
          </section>

          <section>
            <h3 className="activity-detail-section-title">More information</h3>
            <div className="activity-information-card">
              <p className="activity-detail-label">
                {log.action === "settings.updated" ? "What changed" : "What happened"}
              </p>
              <p className="activity-information-text">
                {description || "Activity recorded"}
              </p>
            </div>
          </section>

          {reason && (
            <section
              className="activity-reason-card"
              aria-labelledby="activity-reason-title"
            >
              <h3 id="activity-reason-title">Reason</h3>
              <p>{reason}</p>
            </section>
          )}

          <details className="activity-technical-details">
            <summary>Show technical details</summary>
            <dl className="activity-technical-list">
              <div>
                <dt>Activity record</dt>
                <dd>{log.id}</dd>
              </div>
              <div>
                <dt>Account record</dt>
                <dd>{log.user_id ?? "No account linked"}</dd>
              </div>
              <div>
                <dt>Related record type</dt>
                <dd>{log.entity_type || "None recorded"}</dd>
              </div>
              <div>
                <dt>Related record</dt>
                <dd>{log.entity_id ?? "None recorded"}</dd>
              </div>
            </dl>
          </details>
        </div>
      </section>
    </div>
  );
}
