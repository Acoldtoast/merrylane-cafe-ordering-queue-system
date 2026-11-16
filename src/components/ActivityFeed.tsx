import { clockTime, dateTimeLabel } from "@/lib/format";

export interface ActivityLogItem {
  id: number;
  actor_name: string;
  actor_role: "admin" | "staff" | "system";
  area: string;
  action: string;
  summary: string;
  created_at: string;
  user_id?: number | null;
  entity_type?: string | null;
  entity_id?: number | null;
}

const AREA_TONES: Record<string, string> = {
  Payments: "tone-green",
  Orders: "tone-amber",
  Stock: "tone-blue",
  Menu: "tone-brown",
  "Add-ons": "tone-brown",
  Settings: "tone-blue",
  Requests: "tone-amber",
  Accounts: "tone-cream",
  Access: "tone-cream",
};

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Sign-in",
  "auth.login_cooldown": "Sign-in cooldown",
  "auth.login_reset_required": "Sign-in locked",
  "auth.logout": "Sign-out",
  "auth.auto_logout": "Automatic sign-out",
  "auth.password_recovered": "Password recovered",
  signed_out: "Staff sign-out",
  "staff.attendance_signout_corrected": "Sign-out correction",
  "account.created": "Account added",
  "account.updated": "Account updated",
  "account.removed": "Account removed",
  "account.settings_updated": "Account settings updated",
  "addon.created": "Add-on added",
  "addon.updated": "Add-on updated",
  "addon.deleted": "Add-on removed",
  "menu.created": "Menu item added",
  "menu.updated": "Menu item updated",
  "menu.deleted": "Menu item removed",
  "order.cancelled": "Order cancelled",
  "order.item_added": "Item added to order",
  "order.item_updated": "Order item updated",
  "order.item_removed": "Item removed from order",
  "order.addon_added": "Add-on added to order",
  "payment.verified": "Payment verified",
  "payment.rejected": "Payment rejected",
  "balance.verified": "Balance payment verified",
  "balance.rejected": "Balance payment rejected",
  "request.acknowledged": "Request acknowledged",
  "request.resolved": "Request resolved",
  "settings.updated": "Cafe settings updated",
};

const ACTION_TONES: Record<string, string> = {
  "auth.login": "tone-blue",
  "auth.login_cooldown": "tone-amber",
  "auth.login_reset_required": "tone-red",
  "auth.logout": "tone-cream",
  "auth.auto_logout": "tone-amber",
  "auth.password_recovered": "tone-green",
  "account.created": "tone-green",
  "account.updated": "tone-amber",
  "account.removed": "tone-red",
  "account.settings_updated": "tone-amber",
  "addon.created": "tone-green",
  "addon.updated": "tone-amber",
  "addon.deleted": "tone-red",
  "menu.created": "tone-green",
  "menu.updated": "tone-amber",
  "menu.deleted": "tone-red",
  "order.cancelled": "tone-red",
  "order.item_added": "tone-green",
  "order.item_updated": "tone-amber",
  "order.item_removed": "tone-red",
  "order.addon_added": "tone-green",
  "payment.verified": "tone-green",
  "payment.rejected": "tone-red",
  "balance.verified": "tone-green",
  "balance.rejected": "tone-red",
  "request.acknowledged": "tone-blue",
  "request.resolved": "tone-green",
  "settings.updated": "tone-amber",
  "staff.attendance_signout_corrected": "tone-amber",
};

export function activityAreaTone(area: string) {
  return AREA_TONES[area] || "tone-cream";
}

export function activityActionTone(action: string) {
  return Object.prototype.hasOwnProperty.call(ACTION_TONES, action)
    ? ACTION_TONES[action]
    : "tone-cream";
}

export function splitActivitySummary(summary: string) {
  const reasonMatch = /(?:^|\s*[·.]\s*|\s+)Reason:\s*([\s\S]+)$/i.exec(summary);
  if (!reasonMatch) return { description: summary.trim(), reason: "" };

  const description = summary
    .slice(0, reasonMatch.index)
    .replace(/[·.\s]+$/, "")
    .trim();
  const reason = reasonMatch[1].trim();
  return reason
    ? { description, reason }
    : { description: summary.trim(), reason: "" };
}

export function activityDescription(summary: string, action: string) {
  const { description } = splitActivitySummary(summary);
  if (
    action === "settings.updated" &&
    /^Updated cafe settings\s*[·:]/i.test(description)
  ) {
    return "Cafe settings saved; the specific changes were not recorded.";
  }
  return description;
}

export function activityActionLabel(action: string) {
  const knownLabel = Object.prototype.hasOwnProperty.call(
    ACTION_LABELS,
    action
  )
    ? ACTION_LABELS[action]
    : null;
  if (knownLabel) return knownLabel;

  const words = action
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[._-]+/)
    .filter(Boolean);
  if (words.length === 0) return "Activity";
  return words
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function activityRoleLabel(role: string) {
  if (role === "admin") return "Administrator";
  if (role === "system") return "System";
  return "Staff";
}

export function ActivityRow({
  log,
  time = "clock",
  onSelect,
}: {
  log: ActivityLogItem;
  time?: "clock" | "full";
  onSelect?: (log: ActivityLogItem, trigger: HTMLButtonElement) => void;
}) {
  const description = activityDescription(log.summary, log.action);
  const content = (
    <>
      <span className={`activity-badge ${activityAreaTone(log.area)}`}>
        {log.area}
      </span>
      <div className="activity-copy">
        <strong>{description}</strong>
        <span>
          {log.actor_name} · {activityRoleLabel(log.actor_role)}
        </span>
      </div>
      <time dateTime={log.created_at} title={dateTimeLabel(log.created_at)}>
        {time === "full" ? dateTimeLabel(log.created_at) : clockTime(log.created_at)}
      </time>
    </>
  );
  if (!onSelect) return <li className="activity-item">{content}</li>;

  return (
    <li>
      <button
        type="button"
        className="activity-item activity-item-button"
        aria-label={`View activity details for ${log.summary}`}
        onClick={(event) => onSelect(log, event.currentTarget)}
      >
        {content}
      </button>
    </li>
  );
}
