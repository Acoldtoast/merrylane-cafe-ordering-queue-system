import { SkeletonLine } from "./PortalSkeletonPrimitives";

export function CustomerHoursContentSkeleton() {
  return (
    <div className="customer-hours-grid">
      {[1, 2].map((card) => (
        <section
          className="customer-hours-card customer-skeleton-content"
          key={card}
        >
          <SkeletonLine size="heading" />
          <SkeletonLine size="long" />
          {[1, 2, 3, 4, 5].map((row) => (
            <SkeletonLine size="medium" key={row} />
          ))}
        </section>
      ))}
    </div>
  );
}
