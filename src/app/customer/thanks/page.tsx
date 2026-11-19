import Link from "next/link";
import { Icon } from "@/components/Icons";

export const metadata = { title: "Thank you" };

export default async function ThanksPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; table?: string }>;
}) {
  const params = await searchParams;
  const table = Math.max(1, Number(params.table) || 7);
  const order = Number(params.order) || 0;

  return (
    <div className="thank-card">
      <div className="heart-badge">
        <Icon name="heart" />
      </div>
      <span className="eyebrow" style={{ color: "var(--brown)" }}>
        Review submitted
      </span>
      <h1 style={{ marginTop: 9 }}>Thank you for your review!</h1>
      <p>
        Your kind words are already on their way to our team. They mean more than
        you know to a small cafe like ours.
      </p>
      <div className="confirm-footer">
        {order > 0 && (
          <Link
            href={`/customer/status?id=${order}&table=${table}`}
            className="btn btn-primary btn-block"
          >
            Back to my order
          </Link>
        )}
        <Link href={`/customer/menu?table=${table}`} className="btn btn-outline btn-block btn-sm">
          Order again
        </Link>
      </div>
      <div className="welcome-meta" style={{ paddingTop: 25 }}>
        Merrylane Cafe · Lipa City, Batangas
      </div>
    </div>
  );
}
