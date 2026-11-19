import { requireAdmin } from "@/lib/auth";
import { ensureStaffIdentityTable, findDuplicateStaffIdentity } from "@/lib/staffIdentityRegistration";

/**
 * Pre-save duplicate check for the ID review screens. The number is never
 * stored here; only its keyed fingerprint is compared with saved identities.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  try {
    const data: unknown = await request.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return Response.json({ error: "Invalid duplicate check." }, { status: 400 });
    }
    const body = data as Record<string, unknown>;
    if (typeof body.id_type !== "string" || typeof body.number !== "string" || body.number.length > 80) {
      return Response.json({ error: "Invalid duplicate check." }, { status: 400 });
    }
    await ensureStaffIdentityTable();
    const duplicate = await findDuplicateStaffIdentity(null, body.id_type, body.number);
    return Response.json({ duplicate }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "The duplicate ID check is unavailable. Check identity storage configuration." },
      { status: 503 }
    );
  }
}
