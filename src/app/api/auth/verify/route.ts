/**
 * GET /api/auth/verify
 * Verify the current session and return user info.
 */
import {
  getAdminIdleTimeoutMinutes,
  getStaffIdleTimeoutMinutes,
  getUserAuthStatus,
} from "@/lib/auth";

export async function GET(request: Request) {
  try {
    return await verify(request);
  } catch (error) {
    console.warn("Session verification is unavailable.", error);
    return Response.json(
      { error: "Session verification is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

async function verify(request: Request) {
  const area = new URL(request.url).searchParams.get("area");
  const status = await getUserAuthStatus(
    request,
    area === "admin" || area === "staff" ? area : undefined
  );
  const { user } = status;
  // username is already included in the user object from byId
  if (!user) {
    return Response.json(
      {
        user: null,
        authenticated: false,
        reason: status.reason,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
  const idleTimeoutMinutes =
    user.role === "admin"
      ? await getAdminIdleTimeoutMinutes()
      : await getStaffIdleTimeoutMinutes();
  return Response.json(
    {
      user,
      authenticated: true,
      idle_timeout_minutes: idleTimeoutMinutes,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
