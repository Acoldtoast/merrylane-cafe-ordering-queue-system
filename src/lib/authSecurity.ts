import { createHash, randomInt } from "node:crypto";
import { getDb, type PGliteDatabase } from "./db";
import { ActivityModel, hashPassword, verifyPassword } from "./models";

const RECOVERY_CODE_TTL_MS = 5 * 60 * 1000;
const RECOVERY_RESEND_DELAY_MS = 60 * 1000;
const MAX_RECOVERY_CODE_ATTEMPTS = 5;
const LOGIN_FAILURES_BEFORE_COOLDOWN = 5;
const LOGIN_FAILURES_PER_COOLDOWN = 2;
const COOLDOWN_MINUTES = [1, 2, 3, 5] as const;
const MAX_COOLDOWN_MINUTES = 5;
const NEXT_DAY_LOCK_KIND = "next_day";
const MANILA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DEVICE_SECURITY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const AUTH_SECURITY_TABLE = `
  CREATE TABLE IF NOT EXISTS admin_auth_security (
    user_id INTEGER PRIMARY KEY,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    cooldown_minutes INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    reset_required INTEGER NOT NULL DEFAULT 0,
    recovery_code_hash TEXT,
    recovery_code_expires_at TEXT,
    recovery_code_attempts INTEGER NOT NULL DEFAULT 0,
    recovery_code_sent_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS login_device_security (
    device_hash TEXT PRIMARY KEY,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    failed_attempts_in_stage INTEGER NOT NULL DEFAULT 0,
    cooldown_minutes INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_failed_at TEXT NOT NULL,
    lock_kind TEXT NOT NULL DEFAULT 'cooldown'
  );
  ALTER TABLE login_device_security
    ADD COLUMN IF NOT EXISTS lock_kind TEXT NOT NULL DEFAULT 'cooldown';
  ALTER TABLE login_device_security
    ADD COLUMN IF NOT EXISTS failed_attempts_in_stage INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS login_device_security_last_failed_at
    ON login_device_security(last_failed_at)
`;

interface AdminAuthSecurityRow {
  user_id: number;
  failed_attempts: number;
  cooldown_minutes: number;
  locked_until: string | null;
  reset_required: number;
  recovery_code_hash: string | null;
  recovery_code_expires_at: string | null;
  recovery_code_attempts: number;
  recovery_code_sent_at: string | null;
}

export type DeviceLoginRestriction =
  | { status: "allowed"; failedAttempts: number }
  | {
      status: "cooldown";
      failedAttempts: number;
      retryAfterSeconds: number;
      untilNextDay?: true;
    };

export type UserRecoveryCodeResult =
  | { status: "created"; code: string }
  | { status: "throttled"; retryAfterSeconds: number };

export type UserRecoveryCodeVerificationResult =
  | { status: "verified" }
  | { status: "invalid_code" };

export type UserPasswordResetResult =
  | { status: "success" }
  | { status: "invalid_code" }
  | { status: "password_unchanged" };

export interface PasswordResetOptions {
  deviceId?: string;
  now?: Date;
}

const readyByDatabase = new WeakMap<PGliteDatabase, Promise<void>>();

async function ensureTable(): Promise<void> {
  const db = getDb();
  let ready = readyByDatabase.get(db);
  if (!ready) {
    ready = db.exec(AUTH_SECURITY_TABLE).catch((error: unknown) => {
      readyByDatabase.delete(db);
      throw error;
    });
    readyByDatabase.set(db, ready);
  }
  await ready;
}

async function ensureRow(
  db: PGliteDatabase,
  userId: number
): Promise<AdminAuthSecurityRow> {
  await db
    .prepare(
      `INSERT INTO admin_auth_security (user_id)
       VALUES (?)
       ON CONFLICT (user_id) DO NOTHING`
    )
    .run(userId);
  return (await db
    .prepare(
      `SELECT * FROM admin_auth_security
       WHERE user_id = ?
       FOR UPDATE`
    )
    .get(userId)) as unknown as AdminAuthSecurityRow;
}

