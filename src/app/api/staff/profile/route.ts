import { requireStaff } from "@/lib/auth";
import { UserModel, verifyPassword } from "@/lib/models";
import { logActivity } from "@/lib/activityLog";
import { randomUUID } from "node:crypto";
import { decryptStaffIdentityData, ensureStaffIdentityTable, parseStaffIdentityImages } from "@/lib/staffIdentityRegistration";
import { getDb } from "@/lib/db";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: Request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  if (!auth.user || auth.user.role !== "staff") return Response.json({ error: "Staff access required." }, { status: 403 });
  const user = await UserModel.byId(auth.user.id);
  if (!user) return Response.json({ error: "Account not found." }, { status: 404 });
  try {
    await ensureStaffIdentityTable();
    const registration = await getDb()
      .prepare("SELECT status, encrypted_images, encrypted_details FROM staff_identity_registrations WHERE user_id = ?")
      .get(user.id) as { status: string; encrypted_images: string; encrypted_details: string | null } | undefined;
    let identity: {
      status: string;
      id_type: string | null;
      id_front: string;
      id_back: string | null;
      details: { name: string; number: string; birth_date: string; expiration_date: string } | null;
    } | null = null;
    if (registration) {
      const images = parseStaffIdentityImages(decryptStaffIdentityData(registration.encrypted_images));
      if (!images) throw new Error("Invalid saved ID images.");
      const decryptedDetails = registration.encrypted_details
        ? decryptStaffIdentityData(registration.encrypted_details)
        : null;
      let details: {
        name: string;
        number: string;
        birth_date: string;
        expiration_date: string;
      } | null = null;
      if (decryptedDetails !== null) {
        if (
          !isRecord(decryptedDetails) ||
          typeof decryptedDetails.name !== "string" ||
          typeof decryptedDetails.number !== "string" ||
          typeof decryptedDetails.birth_date !== "string" ||
          (decryptedDetails.expiration_date !== undefined &&
            typeof decryptedDetails.expiration_date !== "string")
        ) {
          throw new Error("Invalid saved ID details.");
        }
        details = {
          name: decryptedDetails.name,
          number: decryptedDetails.number,
          birth_date: decryptedDetails.birth_date,
          expiration_date:
            typeof decryptedDetails.expiration_date === "string"
              ? decryptedDetails.expiration_date
              : "",
        };
      }
      identity = {
        status: registration.status,
        id_type: images.id_type ?? null,
        id_front: images.id_front,
        id_back: images.id_back ?? null,
        details,
      };
    }
    return Response.json({
      user: {
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        is_active: user.is_active,
        created_at: user.created_at,
        contact_number: user.contact_number,
        address: user.address,
        duty_hours: user.duty_hours,
      },
      identity,
      success: true,
    }, { headers: { "Cache-Control": "no-store, private" } });
  } catch {
    return Response.json({ error: "Could not load your saved ID details." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireStaff(request);
  if (auth.error) return auth.error;
  if (!auth.user || auth.user.role !== "staff") return Response.json({ error: "Staff access required." }, { status: 403 });
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid account details." }, { status: 400 });
    const data = body as Record<string, unknown>;
    if (Object.keys(data).some((key) => !["email", "contact_number", "address", "current_password", "new_password"].includes(key))) return Response.json({ error: "Unsupported account change." }, { status: 400 });
    const email = data.email === undefined
      ? undefined
      : typeof data.email === "string"
        ? data.email.trim().toLowerCase()
        : "";
    if (
      (data.contact_number !== undefined && data.contact_number !== null && typeof data.contact_number !== "string") ||
      (data.address !== undefined && data.address !== null && typeof data.address !== "string")
    ) return Response.json({ error: "Enter a valid contact number and address." }, { status: 400 });
    const contactNumber = data.contact_number === undefined
      ? undefined
      : typeof data.contact_number === "string"
        ? data.contact_number.trim()
        : null;
    const address = data.address === undefined
      ? undefined
      : typeof data.address === "string"
        ? data.address.trim()
        : null;
    const changingPassword = data.new_password !== undefined;
    const changingProfile = email !== undefined || data.contact_number !== undefined || data.address !== undefined;
    if (data.email !== undefined && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return Response.json({ error: "Enter a valid recovery email." }, { status: 400 });
    if (
      (contactNumber !== undefined && contactNumber !== null && contactNumber.length > 30) ||
      (address !== undefined && address !== null && address.length > 500)
    ) return Response.json({ error: "Enter a valid contact number and address." }, { status: 400 });
    if (!changingProfile && !changingPassword) return Response.json({ error: "Choose a change to save." }, { status: 400 });
    const hash = await UserModel.passwordHashById(auth.user.id);
    if (typeof data.current_password !== "string" || !hash || !verifyPassword(data.current_password, hash)) return Response.json({ error: "Your current password is incorrect." }, { status: 401 });
    if (changingPassword && (typeof data.new_password !== "string" || data.new_password.trim().length < 6 || data.new_password.trim().length > 128)) return Response.json({ error: "Use a password between 6 and 128 characters." }, { status: 400 });
    if (email !== undefined) {
      const existing = await UserModel.byEmail(email);
      if (existing && existing.id !== auth.user.id) return Response.json({ error: "An account with that email already exists." }, { status: 409 });
    }
    if (changingProfile) {
      await UserModel.update(auth.user.id, {
        ...(email !== undefined ? { email } : {}),
        ...(contactNumber !== undefined ? { contact_number: contactNumber || null } : {}),
        ...(address !== undefined ? { address: address || null } : {}),
      });
    }
    if (changingPassword) {
      await UserModel.resetPassword(auth.user.id, (data.new_password as string).trim());
      await UserModel.setSession(auth.user.id, randomUUID());
    }
    logActivity(auth.user, { area: "Accounts", action: "account.settings_updated", summary: "Updated staff account settings", entity_type: "user", entity_id: auth.user.id });
    const updatedUser = await UserModel.byId(auth.user.id);
    if (!updatedUser) return Response.json({ error: "Account not found." }, { status: 404 });
    return Response.json({
      success: true,
      user: {
        email: updatedUser.email,
        contact_number: updatedUser.contact_number ?? null,
        address: updatedUser.address ?? null,
      },
      sign_in_again: changingPassword,
    });
  } catch {
    return Response.json({ error: "Could not save your profile." }, { status: 500 });
  }
}
