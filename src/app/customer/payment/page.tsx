import { PaymentClient } from "./PaymentClient";

export const metadata = { title: "GCash payment" };

export default async function PaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; table?: string; balance?: string }>;
}) {
  const params = await searchParams;
  return (
    <PaymentClient
      orderId={Number(params.id) || 0}
      initialTable={Math.max(1, Number(params.table) || 7)}
      balancePayment={params.balance === "1"}
    />
  );
}
