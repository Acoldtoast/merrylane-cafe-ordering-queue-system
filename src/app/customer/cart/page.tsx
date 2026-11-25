import { SettingsModel } from "@/lib/models";
import { parseServiceChargePct } from "@/lib/serviceCharge";
import { ClosedShop } from "@/components/ClosedShop";
import { CartClient } from "./CartClient";

export const metadata = { title: "Review your order" };
export const dynamic = "force-dynamic";

export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>;
}) {
  const params = await searchParams;
  const table = Math.max(1, Number(params.table) || 7);

  const [ordering, serviceCharge] = await Promise.allSettled([
    SettingsModel.orderingWindow(),
    SettingsModel.get("service_charge_pct"),
  ]);
  if (ordering.status === "fulfilled" && !ordering.value.open) {
    return <ClosedShop ordering={ordering.value} table={table} />;
  }

  const serviceChargePct = serviceCharge.status === "fulfilled"
    ? parseServiceChargePct(serviceCharge.value)
    : null;
  return <CartClient initialTable={table} serviceChargePct={serviceChargePct} />;
}
