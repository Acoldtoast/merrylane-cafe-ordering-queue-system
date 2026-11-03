import { ActivityModel } from "@/lib/models";
import { requireAdmin } from "@/lib/auth";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const pageSize = Math.min(
      Math.max(Number(url.searchParams.get("page_size")) || 30, 1),
      100
    );
    const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
    const dateParam = url.searchParams.get("date");
    if (dateParam && !DATE_PATTERN.test(dateParam)) {
      return Response.json(
        { error: "Choose a valid day.", success: false },
        { status: 400 }
      );
    }
    const areaParam = url.searchParams.get("area") || "";

    const result = ActivityModel.list({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      date: dateParam || undefined,
      area: areaParam || undefined,
    });

    return Response.json({
      logs: result.logs,
      total: result.total,
      page,
      page_size: pageSize,
      date: dateParam || null,
      area: areaParam || null,
      success: true,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Could not load the activity log.";
    return Response.json({ error: message, success: false }, { status: 500 });
  }
}
