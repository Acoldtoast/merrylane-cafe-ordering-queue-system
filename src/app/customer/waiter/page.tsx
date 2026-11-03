import { WaiterClient } from "./WaiterClient";

export const metadata = { title: "Call a waiter" };

export default async function WaiterPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; order?: string }>;
}) {
  const params = await searchParams;
  return (
    <WaiterClient
      initialTable={Math.max(1, Number(params.table) || 7)}
      orderId={Number(params.order) || 0}
    />
  );
}
