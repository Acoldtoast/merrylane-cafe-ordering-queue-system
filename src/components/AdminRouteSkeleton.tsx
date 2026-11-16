import {
  SkeletonChart,
  SkeletonLine,
  SkeletonPanel,
  SkeletonRows,
  SkeletonStats,
  SkeletonTable,
  SkeletonTabs,
  SkeletonToolbar,
} from "./PortalSkeletonPrimitives";

type AdminPage =
  | "overview"
  | "analysis"
  | "menu"
  | "team"
  | "hours"
  | "reviews"
  | "activity"
  | "settings";

function OverviewSkeleton({ analysis = false }: { analysis?: boolean }) {
  return (
    <>
      {analysis && (
        <div className="portal-skeleton-report-filters">
          <SkeletonLine size="search" />
          <SkeletonToolbar filters={3} actions={1} />
        </div>
      )}
      <SkeletonStats count={4} darkFirst />
      <div className="dashboard-grid">
        <SkeletonChart />
        <SkeletonPanel rows={5} className="portal-skeleton-best-sellers" />
      </div>
      {analysis ? (
        <div className="dashboard-grid">
          <SkeletonPanel rows={4} />
          <SkeletonPanel rows={4} />
        </div>
      ) : (
        <div className="dashboard-grid">
          <SkeletonPanel rows={4} />
          <SkeletonPanel rows={4} />
        </div>
      )}
      <SkeletonTable columns={6} rows={5} />
    </>
  );
}

function MenuSkeleton() {
  return (
    <>
      <SkeletonTabs count={2} />
      <SkeletonToolbar filters={1} actions={2} />
      <SkeletonTable columns={6} rows={6} />
    </>
  );
}

function TeamSkeleton() {
  return (
    <div className="admin-two portal-skeleton-team">
      <SkeletonPanel rows={5} />
      <section className="panel portal-skeleton-form-panel">
        <div className="panel-head">
          <div className="portal-skeleton-panel-heading">
            <SkeletonLine size="heading" />
            <SkeletonLine size="long" />
          </div>
        </div>
        <div className="panel-body">
          <div className="portal-skeleton-fields">
            {[1, 2, 3, 4].map((field) => (
              <div className="portal-skeleton-field" key={field}>
                <SkeletonLine size="short" />
                <SkeletonLine size="search" />
              </div>
            ))}
            <SkeletonLine size="button" />
          </div>
        </div>
      </section>
    </div>
  );
}

function HoursSkeleton() {
  return (
    <div className="hours-layout portal-skeleton-hours">
      <div className="portal-skeleton-content">
        <SkeletonPanel rows={2} />
        <section className="panel">
          <div className="panel-head">
            <div className="portal-skeleton-panel-heading">
              <SkeletonLine size="heading" />
              <SkeletonLine size="long" />
            </div>
          </div>
          <div className="panel-body">
            <div className="portal-skeleton-schedule">
              {Array.from({ length: 7 }, (_, day) => (
                <div className="portal-skeleton-schedule-row" key={day}>
                  <SkeletonLine size="medium" />
                  <SkeletonLine size="tiny" />
                  <SkeletonLine size="short" />
                  <SkeletonLine size="short" />
                  <SkeletonLine size="short" />
                </div>
              ))}
            </div>
          </div>
        </section>
        <SkeletonPanel rows={3} />
      </div>
      <div className="portal-skeleton-content">
        <SkeletonPanel rows={3} />
        <SkeletonPanel rows={4} />
      </div>
    </div>
  );
}

function ReviewsSkeleton() {
  return (
    <>
      <SkeletonStats count={3} darkFirst />
      <div className="review-export-grid">
        <section className="panel">
          <div className="panel-head">
            <div className="portal-skeleton-panel-heading">
              <SkeletonLine size="heading" />
              <SkeletonLine size="long" />
            </div>
            <SkeletonTabs count={4} />
          </div>
          <div className="panel-body">
            <SkeletonRows count={5} />
          </div>
        </section>
        <div className="portal-skeleton-content">
          <SkeletonPanel rows={5} />
          <SkeletonPanel rows={5} />
        </div>
      </div>
    </>
  );
}

function ActivitySkeleton() {
  return (
    <>
      <div className="section-bar portal-skeleton-activity-filters">
        <SkeletonToolbar filters={2} actions={1} />
        <SkeletonLine size="short" />
      </div>
      <section className="panel">
        <div className="panel-body tight">
          {[1, 2, 3].map((group) => (
            <div className="portal-skeleton-activity-group" key={group}>
              <SkeletonLine size="medium" />
              <SkeletonRows count={3} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function SettingsSkeleton() {
  return (
    <>
      <SkeletonTabs count={3} />
      <section className="card admin-settings-card portal-skeleton-settings">
        <div className="admin-settings-heading">
          <SkeletonLine size="button" />
          <div className="portal-skeleton-panel-heading">
            <SkeletonLine size="heading" />
            <SkeletonLine size="long" />
          </div>
        </div>
        <div className="portal-skeleton-fields">
          {[1, 2, 3, 4, 5].map((field) => (
            <div className="portal-skeleton-field" key={field}>
              <SkeletonLine size="short" />
              <SkeletonLine size="search" />
            </div>
          ))}
          <SkeletonLine size="button" />
        </div>
      </section>
    </>
  );
}

export function AdminRouteSkeleton({ page }: { page: AdminPage }) {
  switch (page) {
    case "overview":
      return <OverviewSkeleton />;
    case "analysis":
      return <OverviewSkeleton analysis />;
    case "menu":
      return <MenuSkeleton />;
    case "team":
      return <TeamSkeleton />;
    case "hours":
      return <HoursSkeleton />;
    case "reviews":
      return <ReviewsSkeleton />;
    case "activity":
      return <ActivitySkeleton />;
    case "settings":
      return <SettingsSkeleton />;
  }
}
