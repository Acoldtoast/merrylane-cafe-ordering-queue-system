import { Suspense } from "react";
import { StaffPaymentsClient } from "./StaffPaymentsClient";

export const metadata = { title: "Payment checks" };

export default function StaffPaymentsPage() {
  return (
    <Suspense fallback={<div className="loading-block">Loading payment checks…</div>}>
      <StaffPaymentsClient />
    </Suspense>
  );
}
