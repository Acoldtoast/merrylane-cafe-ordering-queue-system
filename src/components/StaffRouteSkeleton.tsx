import {
  SkeletonLine,
  SkeletonPanel,
  SkeletonRows,
  SkeletonStats,
  SkeletonTable,
  SkeletonTabs,
} from "./PortalSkeletonPrimitives";

type StaffPage =
  | "board"
  | "payments"
  | "receipt"
  | "requests"
  | "sales"
  | "stock";

function BoardSkeleton() {
  return (
    <>
      <SkeletonStats count={3} />
      <div className="section-bar portal-skeleton-section">
        <SkeletonLine size="heading" />
        <SkeletonLine size="button" />
      </div>
      <SkeletonTabs count={5} />
      <div className="followup-layout portal-skeleton-followup">
        <SkeletonPanel rows={4} />
        <div className="portal-skeleton-lanes">
          {[1, 2, 3].map((lane) => (
            <div className="portal-skeleton-lane panel" key={lane}>
              <SkeletonLine size="heading" />
              {[1, 2].map((card) => (
                <div className="portal-skeleton-order-card" key={card}>
                  <SkeletonLine size="medium" />
                  <SkeletonLine size="long" />
                  <SkeletonLine size="short" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function PaymentsSkeleton() {
  return (
    <>
      <div className="payment-review-heading">
        <SkeletonLine size="short" />
        <SkeletonLine size="button" />
      </div>
      <SkeletonTabs count={2} />
      <div className="payment-review-workspace portal-skeleton-payment-workspace">
        <section className="payment-queue-panel">
          <SkeletonLine size="heading" />
          <SkeletonRows count={5} />
        </section>
        <section className="payment-evidence-panel">
          <SkeletonLine size="heading" />
          <div className="portal-skeleton-payment-evidence skeleton" />
          <SkeletonRows count={2} />
        </section>
        <section className="payment-decision-panel">
          <SkeletonLine size="heading" />
          <SkeletonRows count={4} />
          <SkeletonLine size="button" />
        </section>
      </div>
    </>
  );
}

function ReceiptSkeleton() {
  return (
    <>
      <div className="section-bar portal-skeleton-section">
        <div className="portal-skeleton-panel-heading">
          <SkeletonLine size="heading" />
          <SkeletonLine size="long" />
        </div>
        <SkeletonLine size="button" />
      </div>
      <SkeletonTable columns={7} rows={6} />
    </>
  );
}

function RequestsSkeleton() {
  return (
    <>
      <SkeletonStats count={2} darkFirst />
      <div className="section-bar portal-skeleton-section">
        <SkeletonLine size="heading" />
        <SkeletonLine size="button" />
      </div>
      <div className="waiter-request-board">
        {[1, 2].map((column) => (
          <SkeletonPanel rows={4} key={column} />
        ))}
      </div>
    </>
  );
}

function SalesSkeleton() {
  return (
    <>
      <div className="section-bar portal-skeleton-section">
        <div className="portal-skeleton-panel-heading">
          <SkeletonLine size="heading" />
          <SkeletonLine size="long" />
        </div>
        <SkeletonLine size="button" />
      </div>
      <SkeletonLine size="medium" />
      <div className="daily-sales-totals portal-skeleton-sales-totals">
        {[1, 2, 3].map((total) => (
          <div className="daily-sales-total" key={total}>
            <SkeletonLine size="short" />
            <SkeletonLine size="value" />
            <SkeletonLine size="medium" />
          </div>
        ))}
      </div>
      <div className="daily-sales-lists portal-skeleton-sales-lists">
        <SkeletonPanel rows={5} />
        <SkeletonPanel rows={5} />
      </div>
      <SkeletonPanel rows={4} />
    </>
  );
}

function StockSkeleton() {
  return (
    <>
      <SkeletonStats count={3} />
      <div className="section-bar portal-skeleton-section">
        <div className="portal-skeleton-panel-heading">
          <SkeletonLine size="heading" />
          <SkeletonLine size="long" />
        </div>
        <SkeletonLine size="button" />
      </div>
      <div className="portal-skeleton-toolbar">
        <SkeletonLine size="search" />
        <SkeletonTabs count={4} />
      </div>
      <SkeletonTable columns={5} rows={6} />
    </>
  );
}

export function StaffRouteSkeleton({ page }: { page: StaffPage }) {
  switch (page) {
    case "board":
      return <BoardSkeleton />;
    case "payments":
      return <PaymentsSkeleton />;
    case "receipt":
      return <ReceiptSkeleton />;
    case "requests":
      return <RequestsSkeleton />;
    case "sales":
      return <SalesSkeleton />;
    case "stock":
      return <StockSkeleton />;
  }
}
