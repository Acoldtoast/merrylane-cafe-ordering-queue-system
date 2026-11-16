import { requireAdmin } from "@/lib/auth";
import {
  ensureEmailOutbox,
  listEmailDeliveries,
  retryFailedEmail,
} from "@/lib/emailOutbox";

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const rawBefore = url.searchParams.get("before");
  const limit = rawLimit === null ? DEFAULT_PAGE_SIZE : Number(rawLimit);
  const before = rawBefore === null ? undefined : Number(rawBefore);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_SIZE ||
    (before !== undefined && (!Number.isSafeInteger(before) || before < 1))
  ) {
    return Response.json(
      { error: "The email delivery page is invalid.", success: false },
      { status: 400 }
    );
  }

  try {
    await ensureEmailOutbox();
    const page = await listEmailDeliveries(before, limit);
    return Response.json(
      { ...page, success: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    console.error("Could not load the email delivery log.", error);
    return Response.json(
      { error: "Could not load the email delivery log.", success: false },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "The retry request is invalid.", success: false },
      { status: 400 }
    );
  }

  if (
    !isRecord(body) ||
    Object.keys(body).some((key) => key !== "action" && key !== "id") ||
    body.action !== "retry" ||
    typeof body.id !== "number" ||
    !Number.isSafeInteger(body.id) ||
    body.id < 1
  ) {
    return Response.json(
      { error: "Choose a failed email to retry.", success: false },
      { status: 400 }
    );
  }

  try {
    await ensureEmailOutbox();
    const queued = await retryFailedEmail(body.id);
    if (!queued) {
      return Response.json(
        { error: "This email is no longer marked as failed.", success: false },
        { status: 409 }
      );
    }

    return Response.json({ success: true });
  } catch (error: unknown) {
    console.error("Could not queue a failed email for retry.", error);
    return Response.json(
      { error: "Could not queue the email for retry.", success: false },
      { status: 500 }
    );
  }
}