function getCooldown(
  row: Pick<AdminAuthSecurityRow, "failed_attempts" | "locked_until">,
  now: Date
) {
  const lockedUntil = row.locked_until
    ? new Date(row.locked_until).getTime()
    : Number.NaN;
  if (Number.isFinite(lockedUntil) && lockedUntil > now.getTime()) {
    return {
      status: "cooldown" as const,
      failedAttempts: Number(row.failed_attempts),
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((lockedUntil - now.getTime()) / 1000)
      ),
    };
  }
  return null;
}

interface DeviceAuthSecurityRow {
  device_hash: string;
  failed_attempts: number;
  failed_attempts_in_stage: number;
  cooldown_minutes: number;
  locked_until: string | null;
  last_failed_at: string;
  lock_kind: string;
}

function hashDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex");
}

export function getNextManilaMidnight(now = new Date()): Date {
  const manilaNow = new Date(now.getTime() + MANILA_UTC_OFFSET_MS);
  return new Date(
    Date.UTC(
      manilaNow.getUTCFullYear(),
      manilaNow.getUTCMonth(),
      manilaNow.getUTCDate() + 1
    ) - MANILA_UTC_OFFSET_MS
  );
}

/**
 * Returns true when the shop is past its configured closing time
 * relative to the staff member's last activity.
 *
 * - If they stopped before today's closing time, shop closes at today's closing time.
 * - If they stopped after today's closing time (late/early shift), shop is
 *   already closed.
 *
 * @param closingTime - "HH:mm" in Manila time, e.g. "00:00", "01:00", "22:00"
 */
export function isPastManilaShopClose(
  idleSince: Date,
  now: Date,
  closingTime: string = "00:00"
): boolean {
  if (
    !Number.isFinite(idleSince.getTime()) ||
    !Number.isFinite(now.getTime())
  ) {
    return false;
  }

  const [hours, minutes] = closingTime.split(":").map(Number);
  const idleSinceManila = new Date(idleSince.getTime() + MANILA_UTC_OFFSET_MS);

  // Build close boundary on idleSince's date in Manila time.
  let closeMs = Date.UTC(
    idleSinceManila.getUTCFullYear(),
    idleSinceManila.getUTCMonth(),
    idleSinceManila.getUTCDate(),
    hours,
    minutes,
    0,
    0
  );

  // "00:00" means end of day (midnight at end of operating day), not start.
  if (hours === 0 && minutes === 0) {
    closeMs += 24 * 60 * 60 * 1000;
  }

  // If they stopped after today's closing time, shop is already closed.
  if (idleSinceManila.getTime() >= closeMs) {
    return true;
  }

  // They stopped before closing: shop closes at closeMs (converted to UTC).
  return now.getTime() >= closeMs - MANILA_UTC_OFFSET_MS;
}

async function ensureDeviceRow(
  db: PGliteDatabase,
  deviceId: string,
  now: Date
): Promise<DeviceAuthSecurityRow> {
  const deviceHash = hashDeviceId(deviceId);
  await db
    .prepare(
      `INSERT INTO login_device_security (device_hash, last_failed_at)
       VALUES (?, ?)
       ON CONFLICT (device_hash) DO NOTHING`
    )
    .run(deviceHash, now.toISOString());
  return (await db
    .prepare(
      `SELECT * FROM login_device_security
       WHERE device_hash = ?
       FOR UPDATE`
    )
    .get(deviceHash)) as unknown as DeviceAuthSecurityRow;
}

async function removeExpiredDeviceRows(
  db: PGliteDatabase,
  now: Date
): Promise<void> {
  const cutoff = new Date(now.getTime() - DEVICE_SECURITY_RETENTION_MS);
  await db
    .prepare("DELETE FROM login_device_security WHERE last_failed_at < ?")
    .run(cutoff.toISOString());
}

async function resetExpiredNextDayLock(
  db: PGliteDatabase,
  row: DeviceAuthSecurityRow,
  now: Date
): Promise<DeviceAuthSecurityRow> {
  if (row.lock_kind !== NEXT_DAY_LOCK_KIND) return row;
  const lockedUntil = row.locked_until
    ? new Date(row.locked_until).getTime()
    : Number.NaN;
  if (Number.isFinite(lockedUntil) && lockedUntil > now.getTime()) return row;

  const lastFailedAt = now.toISOString();
  await db
    .prepare(
      `UPDATE login_device_security
       SET failed_attempts = 0,
           failed_attempts_in_stage = 0,
           cooldown_minutes = 0,
           locked_until = NULL,
           lock_kind = 'cooldown',
           last_failed_at = ?
       WHERE device_hash = ?`
    )
    .run(lastFailedAt, row.device_hash);
  return {
    ...row,
    failed_attempts: 0,
    failed_attempts_in_stage: 0,
    cooldown_minutes: 0,
    locked_until: null,
    lock_kind: "cooldown",
    last_failed_at: lastFailedAt,
  };
}

