import { requireAdmin } from "@/lib/auth";
import { UserModel } from "@/lib/models";
import { getDb } from "@/lib/db";
import { decryptStaffIdentityData, encryptStaffIdentityImages, ensureStaffIdentityTable, findDuplicateStaffIdentity, isUniqueViolation, keepsStaffIdentityReference, parseStaffIdentityImages, staffIdentityFingerprint, staffIdentityRevision, staffIdentityVerificationTokenFingerprint, verifyStaffIdentityVerificationToken } from "@/lib/staffIdentityRegistration";
import { logActivity } from "@/lib/activityLog";
import {
  areStaffIdDetailsPassing,
  checkStaffIdDetails,
} from "@/lib/staffIdChecks";

async function target(request: Request, params: Promise<{ id: string }>) {
  const auth = await requireAdmin(request);
  if (auth.error || !auth.user) return { error: auth.error ?? Response.json({ error: "Administrator required." }, { status: 403 }) };
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return { error: Response.json({ error: "Invalid account." }, { status: 400 }) };
  const user = await UserModel.byId(id);
  if (!user || user.role !== "staff") return { error: Response.json({ error: "Staff account not found." }, { status: 404 }) };
  await ensureStaffIdentityTable();
  return { user, admin: auth.user };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await target(request, params);
  if (result.error) return result.error;
  const review = new URL(request.url).searchParams.get("review");
  const row = await getDb().prepare("SELECT status, encrypted_images, encrypted_details, details_fingerprint FROM staff_identity_registrations WHERE user_id = ?").get(result.user.id) as { status: string; encrypted_images: string; encrypted_details: string | null; details_fingerprint: string | null } | undefined;
  if (review === "face") {
    if (!row || row.status !== "verified") return Response.json({ error: "Verified face registration not found." }, { status: 404 });
    try {
      const images = parseStaffIdentityImages(decryptStaffIdentityData(row.encrypted_images));
      if (!images) throw new Error();
      return Response.json({
        face_front: images.face_front,
        face_left: images.face_left,
        face_right: images.face_right,
      }, { headers: { "Cache-Control": "no-store, private" } });
    } catch {
      return Response.json({ error: "Could not load registered face photos." }, { status: 503 });
    }
  }
  if ((review === "1" || review === "replace") && row) {
    try {
      const images = parseStaffIdentityImages(decryptStaffIdentityData(row.encrypted_images));
      if (!images) throw new Error();
      const base = {
        registered: true, status: row.status, id_front: images.id_front, id_back: images.id_back ?? null, id_type: images.id_type ?? null,
        details: row.encrypted_details ? decryptStaffIdentityData(row.encrypted_details) : null,
        duplicate_checked: Boolean(row.details_fingerprint),
      };
      const extra = review === "replace"
        ? { face_front: images.face_front, face_left: images.face_left, face_right: images.face_right, revision: staffIdentityRevision(row.encrypted_images, row.encrypted_details) }
        : { revision: staffIdentityRevision(row.encrypted_images, row.encrypted_details) };
      return Response.json({ ...base, ...extra }, { headers: { "Cache-Control": "no-store, private" } });
    } catch { return Response.json({ error: "Could not load identity data." }, { status: 503 }); }
  }
  return Response.json({ registered: Boolean(row), status: row?.status ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await target(request, params);
  if (result.error) return result.error;
  try {
    const data: unknown = await request.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return Response.json({ error: "Invalid ID details." }, { status: 400 });
    const body = data as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["name", "number", "birth_date", "expiration_date", "details_reviewed"].includes(key)) || body.details_reviewed !== true || typeof body.name !== "string" || !body.name.trim() || body.name.length > 120 || typeof body.number !== "string" || body.number.length > 80 || typeof body.birth_date !== "string" || typeof body.expiration_date !== "string") return Response.json({ error: "Enter valid ID details and confirm that you reviewed them." }, { status: 400 });
    const existing = await getDb().prepare("SELECT encrypted_images FROM staff_identity_registrations WHERE user_id = ?").get(result.user.id) as { encrypted_images: string } | undefined;
    if (!existing) return Response.json({ error: "No identity registration found." }, { status: 404 });
    const images = parseStaffIdentityImages(decryptStaffIdentityData(existing.encrypted_images));
    if (!images) throw new Error("Invalid identity data.");
    if (!areStaffIdDetailsPassing(checkStaffIdDetails({ name: body.name, number: body.number, birth_date: body.birth_date, expiration_date: body.expiration_date }, result.user.name, images.id_type ?? ""))) return Response.json({ error: "Every ID detail check must pass, including the ID number format and a valid, current expiration date where required." }, { status: 409 });
    if (await findDuplicateStaffIdentity(result.user.id, images.id_type ?? "", body.number)) return Response.json({ error: "This ID number is already attached to another staff account. The ID details were not saved." }, { status: 409 });
    const encrypted = encryptStaffIdentityImages({ name: body.name.trim(), number: body.number.trim(), birth_date: body.birth_date, expiration_date: body.expiration_date });
    const fingerprint = staffIdentityFingerprint(images.id_type ?? "", body.number);
    const updated = await getDb().prepare("UPDATE staff_identity_registrations SET encrypted_details = ?, details_fingerprint = ? WHERE user_id = ? AND encrypted_details IS NULL").run(encrypted, fingerprint, result.user.id);
    if (!updated.changes) return Response.json({ error: "ID details are already saved or registration was not found.", success: false }, { status: 409 });
    logActivity(result.admin, { area: "Accounts", action: "account.identity_details_updated", summary: "Updated staff ID review details", entity_type: "user", entity_id: result.user.id });
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isUniqueViolation(error)) return Response.json({ error: "This ID number is already attached to another staff account. The ID details were not saved." }, { status: 409 });
    return Response.json({ error: "Could not save ID details." }, { status: 503 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return saveIdentity(request, params, false);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return saveIdentity(request, params, true);
}

async function saveIdentity(request: Request, params: Promise<{ id: string }>, replace: boolean) {
  const result = await target(request, params);
  if (result.error) return result.error;
  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0 || length > 15 * 1024 * 1024) return Response.json({ error: "Invalid request size." }, { status: 413 });
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid identity data." }, { status: 400 });
    const {
      details,
      details_reviewed: detailsReviewed,
      identity_verification_token: verificationToken,
      replacing,
      revision,
      ...imageData
    } = body as Record<string, unknown>;
    const images = parseStaffIdentityImages(imageData);
    if (!images) return Response.json({ error: "Provide a valid ID and all three face images." }, { status: 400 });
    if (!images.id_type) return Response.json({ error: "Choose an ID type before scanning and saving." }, { status: 400 });
    let existing: { encrypted_images: string; encrypted_details: string | null } | undefined;
    if (replace) {
      if ((replacing !== "face" && replacing !== "id") || typeof revision !== "string") {
        return Response.json({ error: "Choose which part of the identity to update." }, { status: 400 });
      }
      existing = await getDb().prepare(
        "SELECT encrypted_images, encrypted_details FROM staff_identity_registrations WHERE user_id = ?"
      ).get(result.user.id) as typeof existing;
      if (!existing || staffIdentityRevision(existing.encrypted_images, existing.encrypted_details) !== revision) {
        return Response.json({ error: "The registration changed. Reopen the review before updating it." }, { status: 409 });
      }
      const previous = parseStaffIdentityImages(decryptStaffIdentityData(existing.encrypted_images));
      if (!previous || !keepsStaffIdentityReference(previous, images, replacing)) {
        return Response.json({ error: "Update the ID or face separately so the existing registration can verify the replacement." }, { status: 409 });
      }
    }
    if (detailsReviewed !== true) return Response.json({ error: "Confirm that you reviewed the ID details before saving." }, { status: 400 });
    if (!details || typeof details !== "object" || Array.isArray(details)) return Response.json({ error: "Enter the ID details before saving." }, { status: 400 });
    const fields = details as Record<string, unknown>;
    if (Object.keys(fields).some((key) => !["name", "number", "birth_date", "expiration_date"].includes(key)) || typeof fields.name !== "string" || !fields.name.trim() || fields.name.length > 120 || typeof fields.number !== "string" || !fields.number.trim() || fields.number.length > 80 || typeof fields.birth_date !== "string" || typeof fields.expiration_date !== "string") return Response.json({ error: "Enter a valid name, ID number, and expiration date from the document." }, { status: 400 });
    if (!areStaffIdDetailsPassing(checkStaffIdDetails({ name: fields.name, number: fields.number, birth_date: fields.birth_date, expiration_date: fields.expiration_date }, result.user.name, images.id_type))) return Response.json({ error: "Every ID detail check must pass, including the ID number format and a valid, current expiration date where required.", success: false }, { status: 409 });
    if (await findDuplicateStaffIdentity(result.user.id, images.id_type, fields.number)) return Response.json({ error: "This ID number is already attached to another staff account. The ID was not saved.", success: false }, { status: 409 });
    if (typeof verificationToken !== "string") return Response.json({ error: "ID and face verification is missing. Scan the ID and face before saving.", success: false }, { status: 409 });
    let tokenValid = false;
    try {
      tokenValid = verifyStaffIdentityVerificationToken(verificationToken, images, result.user.name);
    } catch {
      return Response.json({ error: "Staff identity verification is not configured. Set STAFF_IDENTITY_ENCRYPTION_KEY (at least 32 characters) in the server environment.", success: false }, { status: 503 });
    }
    if (!tokenValid) return Response.json({ error: "ID and face verification is missing, expired, or no longer matches these images. Scan them again.", success: false }, { status: 409 });
    const tokenFingerprint = staffIdentityVerificationTokenFingerprint(verificationToken);
    const encrypted = encryptStaffIdentityImages(images);
    const encryptedDetails = encryptStaffIdentityImages({ name: fields.name.trim(), number: fields.number.trim(), birth_date: fields.birth_date, expiration_date: fields.expiration_date });
    const detailsFingerprint = staffIdentityFingerprint(images.id_type, fields.number);
    const inserted = await getDb().transaction(async (db) => {
      const consumedToken = await db.prepare("INSERT INTO staff_identity_verification_tokens (token_fingerprint, expires_at) VALUES (?, CURRENT_TIMESTAMP + INTERVAL '10 minutes') ON CONFLICT (token_fingerprint) DO NOTHING").run(tokenFingerprint);
      if (!consumedToken.changes) return { status: "token_used" as const };
      if (existing) {
        const registration = await db.prepare(
          `UPDATE staff_identity_registrations SET encrypted_images = ?, status = 'verified',
           encrypted_details = ?, details_fingerprint = ?
           WHERE user_id = ? AND encrypted_images = ? AND encrypted_details IS NOT DISTINCT FROM ?`
        ).run(encrypted, encryptedDetails, detailsFingerprint, result.user.id, existing.encrypted_images, existing.encrypted_details);
        return { status: registration.changes ? "updated" as const : "stale" as const };
      }
      const registration = await db.prepare("INSERT INTO staff_identity_registrations (user_id, encrypted_images, status, encrypted_details, details_fingerprint) VALUES (?, ?, 'verified', ?, ?) ON CONFLICT (user_id) DO NOTHING").run(result.user.id, encrypted, encryptedDetails, detailsFingerprint);
      return registration.changes ? { status: "created" as const } : { status: "already_registered" as const };
    });
    if (inserted.status === "token_used") return Response.json({ error: "This verification was already used. Scan the ID and face again.", success: false }, { status: 409 });
    if (inserted.status === "already_registered") return Response.json({ error: "Identity images already exist. Replacement is not available here.", success: false }, { status: 409 });
    if (inserted.status === "stale") return Response.json({ error: "The registration changed. Reopen the review before updating it.", success: false }, { status: 409 });
    logActivity(result.admin, {
      area: "Accounts",
      action: replace ? "account.identity_replaced" : "account.identity_registered",
      summary: replace ? `Updated verified staff ${replacing === "face" ? "face photos" : "ID"}` : "Registered verified staff identity images",
      entity_type: "user", entity_id: result.user.id,
    });
    return Response.json({ success: true, status: "verified" });
  } catch (error) {
    if (isUniqueViolation(error)) return Response.json({ error: "This ID number is already attached to another staff account. The ID was not saved." }, { status: 409 });
    return Response.json({ error: "Could not save identity images. Check identity storage configuration." }, { status: 503 });
  }
}
