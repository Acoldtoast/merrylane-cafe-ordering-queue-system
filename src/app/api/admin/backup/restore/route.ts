import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { SettingsModel } from "@/lib/models";
import { getDbPath } from "@/lib/db";
import fs from "node:fs";
import path from "node:path";

const BACKUP_DIR = path.join(process.cwd(), "data", "backups");

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error || !auth.user) {
    return auth.error || Response.json(
      { error: "Administrator access is required.", success: false },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const backupName = body.backup_name;
    if (typeof backupName !== "string" || !backupName.startsWith("backup-")) {
      return Response.json(
        { error: "Invalid backup name.", success: false },
        { status: 400 }
      );
    }

    const backupPath = path.join(BACKUP_DIR, backupName);
    if (!fs.existsSync(backupPath)) {
      return Response.json(
        { error: "Backup not found.", success: false },
        { status: 404 }
      );
    }

    const dbPath = getDbPath();

    // Create a safety backup of current state before restoring
    const safetyName = `pre-restore-${Date.now()}`;
    const safetyPath = path.join(BACKUP_DIR, safetyName);
    if (fs.existsSync(dbPath)) {
      fs.cpSync(dbPath, safetyPath, { recursive: true });
    }

    // Remove current database and restore from backup
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { recursive: true, force: true });
    }
    fs.cpSync(backupPath, dbPath, { recursive: true });

    await SettingsModel.set("last_backup_at", new Date().toISOString());

    return Response.json({
      success: true,
      message: "Database restored successfully. Please restart the server.",
      safety_backup: safetyName,
    });
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not restore backup.",
        success: false,
      },
      { status: 500 }
    );
  }
}
