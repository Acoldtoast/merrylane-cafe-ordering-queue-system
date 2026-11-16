"use client";

import { usePathname } from "next/navigation";
import { CustomerHoursContentSkeleton } from "./CustomerHoursContentSkeleton";
import { SkeletonLine } from "./PortalSkeletonPrimitives";

type CustomerPage =
  | "welcome"
  | "item"
  | "cart"
  | "confirm"
  | "payment"
  | "status"
  | "orders"
  | "feedback"
  | "hours"
  | "waiter"
  | "thanks";

function pageFor(pathname: string): CustomerPage {
  if (pathname.startsWith("/customer/item/")) return "item";
  if (pathname.startsWith("/customer/cart")) return "cart";
  if (pathname.startsWith("/customer/confirm")) return "confirm";
  if (pathname.startsWith("/customer/payment")) return "payment";
  if (pathname.startsWith("/customer/status")) return "status";
  if (pathname.startsWith("/customer/orders")) return "orders";
  if (pathname.startsWith("/customer/feedback")) return "feedback";
  if (pathname.startsWith("/customer/hours")) return "hours";
  if (pathname.startsWith("/customer/waiter")) return "waiter";
  if (pathname.startsWith("/customer/thanks")) return "thanks";
  return "welcome";
}

function WelcomeSkeleton() {
  return (
    <div className="welcome-shell customer-route-skeleton-content">
      <section className="welcome-desktop-side" aria-hidden="true">
        <SkeletonLine size="heading" />
        <SkeletonLine size="long" />
        <SkeletonLine size="medium" />
      </section>
      <section className="welcome-wrap">
        <div className="welcome-card">
          <SkeletonLine size="short" />
          <SkeletonLine size="heading" />
          <SkeletonLine size="long" />
          <SkeletonLine size="search" />
          <SkeletonLine size="button" />
        </div>
      </section>
    </div>
  );
}

function ItemSkeleton() {
  return (
    <>
      <SkeletonLine size="short" />
      <div className="item-layout">
        <div className="item-visual customer-skeleton-item-visual skeleton" />
        <section className="item-panel">
          <SkeletonLine size="short" />
          <SkeletonLine size="heading" />
          <SkeletonLine size="long" />
          <SkeletonLine size="medium" />
          <div className="customer-skeleton-options">
            {[1, 2, 3].map((option) => (
              <SkeletonLine size="search" key={option} />
            ))}
          </div>
          <SkeletonLine size="button" />
        </section>
      </div>
    </>
  );
}

function CartSkeleton() {
  return (
    <>
      <SkeletonLine size="short" />
      <header className="checkout-head customer-skeleton-heading">
        <SkeletonLine size="short" />
        <SkeletonLine size="heading" />
        <SkeletonLine size="long" />
      </header>
      <div className="checkout-layout">
        <div className="checkout-main customer-skeleton-checkout-main">
          {[1, 2].map((section) => (
            <section className="checkout-section" key={section}>
              <SkeletonLine size="heading" />
              <SkeletonLine size="long" />
              {section === 1 && <SkeletonLine size="search" />}
              <div className="customer-skeleton-options">
                <SkeletonLine size="search" />
                <SkeletonLine size="search" />
              </div>
            </section>
          ))}
        </div>
        <aside className="sticky-summary">
          <div className="summary-card customer-skeleton-summary">
            <SkeletonLine size="heading" />
            <SkeletonLine size="long" />
            <SkeletonLine size="medium" />
            <SkeletonLine size="long" />
            <SkeletonLine size="button" />
          </div>
        </aside>
      </div>
    </>
  );
}

function ConfirmationSkeleton({ payment = false }: { payment?: boolean }) {
  return (
    <div className="centered-narrow">
      <section className="confirm-card customer-skeleton-confirm">
        <div className="customer-skeleton-medallion skeleton" />
        <SkeletonLine size="short" />
        <SkeletonLine size="heading" />
        <SkeletonLine size="long" />
        <div className="confirm-summary customer-skeleton-summary">
          {[1, 2, 3, ...(payment ? [4] : [])].map((row) => (
            <div className="confirm-line" key={row}>
              <SkeletonLine size="short" />
              <SkeletonLine size="medium" />
            </div>
          ))}
        </div>
        <SkeletonLine size="button" />
      </section>
    </div>
  );
}