function getDeviceCooldown(row: DeviceAuthSecurityRow, now: Date) {
  const cooldown = getCooldown(row, now);
  if (!cooldown || row.lock_kind !== NEXT_DAY_LOCK_KIND) return cooldown;
  return { ...cooldown, untilNextDay: true as const };
}

async function logSecurityEvent(
  userId: number,
  action: string,
  summary: string
): Promise<void> {
  await ActivityModel.log(
    { id: userId, name: "Merrylane Security", role: "system" },
    {
      area: "Access",
      action,
      summary,
      entity_type: "user",
      entity_id: userId,
    }
  );
}

async function logDeviceCooldown(
  failedAttempts: number,
  cooldownMinutes: number | typeof NEXT_DAY_LOCK_KIND
): Promise<void> {
  const cooldownDescription =
    cooldownMinutes === NEXT_DAY_LOCK_KIND
      ? "until the next Manila calendar day"
      : `for ${cooldownMinutes} minutes`;
  await ActivityModel.log(null, {
    area: "Access",
    action: "auth.login_cooldown",
    summary: `Repeated sign-in failures from one device reached ${failedAttempts}; sign-in blocked ${cooldownDescription}.`,
    entity_type: "login_device",
  });
}

export async function getDeviceLoginRestriction(
  deviceId: string,
  now = new Date()
): Promise<DeviceLoginRestriction> {
  await ensureTable();
  const db = getDb();
  await removeExpiredDeviceRows(db, now);
  return db.transaction(async (transaction) => {
    const storedRow = await ensureDeviceRow(transaction, deviceId, now);
    const row = await resetExpiredNextDayLock(transaction, storedRow, now);
    const cooldown = getDeviceCooldown(row, now);
    if (cooldown) return cooldown;
    return { status: "allowed" as const, failedAttempts: Number(row.failed_attempts) };
  });
}

