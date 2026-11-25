import { UserModel, verifyPassword } from "@/lib/models";
import { randomInt } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { usernameForAccount } from "@/lib/usernames";
import { validDutyHours } from "@/lib/dutyHoursValidation";
import {
  areStaffIdDetailsPassing,
  checkStaffIdDetails,
} from "@/lib/staffIdChecks";
import { getDb } from "@/lib/db";
import { encryptStaffIdentityImages, ensureStaffIdentityTable, findDuplicateStaffIdentity, isUniqueViolation, parseStaffIdentityImages, staffIdentityFingerprint, staffIdentityVerificationTokenFingerprint, verifyStaffIdentityVerificationToken } from "@/lib/staffIdentityRegistration";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 3 && value.trim().length <= 500;
}

function validUsername(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 80 &&
    !/[\s@]/.test(value.trim())
  );
}

function validEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  );
}

async function hasAdminPassword(authUserId: number, value: unknown): Promise<boolean> {
  if (typeof value !== "string" || !value) return false;
  const passwordHash = await UserModel.passwordHashById(authUserId);
  return Boolean(passwordHash && verifyPassword(value, passwordHash));
}

function validProfileFields(body: Record<string, unknown>): boolean {
  return (
    (body.contact_number === undefined ||
      (typeof body.contact_number === "string" && body.contact_number.length <= 40)) &&
    (body.address === undefined ||
      (typeof body.address === "string" && body.address.length <= 500)) &&
    (body.duty_hours === undefined ||
      (typeof body.duty_hours === "string" && body.duty_hours.length <= 120))
  );
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const role = new URL(request.url).searchParams.get("role");
    const users = await UserModel.all();
    return Response.json({
      users: role === "staff"
        ? users.filter((user) => user.role === "staff")
        : users,
      success: true,
    });
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to load accounts.",
        success: false,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const rawBody: unknown = await request.json();
    if (!isRecord(rawBody)) {
      return Response.json(
        { error: "Account details must be sent as an object.", success: false },
        { status: 400 }
      );
    }
    const body = rawBody;
    const { name, email, role } = body;
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const password = role === "staff"
      ? Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("")
      : body.password;
    if (!validProfileFields(body)) {
      return Response.json(
        { error: "Contact number, address, or duty hours exceed the allowed length.", success: false },
        { status: 400 }
      );
    }
    if (!validDutyHours(body.duty_hours)) return Response.json({ error: "Duty end time must be later than the start time on the same day.", success: false }, { status: 400 });
    const emailValue = typeof email === "string" ? email.trim() : "";
    if (
      typeof name !== "string" ||
      typeof role !== "string" ||
      typeof password !== "string" ||
      !name.trim() ||
      !password.trim()
    ) {
      return Response.json(
        { error: "Name, role and password are required.", success: false },
        { status: 400 }
      );
    }
    if ((role === "staff" && !emailValue) || (emailValue && !validEmail(emailValue))) {
      return Response.json(
        { error: "Enter a valid recovery email address for staff.", success: false },
        { status: 400 }
      );
    }
    if (role === "staff" && (typeof body.contact_number !== "string" || !body.contact_number.trim())) {
      return Response.json({ error: "Enter the staff member’s contact number.", success: false }, { status: 400 });
    }
    if (role === "staff" && (typeof body.duty_hours !== "string" || !body.duty_hours.trim())) {
      return Response.json({ error: "Choose both a start time and an end time.", success: false }, { status: 400 });
    }
    if (password.trim().length < 6 || password.length > 128) {
      return Response.json(
        { error: "Use a password with at least 6 characters and no more than 128 characters.", success: false },
        { status: 400 }
      );
    }
    if (role !== "admin" && role !== "staff") {
      return Response.json(
        { error: "Choose a valid account role.", success: false },
        { status: 400 }
      );
    }
    let encryptedIdentity: string | undefined;
    let encryptedIdentityDetails: string | null = null;
    let identityFingerprint: string | null = null;
    let identityVerificationTokenFingerprint: string | null = null;
    if (role === "staff") {
      const images = parseStaffIdentityImages(body.identity);
      if (!images) return Response.json({ error: "Provide valid ID and front, left and right face images (JPEG or PNG, up to 2 MB each).", success: false }, { status: 400 });
      await ensureStaffIdentityTable();
      const detail = body.identity_details;
      if (body.identity_details_reviewed !== true) return Response.json({ error: "Confirm that you reviewed the ID type and details before creating the account.", success: false }, { status: 400 });
      if (!isRecord(detail) || Object.keys(detail).some((key) => !["name", "number", "birth_date", "expiration_date"].includes(key)) || typeof detail.name !== "string" || !detail.name.trim() || detail.name.length > 120 || typeof detail.number !== "string" || !detail.number.trim() || detail.number.length > 80 || typeof detail.birth_date !== "string" || typeof detail.expiration_date !== "string") return Response.json({ error: "Review and enter the name, ID number, and expiration date from the document before creating the account.", success: false }, { status: 400 });
      if (!areStaffIdDetailsPassing(checkStaffIdDetails({ name: detail.name, number: detail.number, birth_date: detail.birth_date, expiration_date: detail.expiration_date }, name.trim(), images.id_type ?? ""))) return Response.json({ error: "Every ID detail check must pass, including the ID number format and a valid, current expiration date where required.", success: false }, { status: 409 });
      if (await findDuplicateStaffIdentity(null, images.id_type ?? "", detail.number)) return Response.json({ error: "This ID number is already attached to another staff account. The account was not created.", success: false }, { status: 409 });
      let verificationTokenValid = false;
      const verificationToken = body.identity_verification_token;
      if (typeof verificationToken !== "string") return Response.json({ error: "ID and face verification is missing. Scan the ID and face before creating this account.", success: false }, { status: 409 });
      try {
        verificationTokenValid = verifyStaffIdentityVerificationToken(
          verificationToken,
          images,
          name.trim()
        );
      } catch {
        return Response.json({ error: "Staff identity verification is not configured. Set STAFF_IDENTITY_ENCRYPTION_KEY (at least 32 characters) in the server environment.", success: false }, { status: 503 });
      }
      if (!verificationTokenValid) return Response.json({ error: "ID and face verification is missing, expired, or no longer matches these images. Scan the ID and face again.", success: false }, { status: 409 });
      identityVerificationTokenFingerprint = staffIdentityVerificationTokenFingerprint(verificationToken);
      try {
        encryptedIdentity = encryptStaffIdentityImages(images);
        encryptedIdentityDetails = encryptStaffIdentityImages({ name: detail.name.trim(), number: detail.number.trim(), birth_date: detail.birth_date, expiration_date: detail.expiration_date });
        identityFingerprint = staffIdentityFingerprint(images.id_type ?? "", detail.number);
      } catch {
        return Response.json({ error: "Staff identity storage is not configured. Set STAFF_IDENTITY_ENCRYPTION_KEY (at least 32 characters) in the server environment, then restart the app.", success: false }, { status: 503 });
      }
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (role === "admin") {
      if (!validReason(reason)) {
        return Response.json(
          { error: "Add a reason before creating an administrator account.", success: false },
          { status: 400 }
        );
      }
      if (!(await hasAdminPassword(auth.user!.id, body.confirmation_password))) {
        return Response.json(
          { error: "The administrator password is incorrect.", success: false },
          { status: 401 }
        );
      }
    }
    if (emailValue && (await UserModel.byEmail(emailValue))) {
      return Response.json(
        { error: "An account with that email already exists.", success: false },
        { status: 409 }
      );
    }

    const username = usernameForAccount(name, role);

    // Check for duplicate username
    const existingUsername = await UserModel.byUsername(username);
    if (existingUsername) {
      return Response.json(
        { error: "An account with that username already exists.", success: false },
        { status: 409 }
      );
    }

    const createUser = () => UserModel.create({
      name: name.trim(),
      username,
      email: emailValue,
      role,
      password,
      contact_number:
        typeof body.contact_number === "string" ? body.contact_number : null,
      address: typeof body.address === "string" ? body.address : null,
      duty_hours: typeof body.duty_hours === "string" ? body.duty_hours : null,
    });
    const id = await getDb().transaction(async () => {
      if (encryptedIdentity) {
        const tokenFingerprint = identityVerificationTokenFingerprint;
        if (!tokenFingerprint) throw new Error("Staff identity verification is missing.");
        const claimedToken = await getDb()
          .prepare("INSERT INTO staff_identity_verification_tokens (token_fingerprint, expires_at) VALUES (?, CURRENT_TIMESTAMP + INTERVAL '10 minutes') ON CONFLICT (token_fingerprint) DO NOTHING")
          .run(tokenFingerprint);
        if (!claimedToken.changes) return null;
      }

      const userId = await createUser();
      if (role === "staff") {
        await getDb().prepare("UPDATE users SET must_change_password = 1 WHERE id = ?").run(userId);
      }
      const savedUser = await UserModel.byUsername(username);
      if (
        !savedUser ||
        savedUser.id !== userId ||
        savedUser.role !== role ||
        savedUser.is_active === 0 ||
        !verifyPassword(password, savedUser.password_hash)
      ) {
        throw new Error("The new account could not be confirmed in the database. No account was created.");
      }

      if (encryptedIdentity) {
        await getDb()
          .prepare("INSERT INTO staff_identity_registrations (user_id, encrypted_images, status, encrypted_details, details_fingerprint) VALUES (?, ?, 'verified', ?, ?)")
          .run(userId, encryptedIdentity, encryptedIdentityDetails, identityFingerprint);
      }
      return userId;
    });
    if (id === null) return Response.json({ error: "This ID and face verification was already used. Scan the ID and face again.", success: false }, { status: 409 });
    logActivity(auth.user, {
      area: "Accounts",
      action: "account.created",
      summary: `Created ${role === "admin" ? "administrator" : "staff"} account for ${name.trim()}${role === "admin" ? ` · Reason: ${reason}` : ""}`,
      entity_type: "user",
      entity_id: id,
    });
    return Response.json({ id, username, ...(role === "staff" ? { temporary_password: password } : {}), success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return Response.json(
        { error: "This ID number is already attached to another staff account. The account was not created.", success: false },
        { status: 409 }
      );
    }
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not create account.",
        success: false,
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const rawBody: unknown = await request.json();
    if (!isRecord(rawBody)) {
      return Response.json(
        { error: "Account changes must be sent as an object.", success: false },
        { status: 400 }
      );
    }
    const body = rawBody;
    if (!validProfileFields(body)) {
      return Response.json(
        { error: "Contact number, address, or duty hours exceed the allowed length.", success: false },
        { status: 400 }
      );
    }
    if (body.username !== undefined && !validUsername(body.username)) {
      return Response.json(
        { error: "Enter a username with up to 80 characters and no spaces or @ sign.", success: false },
        { status: 400 }
      );
    }
    if (
      body.email !== undefined &&
      String(body.email).trim() !== "" &&
      !validEmail(body.email)
    ) {
      return Response.json(
        { error: "Enter a valid personal email address.", success: false },
        { status: 400 }
      );
    }
    const id = Number(body.id);
    if (!id) {
      return Response.json({ error: "Account id is required.", success: false }, { status: 400 });
    }
    const target = await UserModel.byId(id);
    if (!target) {
      return Response.json({ error: "Account not found.", success: false }, { status: 404 });
    }
    if (target.role !== "staff") {
      return Response.json(
        { error: "Administrator accounts cannot be managed from Staff Management.", success: false },
        { status: 403 }
      );
    }
    if (body.duty_hours !== undefined && body.duty_hours !== target.duty_hours && !validDutyHours(body.duty_hours)) return Response.json({ error: "Duty end time must be later than the start time on the same day.", success: false }, { status: 400 });
    if (body.email !== undefined && String(body.email).trim() !== "" && !validEmail(body.email)) {
      return Response.json({ error: "Staff must have a valid recovery email.", success: false }, { status: 400 });
    }
    if (id === auth.user!.id && body.is_active === false) {
      return Response.json(
        { error: "You cannot deactivate your own account.", success: false },
        { status: 400 }
      );
    }
    if (id === auth.user!.id && body.role && body.role !== auth.user!.role) {
      return Response.json(
        { error: "You cannot change your own role.", success: false },
        { status: 400 }
      );
    }

    const requestedRole =
      body.role === "admin" || body.role === "staff" ? body.role : undefined;
    if (body.role !== undefined && !requestedRole) {
      return Response.json(
        { error: "Choose a valid account role.", success: false },
        { status: 400 }
      );
    }
    if (
      body.is_active !== undefined &&
      typeof body.is_active !== "boolean"
    ) {
      return Response.json(
        { error: "Account status must be true or false.", success: false },
        { status: 400 }
      );
    }
    const password =
      typeof body.password === "string" ? body.password.trim() : "";
    if (body.password !== undefined && password && password.length < 6) {
      return Response.json(
        { error: "Use a password with at least 6 characters.", success: false },
        { status: 400 }
      );
    }
    const roleChanged =
      requestedRole !== undefined && requestedRole !== target.role;
    const statusChanged =
      body.is_active !== undefined &&
      body.is_active !== (target.is_active !== 0);
    const passwordChanged = password.length > 0;
    const usernameChanged =
      typeof body.username === "string" &&
      body.username.trim().toLowerCase() !== target.username.toLowerCase();
    const emailChanged =
      typeof body.email === "string" &&
      body.email.trim().toLowerCase() !== (target.email ?? "").toLowerCase();
    const highRiskChange =
      usernameChanged ||
      emailChanged ||
      roleChanged ||
      statusChanged ||
      passwordChanged;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!validReason(reason)) {
      return Response.json(
        { error: "Add a reason of 3 to 500 characters for every account edit.", success: false },
        { status: 400 }
      );
    }
    if (highRiskChange) {
      if (!(await hasAdminPassword(auth.user!.id, body.confirmation_password))) {
        return Response.json(
          { error: "The administrator password is incorrect.", success: false },
          { status: 401 }
        );
      }
    }

    if (
      body.name !== undefined ||
      body.username !== undefined ||
      body.email !== undefined ||
      body.role !== undefined ||
      body.is_active !== undefined ||
      body.contact_number !== undefined ||
      body.address !== undefined ||
      body.duty_hours !== undefined
    ) {
      if (emailChanged) {
        const existing = await UserModel.byEmail(String(body.email).trim());
        if (existing && existing.id !== id) {
          return Response.json(
            { error: "An account with that email already exists.", success: false },
            { status: 409 }
          );
        }
      }
      if (usernameChanged) {
        const existing = await UserModel.byUsername(String(body.username).trim());
        if (existing && existing.id !== id) {
          return Response.json(
            { error: "An account with that username already exists.", success: false },
            { status: 409 }
          );
        }
      }
      await UserModel.update(id, {
        name: body.name !== undefined ? String(body.name) : undefined,
        username: body.username !== undefined ? String(body.username) : undefined,
        email: body.email !== undefined ? String(body.email) : undefined,
        role: requestedRole,
        is_active: body.is_active !== undefined ? Boolean(body.is_active) : undefined,
        contact_number:
          typeof body.contact_number === "string"
            ? body.contact_number
            : body.contact_number === null
              ? null
              : undefined,
        address:
          typeof body.address === "string"
            ? body.address
            : body.address === null
              ? null
              : undefined,
        duty_hours:
          typeof body.duty_hours === "string"
            ? body.duty_hours
            : body.duty_hours === null
              ? null
              : undefined,
      });
    }

    if (passwordChanged) {
      await UserModel.resetPassword(id, password);
    }

    logActivity(auth.user, {
      area: "Accounts",
      action: statusChanged
        ? body.is_active
          ? "account.activated"
          : "account.deactivated"
        : passwordChanged
          ? "account.password_reset"
          : roleChanged
            ? "account.role_changed"
            : "account.updated",
      summary: `Updated the account for ${target.name} · Reason: ${reason}`,
      entity_type: "user",
      entity_id: id,
    });
    return Response.json({ success: true });
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not update account.",
        success: false,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const rawBody: unknown = await request.json();
    if (!isRecord(rawBody)) {
      return Response.json(
        { error: "Account details must be sent as an object.", success: false },
        { status: 400 }
      );
    }
    const body = rawBody;
    const id = Number(body.id);
    if (!id || id === auth.user!.id) {
      return Response.json(
        { error: "You cannot remove this account.", success: false },
        { status: 400 }
      );
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!validReason(reason)) {
      return Response.json(
        { error: "Add a reason with 3 to 500 characters before removing an account.", success: false },
        { status: 400 }
      );
    }
    if (!(await hasAdminPassword(auth.user!.id, body.confirmation_password))) {
      return Response.json(
        { error: "The administrator password is incorrect.", success: false },
        { status: 401 }
      );
    }
    const removed = await UserModel.byId(id);
    if (!removed) {
      return Response.json({ error: "Account not found.", success: false }, { status: 404 });
    }
    if (removed.role !== "staff") {
      return Response.json(
        { error: "Administrator accounts cannot be removed from Staff Management.", success: false },
        { status: 403 }
      );
    }
    await UserModel.remove(id);
    logActivity(auth.user, {
      area: "Accounts",
      action: "account.removed",
      summary: `Removed the account for ${removed?.name || `#${body.id}`} · Reason: ${reason}`,
      entity_type: "user",
      entity_id: id,
    });
    return Response.json({ success: true });
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not remove account.",
        success: false,
      },
      { status: 500 }
    );
  }
}
