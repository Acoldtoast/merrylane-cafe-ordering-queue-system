type LineSize = "tiny" | "short" | "medium" | "long" | "heading" | "value" | "search" | "button";

export function SkeletonLine({ size = "medium" }: { size?: LineSize }) {
  return <span className={`portal-skeleton-line portal-skeleton-line-${size} skeleton`} />;
}

export function SkeletonStats({
  count,
  darkFirst = false,
}: {
  count: number;
  darkFirst?: boolean;
}) {
  return (
    <div className={`stat-grid ${count === 3 ? "three" : ""} portal-skeleton-stat-grid`}>
      {Array.from({ length: count }, (_, index) => (
        <div
          className={`stat-card portal-skeleton-stat${darkFirst && index === 0 ? " dark" : ""}`}
          key={index}
        >
          <SkeletonLine size="short" />
          <SkeletonLine size="value" />
          <SkeletonLine size="long" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="portal-skeleton-rows">
      {Array.from({ length: count }, (_, index) => (
        <div className="portal-skeleton-row" key={index}>
          <SkeletonLine size={index % 2 === 0 ? "long" : "medium"} />
          <SkeletonLine size="short" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPanel({
  rows = 4,
  className = "",
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <section className={`panel portal-skeleton-panel ${className}`.trim()}>
      <div className="panel-head">
        <div className="portal-skeleton-panel-heading">
          <SkeletonLine size="heading" />
          <SkeletonLine size="long" />
        </div>
        <SkeletonLine size="short" />
      </div>
      <div className="panel-body">
        <SkeletonRows count={rows} />
      </div>
    </section>
  );
}

export function SkeletonTable({
  columns = 5,
  rows = 5,
}: {
  columns?: 4 | 5 | 6 | 7;
  rows?: number;
}) {
  const rowCount = rows + 1;
  return (
    <section className="panel portal-skeleton-table-panel">
      <div className="panel-body tight">
        <div className="portal-skeleton-table">
          {Array.from({ length: rowCount }, (_, row) => (
            <div
              className={`portal-skeleton-table-row portal-skeleton-columns-${columns}${row === 0 ? " is-head" : ""}`}
              key={row}
            >
              {Array.from({ length: columns }, (_, column) => (
                <SkeletonLine
                  size={row === 0 ? "short" : column === 0 ? "long" : "medium"}
                  key={column}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SkeletonToolbar({
  filters = 2,
  actions = 1,
}: {
  filters?: number;
  actions?: number;
}) {
  return (
    <div className="portal-skeleton-toolbar">
      <SkeletonLine size="search" />
      <div className="portal-skeleton-toolbar-actions">
        {Array.from({ length: filters + actions }, (_, index) => (
          <SkeletonLine
            size={index >= filters ? "button" : "medium"}
            key={index}
          />
        ))}
      </div>
    </div>
  );
}

export function SkeletonTabs({ count = 3 }: { count?: number }) {
  return (
    <div className="portal-skeleton-tabs">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonLine size="button" key={index} />
      ))}
    </div>
  );
}

export function SkeletonChart() {
  return (
    <section className="card chart-panel portal-skeleton-chart-card">
      <div className="portal-skeleton-chart-heading">
        <SkeletonLine size="heading" />
        <SkeletonLine size="short" />
      </div>
      <div className="portal-skeleton-chart-bars">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((bar) => (
          <span className="skeleton" key={bar} />
        ))}
      </div>
    </section>
  );
}
