import { requireStaff } from "@/lib/auth";
import { UserModel, verifyPassword } from "@/lib/models";

/*
 * Unlock re-checks the staff password, so it is a password-guessing surface for
 * anyone holding a staff session cookie. Five wrong passwords per account are
 * allowed in ten minutes; the counter resets on success and is pruned so the
 * process-wide map cannot grow without bound.
 */
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 10 * 60_000;
const MAX_TRACKED_ACCOUNTS = 1_000;

const failures = new Map<number, { count: number; firstAt: number }>();

function blockedUntil(userId: number): number {
  const record = failures.get(userId);
  if (!record) return 0;
  if (record.count < MAX_FAILURES) return 0;
  const remaining = record.firstAt + FAILURE_WINDOW_MS - Date.now();
  if (remaining <= 0) {
    failures.delete(userId);
    return 0;
  }
  return remaining;
}

function recordFailure(userId: number) {
  const now = Date.now();
  const record = failures.get(userId);
  if (!record || now - record.firstAt >= FAILURE_WINDOW_MS) {
    if (failures.size >= MAX_TRACKED_ACCOUNTS) {
      for (const [id, entry] of failures) {
        if (now - entry.firstAt >= FAILURE_WINDOW_MS) failures.delete(id);
      }
    }
    failures.set(userId, { count: 1, firstAt: now });
    return;
  }
  record.count += 1;
}

export async function POST(request: Request) {
  const auth = await requireStaff(request);
  if (auth.error || !auth.user) {
    return auth.error || Response.json(
      { error: "Staff access is required.", success: false },
      { status: 403 }
    );
  }

  try {
    const wait = blockedUntil(auth.user.id);
    if (wait > 0) {
      return Response.json(
        {
          error: `Too many wrong passwords. Try again in ${Math.ceil(wait / 60_000)} minute(s).`,
          success: false,
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } }
      );
    }

    const body = await request.json();
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) {
      return Response.json(
        { error: "Enter your password to continue.", success: false },
        { status: 400 }
      );
    }

    const user = await UserModel.byId(auth.user.id);
    const passwordHash = await UserModel.passwordHashById(auth.user.id);
    if (
      !user ||
      user.role !== "staff" ||
      !passwordHash ||
      !verifyPassword(password, passwordHash)
    ) {
      recordFailure(auth.user.id);
      return Response.json(
        { error: "That password doesn't match your staff account.", success: false },
        { status: 401 }
      );
    }

    failures.delete(auth.user.id);
    return Response.json({ success: true });
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not unlock this staff session.",
        success: false,
      },
      { status: 500 }
    );
  }
}
