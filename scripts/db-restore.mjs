// Restores the PGlite data directory from a backup in data/backups.
// Usage: npm run db:restore            (newest backup)
//        npm run db:restore backup-20261123-012550
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const PORT = 3112;
const root = process.cwd();
const dataDir = path.join(root, "data");
const dbDir = path.join(dataDir, "merrylane-pglite");
const backupDir = path.join(dataDir, "backups");

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.setTimeout(1500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const backups = fs.existsSync(backupDir)
  ? fs
      .readdirSync(backupDir)
      .filter((name) => /^backup-\d{8}-\d{6}$/.test(name))
      .sort()
      .reverse()
  : [];

if (backups.length === 0) {
  console.error("No automatic backups found in data/backups. Nothing to restore.");
  process.exit(1);
}

const chosen = process.argv[2] ?? backups[0];
if (!backups.includes(chosen)) {
  console.error(`Unknown backup "${chosen}". Available:\n  ${backups.join("\n  ")}`);
  process.exit(1);
}

if (await portInUse(PORT)) {
  console.error(
    `The app is still running on port ${PORT}. Stop it first (Ctrl+C in its terminal), then run this again.`
  );
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const brokenDir = `${dbDir}.broken-${stamp}`;

console.log(`Restoring ${chosen} ...`);
if (fs.existsSync(dbDir)) fs.renameSync(dbDir, brokenDir);
fs.cpSync(path.join(backupDir, chosen), dbDir, { recursive: true });
fs.rmSync(path.join(dbDir, "postmaster.pid"), { force: true });

try {
  const db = new PGlite(dbDir);
  await db.waitReady;
  const result = await db.query(
    "select count(*)::int as n, max(created_at) as last from orders"
  );
  await db.close();
  fs.rmSync(path.join(dbDir, "postmaster.pid"), { force: true });
  console.log(
    `OK: ${result.rows[0].n} orders, last one ${result.rows[0].last}.`
  );
  console.log(`Previous data directory kept at ${path.relative(root, brokenDir)}`);
  console.log("Start the app with: npm run dev");
} catch (error) {
  console.error("The backup could not be opened:", error?.message ?? error);
  fs.rmSync(dbDir, { recursive: true, force: true });
  if (fs.existsSync(brokenDir)) fs.renameSync(brokenDir, dbDir);
  console.error("Your previous data directory was put back. Nothing changed.");
  process.exit(1);
}
