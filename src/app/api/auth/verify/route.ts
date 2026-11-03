/**
 * GET /api/auth/verify
 * Verify the current session and return user info.
 */
import { getUser } from "@/lib/auth";

export async function GET(request: Request) {
  const area = new URL(request.url).searchParams.get("area");
  const user =
    area === "admin" || area === "staff"
      ? await getUser(request, area)
      : await getUser(request);
  if (!user) {
    return Response.json({ user: null, authenticated: false });
  }
  return Response.json({ user, authenticated: true });
}
