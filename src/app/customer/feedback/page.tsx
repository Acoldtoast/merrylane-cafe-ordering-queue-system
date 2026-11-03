import { FeedbackClient } from "./FeedbackClient";

export const metadata = { title: "Share your visit" };

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; table?: string }>;
}) {
  const params = await searchParams;
  return (
    <FeedbackClient
      orderId={Number(params.order) || 0}
      initialTable={Math.max(1, Number(params.table) || 7)}
    />
  );
}
