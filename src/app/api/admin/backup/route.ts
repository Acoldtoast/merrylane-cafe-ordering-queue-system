import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { SettingsModel } from "@/lib/models";
import { getDbPath } from "@/lib/db";
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

async function createBackup(): Promise<{ name: string; path: string; createdAt: string }> {
  ensureBackupDir();
  const dbPath = getDbPath();
  const now = new Date();
  const name = formatBackupName(now);
  const backupPath = path.join(BACKUP_DIR, name);

  // Copy entire database directory
  fs.cpSync(dbPath, backupPath, { recursive: true });

  // Record last backup time
  await SettingsModel.set("last_backup_at", now.toISOString());

  return { name, path: backupPath, createdAt: now.toISOString() };
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error || !auth.user) {
    return auth.error || Response.json(
      { error: "Administrator access is required.", success: false },
      { status: 403 }
    );
  }

  ensureBackupDir();

  // List existing backups
  const entries = fs.readdirSync(BACKUP_DIR, { withFileTypes: true });
  const backups = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("backup-"))
    .map((e) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, e.name));
      return {
        name: e.name,
        createdAt: stat.mtime.toISOString(),
        size: stat.size,
      };
    })
    .sort((a, b) => b.name.localeCompare(a.name));

  const lastBackupAt = await SettingsModel.get("last_backup_at");
  const autoBackupEnabled =
    (await SettingsModel.get("auto_backup_enabled")) !== "false";

  return Response.json({
    backups,
    last_backup_at: lastBackupAt || null,
    auto_backup_enabled: autoBackupEnabled,
    success: true,
  });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error || !auth.user) {
    return auth.error || Response.json(
      { error: "Administrator access is required.", success: false },
      { status: 403 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || "create";

    if (action === "create") {
      const backup = await createBackup();
      return Response.json({
        success: true,
        backup,
        message: "Backup created successfully.",
      });
    }

    if (action === "toggle_auto") {
      const enabled = Boolean(body.enabled);
      await SettingsModel.set("auto_backup_enabled", String(enabled));
      return Response.json({
        success: true,
        auto_backup_enabled: enabled,
      });
    }

    return Response.json(
      { error: "Unknown action.", success: false },
      { status: 400 }
    );
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not create backup.",
        success: false,
      },
      { status: 500 }
    );
  }
}