export async function recordDeviceLoginFailure(
  deviceId: string,
  now = new Date()
): Promise<DeviceLoginRestriction> {
  await ensureTable();
  const db = getDb();
  await removeExpiredDeviceRows(db, now);
  let cooldownStarted: number | typeof NEXT_DAY_LOCK_KIND | null = null;
  const result = await db.transaction(async (transaction) => {
    const storedRow = await ensureDeviceRow(transaction, deviceId, now);
    const row = await resetExpiredNextDayLock(transaction, storedRow, now);
    const failedAttempts = Number(row.failed_attempts);
    const failedAttemptsInStage = Number(row.failed_attempts_in_stage);
    const currentCooldown = Number(row.cooldown_minutes);
    const cooldown = getDeviceCooldown(row, now);
    if (cooldown) return cooldown;

    const nextFailedAttempts = failedAttempts + 1;
    const isInitialStreak = currentCooldown === 0;
    const shouldAllowFailure = isInitialStreak
      ? nextFailedAttempts < LOGIN_FAILURES_BEFORE_COOLDOWN
      : failedAttemptsInStage + 1 < LOGIN_FAILURES_PER_COOLDOWN;
    if (shouldAllowFailure) {
      await transaction
        .prepare(
          `UPDATE login_device_security
           SET failed_attempts = ?, failed_attempts_in_stage = ?,
               last_failed_at = ?
           WHERE device_hash = ?`
        )
        .run(
          nextFailedAttempts,
          isInitialStreak ? 0 : failedAttemptsInStage + 1,
          now.toISOString(),
          row.device_hash
        );
      return { status: "allowed" as const, failedAttempts: nextFailedAttempts };
    }

    if (currentCooldown >= MAX_COOLDOWN_MINUTES) {
      const lockedUntil = getNextManilaMidnight(now);
      cooldownStarted = NEXT_DAY_LOCK_KIND;
      await transaction
        .prepare(
          `UPDATE login_device_security
           SET failed_attempts = ?, cooldown_minutes = ?,
               failed_attempts_in_stage = 0, locked_until = ?,
               lock_kind = ?, last_failed_at = ?
           WHERE device_hash = ?`
        )
        .run(
          nextFailedAttempts,
          MAX_COOLDOWN_MINUTES,
          lockedUntil.toISOString(),
          NEXT_DAY_LOCK_KIND,
          now.toISOString(),
          row.device_hash
        );
      return {
        status: "cooldown" as const,
        failedAttempts: nextFailedAttempts,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000)
        ),
        untilNextDay: true as const,
      };
    }

    const nextCooldown = COOLDOWN_MINUTES.find(
      (minutes) => minutes > currentCooldown
    );
    cooldownStarted = nextCooldown ?? MAX_COOLDOWN_MINUTES;
    const lockedUntil = new Date(
      now.getTime() + cooldownStarted * 60 * 1000
    ).toISOString();
    await transaction
      .prepare(
        `UPDATE login_device_security
         SET failed_attempts = ?, cooldown_minutes = ?, locked_until = ?,
             failed_attempts_in_stage = 0,
             lock_kind = 'cooldown', last_failed_at = ?
         WHERE device_hash = ?`
      )
      .run(
        nextFailedAttempts,
        cooldownStarted,
        lockedUntil,
        now.toISOString(),
        row.device_hash
      );
    return {
      status: "cooldown" as const,
      failedAttempts: nextFailedAttempts,
      retryAfterSeconds: cooldownStarted * 60,
    };
  });

  if (cooldownStarted !== null) {
    await logDeviceCooldown(result.failedAttempts, cooldownStarted);
  }
  return result;
}

export async function clearDeviceLoginFailures(deviceId: string): Promise<void> {
  await ensureTable();
  await getDb()
    .prepare("DELETE FROM login_device_security WHERE device_hash = ?")
    .run(hashDeviceId(deviceId));
}

export async function clearUserAuthSecurity(userId: number): Promise<void> {
  await ensureTable();
  await getDb()
    .prepare(
      `UPDATE admin_auth_security
       SET failed_attempts = 0,
           cooldown_minutes = 0,
           locked_until = NULL,
           reset_required = 0,
           recovery_code_hash = NULL,
           recovery_code_expires_at = NULL,
           recovery_code_attempts = 0,
           recovery_code_sent_at = NULL
       WHERE user_id = ?`
    )
    .run(userId);
}

export async function createUserRecoveryCode(
  userId: number,
  now = new Date()
): Promise<UserRecoveryCodeResult> {
  await ensureTable();
  const db = getDb();
  return db.transaction(async (transaction) => {
    const row = await ensureRow(transaction, userId);
    const lastSentAt = row.recovery_code_sent_at
      ? new Date(row.recovery_code_sent_at).getTime()
      : Number.NaN;
    if (
      Number.isFinite(lastSentAt) &&
      now.getTime() - lastSentAt < RECOVERY_RESEND_DELAY_MS
    ) {
      return {
        status: "throttled",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (lastSentAt + RECOVERY_RESEND_DELAY_MS - now.getTime()) / 1000
          )
        ),
      };
    }

    const code = String(randomInt(100000, 1000000));
    await transaction
      .prepare(
        `UPDATE admin_auth_security
         SET recovery_code_hash = ?,
             recovery_code_expires_at = ?,
             recovery_code_attempts = 0,
             recovery_code_sent_at = ?
         WHERE user_id = ?`
      )
      .run(
        hashPassword(code),
        new Date(now.getTime() + RECOVERY_CODE_TTL_MS).toISOString(),
        now.toISOString(),
        userId
      );
    return { status: "created", code };
  });
}

export async function markUserRecoveryCodeSent(
  userId: number,
  sentAt = new Date()
): Promise<void> {
  await ensureTable();
  await getDb()
    .prepare(
      `UPDATE admin_auth_security
       SET recovery_code_sent_at = ?
       WHERE user_id = ? AND recovery_code_hash IS NOT NULL`
    )
    .run(sentAt.toISOString(), userId);
}

