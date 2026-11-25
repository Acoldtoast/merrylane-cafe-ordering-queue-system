import { UserModel } from "@/lib/models";
import { requireStaff } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const auth = await requireStaff(request);
    if (auth.error) return auth.error;
    const users = await UserModel.all();
    const staff = users
      .filter((user) => user.role === "staff" && user.is_active !== 0)
      .map((user) => ({
        id: user.id,
        name: user.name,
        username: user.username,
      }));
    return Response.json({ staff, success: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    console.error("Could not load staff accounts for discounts.", error);
    return Response.json(
      { error: "Could not load staff accounts.", success: false },
      { status: 500 }
    );
  }
}
