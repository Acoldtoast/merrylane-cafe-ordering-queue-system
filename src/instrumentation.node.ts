import { startAutoBackupScheduler } from "./lib/autoBackup";
import { closeDb } from "./lib/db";
import { startEmailNotificationScheduler } from "./lib/emailScheduler";

startEmailNotificationScheduler();
startAutoBackupScheduler();

// PGlite keeps its write-ahead log and control file in the data directory.
// Exiting without closing it (task manager kill, closing the terminal window)
// can leave the checkpoint record unreadable and the database unopenable.
let closing = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void closeDb().finally(() => process.exit(0));
  });
}
