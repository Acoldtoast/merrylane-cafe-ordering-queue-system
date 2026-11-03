import { ConfirmClient } from "./ConfirmClient";

export const metadata = { title: "Order received" };

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; table?: string }>;
}) {
  const params = await searchParams;
  return (
    <ConfirmClient
      orderId={Number(params.id) || 0}
      initialTable={Math.max(1, Number(params.table) || 7)}
    />
  );
}
