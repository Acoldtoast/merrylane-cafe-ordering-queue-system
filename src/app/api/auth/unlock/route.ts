import { requireStaff } from "@/lib/auth";
import { UserModel, verifyPassword } from "@/lib/models";

export async function POST(request: Request) {
  const auth = await requireStaff(request);
  if (auth.error || !auth.user) {
    return auth.error || Response.json(
      { error: "Staff access is required.", success: false },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) {
      return Response.json(
        { error: "Enter your password to continue.", success: false },
        { status: 400 }
      );
    }

    const user = await UserModel.byEmail(auth.user.email);
    if (
      !user ||
      user.role !== "staff" ||
      !verifyPassword(password, user.password_hash)
    ) {
      return Response.json(
        { error: "That password doesn't match your staff account.", success: false },
        { status: 401 }
      );
    }

    return Response.json({ success: true });
  } catch (error: unknown) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not unlock this staff session.",
        success: false,
      },
      { status: 500 }
    );
  }
}
