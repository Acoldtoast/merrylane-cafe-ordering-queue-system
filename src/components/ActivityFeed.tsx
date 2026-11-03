import { clockTime, dateTimeLabel } from "@/lib/format";

export interface ActivityLogItem {
  id: number;
  actor_name: string;
  actor_role: "admin" | "staff" | "system";
  area: string;
  action: string;
  summary: string;
  created_at: string;
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

function roleLabel(role: string) {
  if (role === "admin") return "Administrator";
  if (role === "system") return "System";
  return "Staff";
}

export function ActivityRow({
  log,
  time = "clock",
}: {
  log: ActivityLogItem;
  time?: "clock" | "full";
}) {
  return (
    <li className="activity-item">
      <span className={`activity-badge ${AREA_TONES[log.area] || "tone-cream"}`}>
        {log.area}
      </span>
      <div className="activity-copy">
        <strong>{log.summary}</strong>
        <span>
          {log.actor_name} · {roleLabel(log.actor_role)}
        </span>
      </div>
      <time dateTime={log.created_at} title={dateTimeLabel(log.created_at)}>
        {time === "full" ? dateTimeLabel(log.created_at) : clockTime(log.created_at)}
      </time>
    </li>
  );
}
