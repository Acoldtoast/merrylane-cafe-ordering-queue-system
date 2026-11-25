import { SettingsModel } from "@/lib/models";
import { getDbPath, isUsingSupabaseDatabase } from "@/lib/db";
import fs from "node:fs";
import path from "node:path";

const BACKUP_DIR = path.join(process.cwd(), "data", "backups");

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function formatBackupName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function manilaDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
}

async function createAutoBackup(): Promise<void> {
  if (isUsingSupabaseDatabase()) return;

  try {
    const autoEnabled = await SettingsModel.get("auto_backup_enabled");
    if (autoEnabled === "false") return;

    ensureBackupDir();
    const dbPath = getDbPath();
    const now = new Date();
    const name = formatBackupName(now);
    const backupPath = path.join(BACKUP_DIR, name);

    if (fs.existsSync(dbPath)) {
      // shortcut: a plain file copy of the live PGlite directory is only safe
      // while idle, which is why this runs at startup and at midnight. Switch
      // to PGlite's dumpDataDir() if backups must run under load.
      fs.cpSync(dbPath, backupPath, { recursive: true });
      await SettingsModel.set("last_backup_at", now.toISOString());
      pruneOldBackups();
      console.log(`[AutoBackup] Created backup: ${name}`);
    }
  } catch (error) {
    console.error("[AutoBackup] Failed to create backup:", error);
  }
}

const KEEP_BACKUPS = 14;

function pruneOldBackups(): void {
  const backups = fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => /^backup-\d{8}-\d{6}$/.test(name))
    .sort()
    .reverse();
  for (const name of backups.slice(KEEP_BACKUPS)) {
    fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true });
    console.log(`[AutoBackup] Pruned old backup: ${name}`);
  }
}

let lastCheckedDate = "";

async function checkAndBackup(): Promise<void> {
  try {
    const autoEnabled = await SettingsModel.get("auto_backup_enabled");
    if (autoEnabled === "false") return;

    const now = new Date();
    const todayKey = manilaDateKey(now);
    const lastBackupAt = await SettingsModel.get("last_backup_at");

    // Check if last backup was before today
    let needsBackup = false;
    if (!lastBackupAt) {
      needsBackup = true;
    } else {
      const lastBackupDate = manilaDateKey(new Date(lastBackupAt));
      if (lastBackupDate < todayKey) {
        needsBackup = true;
      }
    }

    // Also check if it's midnight (00:00-00:01 Manila time)
    const manilaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const isMidnight = manilaNow.getUTCHours() === 0 && manilaNow.getUTCMinutes() === 0;

    if (needsBackup || isMidnight) {
      if (lastCheckedDate !== todayKey || isMidnight) {
        lastCheckedDate = todayKey;
        await createAutoBackup();
      }
    }
  } catch (error) {
    console.error("[AutoBackup] Check failed:", error);
  }
}

let timerStarted = false;

export function startAutoBackupScheduler(): void {
  if (isUsingSupabaseDatabase()) return;
  if (timerStarted) return;
  timerStarted = true;

  // Check immediately on startup
  void checkAndBackup();

  // Check every minute
  setInterval(() => {
    void checkAndBackup();
  }, 60_000);

  console.log("[AutoBackup] Scheduler started");
}
