import { Suspense } from "react";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import { StaffReceiptsClient } from "./StaffReceiptsClient";

export const metadata = { title: "Receipt" };

export default function StaffReceiptPage() {
  return (
    <Suspense fallback={<PortalPageSkeleton area="staff" />}>
      <StaffReceiptsClient />
    </Suspense>
  );
}
