import { createHash, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { SettingsModel, UserModel } from "@/lib/models";
import { ensureStaffIdentityTable } from "@/lib/staffIdentityRegistration";
import { DEFAULT_FACE_DUTY_HOURS, staffFaceCheckRequired } from "@/lib/staffFaceDuty";

const setups = new WeakMap<object, Promise<void>>();
function ensureFaceTables() {
  const db = getDb();
  let setup = setups.get(db);
  if (!setup) {
    setup = (async () => {
      await ensureStaffIdentityTable();
      await db.exec(`CREATE TABLE IF NOT EXISTS staff_face_duty_checks (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        verified_at TIMESTAMPTZ NOT NULL,
        enrollment_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS staff_face_duty_resets (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL
      );
      ALTER TABLE staff_face_duty_resets ADD COLUMN IF NOT EXISTS revoked_session_id TEXT`);
    })().catch((error) => { setups.delete(db); throw error; });
    setups.set(db, setup);
  }
  return setup;
}

export async function faceDutySettings() {
  const [enabled, hours] = await Promise.all([
    SettingsModel.get("staff_face_check_enabled"),
    SettingsModel.get("staff_face_duty_hours"),
  ]);
  const parsed = Number(hours);
  return {
    enabled: enabled === "true",
    hours: Number.isInteger(parsed) && parsed >= 1 && parsed <= 24 ? parsed : DEFAULT_FACE_DUTY_HOURS,
  };
}

export async function staffFaceAccess(userId: number, includeDisabled = false) {
  const settings = await faceDutySettings();
  if (!settings.enabled && !includeDisabled) return { enabled: false, required: false, enrolled: false, verifiedAt: null, expiresAt: null };
  await ensureFaceTables();
  const identity = await getDb().prepare(
    "SELECT encrypted_images FROM staff_identity_registrations WHERE user_id = ? AND status = 'verified'"
  ).get(userId) as { encrypted_images: string } | undefined;
  const check = await getDb().prepare(
    `SELECT checks.verified_at, checks.enrollment_hash, resets.token AS reset_token
     FROM (SELECT ?::integer AS user_id) AS target
     LEFT JOIN staff_face_duty_checks AS checks ON checks.user_id = target.user_id
     LEFT JOIN staff_face_duty_resets AS resets ON resets.user_id = target.user_id`
  ).get(userId) as { verified_at: string | Date | null; enrollment_hash: string | null; reset_token: string | null };
  const hash = identity ? createHash("sha256").update(identity.encrypted_images).digest("hex") : null;
  const verifiedAt = check.verified_at && hash === check.enrollment_hash
    ? (check.verified_at instanceof Date ? check.verified_at.toISOString() : check.verified_at)
    : null;
  return {
    enabled: settings.enabled,
    required: settings.enabled && staffFaceCheckRequired({ enrolled: !!identity, verifiedAt, overrideUntil: null, dutyHours: settings.hours }),
    enrolled: !!identity,
    verifiedAt,
    expiresAt: verifiedAt && Number.isFinite(Date.parse(verifiedAt)) ? new Date(Date.parse(verifiedAt) + settings.hours * 3600000).toISOString() : null,
    identity: identity?.encrypted_images,
    hash,
    resetToken: check.reset_token ?? "",
  };
}

export async function resetStaffFaceCheck(userId: number) {
  await ensureFaceTables();
  await getDb().transaction(async () => {
    const account = await UserModel.byId(userId);
    await getDb().prepare(`INSERT INTO staff_face_duty_resets (user_id, token, revoked_session_id) VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, revoked_session_id = EXCLUDED.revoked_session_id`)
      .run(userId, randomUUID(), account?.session_id ?? null);
    await getDb().prepare("DELETE FROM staff_face_duty_checks WHERE user_id = ?").run(userId);
    if (account?.session_id) {
      await UserModel.recordLogout(userId);
      await UserModel.setSession(userId, null);
    }
  });
}

export async function wasSessionResetForFaceCheck(userId: number, sessionId: string) {
  await ensureFaceTables();
  const row = await getDb().prepare("SELECT 1 AS matched FROM staff_face_duty_resets WHERE user_id = ? AND revoked_session_id = ?").get(userId, sessionId);
  return Boolean(row);
}

export async function recordStaffFaceCheck(userId: number, hash: string, resetToken: string) {
  const result = await getDb().prepare(`INSERT INTO staff_face_duty_checks (user_id, verified_at, enrollment_hash)
    SELECT ?, CURRENT_TIMESTAMP, ?
    WHERE COALESCE((SELECT token FROM staff_face_duty_resets WHERE user_id = ?), '') = ?
    ON CONFLICT (user_id) DO UPDATE SET verified_at = EXCLUDED.verified_at, enrollment_hash = EXCLUDED.enrollment_hash`)
    .run(userId, hash, userId, resetToken);
  return result.changes > 0;
}
