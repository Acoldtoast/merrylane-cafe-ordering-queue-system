/**
 * Duty-window decision only. This does not authenticate a user or verify a
 * face; callers must persist successful checks and enforce this on the server.
 */
export const DEFAULT_FACE_DUTY_HOURS = 9;

export function staffFaceCheckRequired({
  enrolled,
  verifiedAt,
  overrideUntil,
  dutyHours = DEFAULT_FACE_DUTY_HOURS,
  now = Date.now(),
}: {
  enrolled: boolean;
  verifiedAt: string | null;
  overrideUntil: string | null;
  dutyHours?: number;
  now?: number;
}): boolean {
  // An unenrolled staff member must be enrolled before they can pass the check.
  if (!enrolled) return true;
  const override = overrideUntil ? Date.parse(overrideUntil) : NaN;
  if (Number.isFinite(override) && override > now) return false;
  const verified = verifiedAt ? Date.parse(verifiedAt) : NaN;
  if (!Number.isFinite(verified) || verified > now) return true;
  if (!Number.isFinite(dutyHours) || dutyHours <= 0) return true;
  return now >= verified + dutyHours * 60 * 60 * 1000;
}