function StatusSkeleton() {
  return (
    <div className="status-layout">
      <div className="status-main customer-skeleton-content">
        <div className="status-progress card customer-skeleton-progress">
          <SkeletonLine size="heading" />
          <div className="customer-skeleton-steps">
            {[1, 2, 3, 4].map((step) => (
              <SkeletonLine size="short" key={step} />
            ))}
          </div>
        </div>
        <section className="card status-detail customer-skeleton-detail">
          <SkeletonLine size="heading" />
          <SkeletonLine size="long" />
          <SkeletonLine size="medium" />
        </section>
        <SkeletonLine size="button" />
      </div>
      <aside className="status-side">
        <div className="card status-order-card customer-skeleton-order">
          <SkeletonLine size="heading" />
          {[1, 2, 3].map((row) => (
            <div className="confirm-line" key={row}>
              <SkeletonLine size="short" />
              <SkeletonLine size="medium" />
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function OrdersSkeleton() {
  return (
    <div className="order-history-page">
      <header className="order-history-head">
        <SkeletonLine size="heading" />
        <SkeletonLine size="long" />
      </header>
      <div className="order-history-list">
        {[1, 2, 3].map((order) => (
          <article className="card order-history-card" key={order}>
            <div className="order-history-main customer-skeleton-content">
              <SkeletonLine size="short" />
              <SkeletonLine size="medium" />
              <SkeletonLine size="long" />
            </div>
            <div className="order-history-side customer-skeleton-content">
              <SkeletonLine size="short" />
              <SkeletonLine size="medium" />
              <SkeletonLine size="short" />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function FeedbackSkeleton() {
  return (
    <section className="review-form-card customer-skeleton-review">
      <SkeletonLine size="short" />
      <SkeletonLine size="heading" />
      <SkeletonLine size="long" />
      <div className="rating-box">
        <SkeletonLine size="medium" />
        <SkeletonLine size="long" />
      </div>
      <div className="feedback-form customer-skeleton-content">
        {[1, 2, 3].map((field) => (
          <div className="field customer-skeleton-content" key={field}>
            <SkeletonLine size="short" />
            <SkeletonLine size="search" />
          </div>
        ))}
        <SkeletonLine size="button" />
      </div>
    </section>
  );
}

function HoursSkeleton() {
  return (
    <div className="customer-hours-page">
      <header className="customer-hours-heading customer-skeleton-content">
        <SkeletonLine size="short" />
        <SkeletonLine size="heading" />
        <SkeletonLine size="long" />
        <SkeletonLine size="button" />
      </header>
      <CustomerHoursContentSkeleton />
    </div>
  );
}

function WaiterSkeleton() {
  return (
    <div className="waiter-card customer-skeleton-content">
      <SkeletonLine size="short" />
      <section className="waiter-intro customer-skeleton-content">
        <SkeletonLine size="short" />
        <SkeletonLine size="heading" />
        <SkeletonLine size="long" />
      </section>
      <section className="card waiter-form customer-skeleton-content">
        <SkeletonLine size="heading" />
        {[1, 2, 3].map((field) => (
          <SkeletonLine size="search" key={field} />
        ))}
        <SkeletonLine size="button" />
      </section>
    </div>
  );
}

function ThanksSkeleton() {
  return (
    <div className="centered-narrow">
      <section className="confirm-card customer-skeleton-confirm">
        <div className="customer-skeleton-medallion skeleton" />
        <SkeletonLine size="short" />
        <SkeletonLine size="heading" />
        <SkeletonLine size="long" />
        <SkeletonLine size="button" />
      </section>
    </div>
  );
}

const pageLabels: Record<CustomerPage, string> = {
  welcome: "welcome page",
  item: "item details",
  cart: "checkout",
  confirm: "order confirmation",
  payment: "payment details",
  status: "order status",
  orders: "order history",
  feedback: "feedback form",
  hours: "cafe hours",
  waiter: "waiter request form",
  thanks: "thank-you page",
};

export function CustomerPageSkeleton({
  page: pageOverride,
}: {
  page?: CustomerPage;
} = {}) {
  const pathname = usePathname();
  const page = pageOverride ?? pageFor(pathname);
  let content;

  switch (page) {
    case "welcome":
      content = <WelcomeSkeleton />;
      break;
    case "item":
      content = <ItemSkeleton />;
      break;
    case "cart":
      content = <CartSkeleton />;
      break;
    case "confirm":
      content = <ConfirmationSkeleton />;
      break;
    case "payment":
      content = <ConfirmationSkeleton payment />;
      break;
    case "status":
      content = <StatusSkeleton />;
      break;
    case "orders":
      content = <OrdersSkeleton />;
      break;
    case "feedback":
      content = <FeedbackSkeleton />;
      break;
    case "hours":
      content = <HoursSkeleton />;
      break;
    case "waiter":
      content = <WaiterSkeleton />;
      break;
    case "thanks":
      content = <ThanksSkeleton />;
      break;
  }

  return (
    <section
      className={`customer-route-skeleton customer-route-skeleton-${page}`}
      role="status"
      aria-busy="true"
      aria-label={`Loading ${pageLabels[page]}`}
    >
      <div aria-hidden="true">{content}</div>
    </section>
  );
}
