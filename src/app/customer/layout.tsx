import { CustomerProvider } from "@/components/CustomerProvider";
import { CustomerShell } from "@/components/CustomerShell";
import { readOrderingWindow } from "@/lib/portalReadData";

export const dynamic = "force-dynamic";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let ordering: Awaited<ReturnType<typeof readOrderingWindow>> | null = null;
  try {
    ordering = await readOrderingWindow();
  } catch (error) {
    console.error("Could not load the initial ordering status.", error);
  }

  return (
    <CustomerProvider vatRatePct={ordering?.menu_vat_pct}>
      <CustomerShell initialOrderingOpen={ordering?.open ?? null}>
        {children}
      </CustomerShell>
    </CustomerProvider>
  );
}
