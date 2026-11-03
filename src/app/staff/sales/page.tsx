import { StaffSalesClient } from "./StaffSalesClient";

export const metadata = { title: "Sales" };

function manilaDate() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export default function StaffSalesPage() {
  return <StaffSalesClient initialDate={manilaDate()} />;
}
