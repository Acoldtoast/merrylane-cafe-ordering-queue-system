import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { UserModel } from "@/lib/models";
import { resetStaffFaceCheck, staffFaceAccess } from "@/lib/staffFaceAccess";

async function target(request: Request, params: Promise<{ id: string }>) {
  const auth = await requireAdmin(request);
  if (auth.error || !auth.user) return { error: auth.error ?? Response.json({ error: "Administrator required." }, { status: 403 }) };
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return { error: Response.json({ error: "Invalid account." }, { status: 400 }) };
  const user = await UserModel.byId(id);
  if (!user || user.role !== "staff") return { error: Response.json({ error: "Staff account not found." }, { status: 404 }) };
  return { user, admin: auth.user };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await target(request, params);
  if (result.error) return result.error;
  const { enabled, required, enrolled, verifiedAt, expiresAt } = await staffFaceAccess(result.user.id, true);
  return Response.json({ enabled, required, enrolled, verified_at: verifiedAt, expires_at: expiresAt }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await target(request, params);
  if (result.error) return result.error;
  await resetStaffFaceCheck(result.user.id);
  logActivity(result.admin, { area: "Accounts", action: "account.face_check_reset", summary: "Required staff face verification again", entity_type: "user", entity_id: result.user.id });
  return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
