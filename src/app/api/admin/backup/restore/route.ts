import { requireAdmin } from "@/lib/auth";

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  // Replacing an open PGlite data directory can corrupt data. Restores must
  // remain disabled until an offline, coordinated restore is implemented.
  return Response.json(
    {
      error: "Online restore is unavailable. Stop the server and use a verified offline recovery procedure.",
      success: false,
    },
    { status: 503 }
  );
}