export async function invalidateUserRecoveryCode(
  userId: number
): Promise<void> {
  await ensureTable();
  await getDb()
    .prepare(
      `UPDATE admin_auth_security
       SET recovery_code_hash = NULL,
           recovery_code_expires_at = NULL,
       recovery_code_attempts = 0,
       recovery_code_sent_at = NULL
       WHERE user_id = ?`
    )
    .run(userId);
}

type RecoveryCodeVerification =
  | { status: "verified"; user: { password_hash: string } }
  | { status: "invalid_code" };

async function verifyRecoveryCode(
  transaction: PGliteDatabase,
  userId: number,
  code: string,
  now: Date
): Promise<RecoveryCodeVerification> {
  const row = await ensureRow(transaction, userId);
  const user = (await transaction
    .prepare(
      `SELECT password_hash, role, is_active
       FROM users
       WHERE id = ?
       FOR UPDATE`
    )
    .get(userId)) as
    | { password_hash: string; role: string; is_active: number }
    | undefined;

  if (
    !user ||
    (user.role !== "admin" && user.role !== "staff") ||
    user.is_active === 0 ||
    !row.recovery_code_hash ||
    !row.recovery_code_expires_at ||
    new Date(row.recovery_code_expires_at).getTime() <= now.getTime() ||
    Number(row.recovery_code_attempts) >= MAX_RECOVERY_CODE_ATTEMPTS
  ) {
    return { status: "invalid_code" };
  }

  if (!verifyPassword(code, row.recovery_code_hash)) {
    const attempts = Number(row.recovery_code_attempts) + 1;
    await transaction
      .prepare(
        `UPDATE admin_auth_security
         SET recovery_code_attempts = ?,
             recovery_code_hash = CASE WHEN ? >= ? THEN NULL ELSE recovery_code_hash END,
             recovery_code_expires_at = CASE WHEN ? >= ? THEN NULL ELSE recovery_code_expires_at END
         WHERE user_id = ?`
      )
      .run(
        attempts,
        attempts,
        MAX_RECOVERY_CODE_ATTEMPTS,
        attempts,
        MAX_RECOVERY_CODE_ATTEMPTS,
        userId
      );
    return { status: "invalid_code" };
  }

  return { status: "verified", user };
}

export async function verifyUserRecoveryCode(
  userId: number,
  code: string,
  now = new Date()
): Promise<UserRecoveryCodeVerificationResult> {
  await ensureTable();
  return getDb().transaction(async (transaction) => {
    const result = await verifyRecoveryCode(transaction, userId, code, now);
    return { status: result.status };
  });
}

export async function resetUserPasswordWithCode(
  userId: number,
  code: string,
  newPassword: string,
  options: PasswordResetOptions = {}
): Promise<UserPasswordResetResult> {
  const now = options.now ?? new Date();
  await ensureTable();
  const db = getDb();
  const result = await db.transaction(async (transaction) => {
    const verification = await verifyRecoveryCode(
      transaction,
      userId,
      code,
      now
    );
    if (verification.status === "invalid_code") return verification;
    const user = verification.user;

    if (verifyPassword(newPassword, user.password_hash)) {
      return { status: "password_unchanged" as const };
    }

    await transaction
      .prepare(
        `UPDATE users
         SET password_hash = ?, session_id = NULL
         WHERE id = ?`
      )
      .run(hashPassword(newPassword), userId);
    await transaction
      .prepare(
        `UPDATE admin_auth_security
         SET failed_attempts = 0,
             cooldown_minutes = 0,
             locked_until = NULL,
             reset_required = 0,
             recovery_code_hash = NULL,
             recovery_code_expires_at = NULL,
             recovery_code_attempts = 0,
             recovery_code_sent_at = NULL
         WHERE user_id = ?`
      )
      .run(userId);
    if (options.deviceId) {
      await transaction
        .prepare("DELETE FROM login_device_security WHERE device_hash = ?")
        .run(hashDeviceId(options.deviceId));
    }
    return { status: "success" as const };
  });

  if (result.status === "success") {
    await logSecurityEvent(
      userId,
      "auth.password_recovered",
      "Account password reset through email verification."
    );
  }
  return result;
}
