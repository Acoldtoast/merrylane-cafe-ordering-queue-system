import { Suspense } from "react";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import { StaffPaymentsClient } from "./StaffPaymentsClient";

export const metadata = { title: "Payment checks" };

export default function StaffPaymentsPage() {
  return (
    <Suspense fallback={<PortalPageSkeleton area="staff" />}>
      <StaffPaymentsClient />
    </Suspense>
  );
}
