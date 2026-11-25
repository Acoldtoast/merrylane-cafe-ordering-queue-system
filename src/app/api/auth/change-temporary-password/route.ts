import { getUserAuthStatus } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { hashPassword, UserModel, verifyPassword } from "@/lib/models";

export async function POST(request: Request) {
  const user = (await getUserAuthStatus(request, "staff", true, true)).user;
  if (!user) return Response.json({ success: false, error: "Please sign in." }, { status: 401 });
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ success: false, error: "Enter a new password." }, { status: 400 });
    }
    const password = (body as Record<string, unknown>).new_password;
    if (typeof password !== "string" || password.trim().length < 6 || password.trim().length > 128) {
      return Response.json({ success: false, error: "Use a password between 6 and 128 characters." }, { status: 400 });
    }
    const account = await UserModel.byId(user.id);
    const oldHash = await UserModel.passwordHashById(user.id);
    if (!account || account.must_change_password !== 1 || !oldHash) {
      return Response.json({ success: false, error: "This password change is no longer required." }, { status: 409 });
    }
    const nextPassword = password.trim();
    if (verifyPassword(nextPassword, oldHash)) {
      return Response.json({ success: false, error: "Choose a password different from your temporary password." }, { status: 400 });
    }
    const result = await getDb().prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND session_id = ? AND password_hash = ? AND must_change_password = 1"
    ).run(hashPassword(nextPassword), user.id, account.session_id, oldHash);
    if (!result.changes) return Response.json({ success: false, error: "Your session or password changed. Sign in again." }, { status: 409 });
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, error: "Could not change your password. Please try again." }, { status: 500 });
  }
}
