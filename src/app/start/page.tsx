import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LandingPage } from "@/components/LandingPage";
import { IntroSeenMarker } from "@/components/IntroSeenMarker";
import { INTRO_SEEN_COOKIE } from "@/lib/introSeen";

export const metadata = { title: "Welcome to Merrylane" };
export const dynamic = "force-dynamic";

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>;
}) {
  const params = await searchParams;
  const table = Math.max(1, Number(params.table) || 7);
  const seen = (await cookies()).get(INTRO_SEEN_COOKIE)?.value;

  // The intro is shown once per phone; later visits go straight to the menu.
  if (seen) redirect(`/customer/menu?table=${table}`);

  return (
    <>
      <IntroSeenMarker />
      <LandingPage table={table} />
    </>
  );
}
