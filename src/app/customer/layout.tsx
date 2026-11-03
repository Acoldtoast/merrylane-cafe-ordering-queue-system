import { CustomerProvider } from "@/components/CustomerProvider";
import { CustomerShell } from "@/components/CustomerShell";
import { SettingsModel } from "@/lib/models";

export const dynamic = "force-dynamic";

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let initialOrderingOpen: boolean | null = null;
  try {
    initialOrderingOpen = SettingsModel.isOrderingOpen();
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
