import { UserModel } from "@/lib/models";
import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    return Response.json({ users: UserModel.all(), success: true });
  } catch (error: any) {
    return Response.json(
      { error: error.message, success: false },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const { name, email, role, password } = await request.json();
    if (!name || !email || !role || !password) {
      return Response.json(
        { error: "Name, email, role and password are required.", success: false },
        { status: 400 }
      );
    }
    if (String(password).length < 6) {
      return Response.json(
        { error: "Use a password with at least 6 characters.", success: false },
        { status: 400 }
      );
    }
    if (UserModel.byEmail(email)) {
      return Response.json(
        { error: "An account with that email already exists.", success: false },
        { status: 409 }
      );
    }

    const id = UserModel.create({
      name: String(name).trim(),
      email: String(email).trim(),
      role: role === "admin" ? "admin" : "staff",
      password: String(password),
    });
    logActivity(auth.user, {
      area: "Accounts",
      action: "account.created",
      summary: `Created ${role === "admin" ? "administrator" : "staff"} account for ${String(
        name
      ).trim()}`,
      entity_type: "user",
      entity_id: id,
    });
    return Response.json({ id, success: true });
  } catch (error: any) {
    return Response.json(
      { error: error.message, success: false },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const body = await request.json();
    if (!body.id || Number(body.id) === auth.user!.id) {
      return Response.json(
        { error: "You cannot remove this account.", success: false },
        { status: 400 }
      );
    }
    const removed = UserModel.byId(Number(body.id));
    UserModel.remove(Number(body.id));
    logActivity(auth.user, {
      area: "Accounts",
      action: "account.removed",
      summary: `Removed the account for ${removed?.name || `#${body.id}`}`,
      entity_type: "user",
      entity_id: Number(body.id),
    });
    return Response.json({ success: true });
  } catch (error: any) {
    return Response.json(
      { error: error.message, success: false },
      { status: 500 }
    );
  }
}
