import { requireAdmin } from "@/lib/auth";
import { buildAdminOverview } from "@/lib/adminOverview";

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const data = await buildAdminOverview({ fresh });
    return Response.json({ ...data, success: true });
  } catch (error: unknown) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load the dashboard.",
        success: false,
      },
      { status: 500 }
    );
  }
}
