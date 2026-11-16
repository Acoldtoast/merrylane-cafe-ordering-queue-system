import { UserModel, verifyPassword } from "@/lib/models";
import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { usernameForAccount } from "@/lib/usernames";

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
    const { name, email, role, password } = body;
    if (!validProfileFields(body)) {
      return Response.json(
        { error: "Contact number, address, or duty hours exceed the allowed length.", success: false },
        { status: 400 }
      );
    }
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
    if (emailValue && !validEmail(emailValue)) {
      return Response.json(
        { error: "Enter a valid email address, or leave it blank.", success: false },
        { status: 400 }
      );
    }
    if (password.trim().length < 6) {
      return Response.json(
        { error: "Use a password with at least 6 characters.", success: false },
        { status: 400 }
      );
    }
    if (role !== "admin" && role !== "staff") {
      return Response.json(
        { error: "Choose a valid account role.", success: false },
        { status: 400 }
      );
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

    const id = await UserModel.create({
      name: name.trim(),
      username,
      email: emailValue,
      role,
      password: password.trim(),
      contact_number:
        typeof body.contact_number === "string" ? body.contact_number : null,
      address: typeof body.address === "string" ? body.address : null,
      duty_hours: typeof body.duty_hours === "string" ? body.duty_hours : null,
    });
    logActivity(auth.user, {
      area: "Accounts",
      action: "account.created",
      summary: `Created ${role === "admin" ? "administrator" : "staff"} account for ${name.trim()}${role === "admin" ? ` · Reason: ${reason}` : ""}`,
      entity_type: "user",
      entity_id: id,
    });
    return Response.json({ id, username, success: true });
  } catch (error: unknown) {
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
