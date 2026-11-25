import { CustomerProvider } from "@/components/CustomerProvider";
import { CustomerShell } from "@/components/CustomerShell";
import { readOrderingWindow } from "@/lib/portalReadData";

export const dynamic = "force-dynamic";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let initialOrderingOpen: boolean | null = null;
  try {
    initialOrderingOpen = (await readOrderingWindow()).open;
  } catch (error) {
    console.error("Could not load the initial ordering status.", error);
  }

  return (
    <CustomerProvider>
      <CustomerShell initialOrderingOpen={initialOrderingOpen}>
        {children}
      </CustomerShell>
    </CustomerProvider>
  );
}
