import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { CustomerOrderNowLink } from "@/components/CustomerOrderNowLink";
import { SystemWalkthrough } from "@/components/SystemWalkthrough";
import { SettingsModel } from "@/lib/models";

export async function LandingPage({ table }: { table?: number }) {
  let cafeLocation = "Lipa City, Batangas";

  try {
    cafeLocation = (await SettingsModel.get("cafe_location")) || cafeLocation;
  } catch {
    // The setup screen still works before the database is initialized.
  }

  const menuHref = table ? `/customer/menu?table=${table}` : undefined;

  return (
    <div className="landing">
      <header className="landing-nav">
        <Brand href={menuHref || "/"} />
        <nav className="landing-nav-links" aria-label="Main navigation">
          <a href="#portals">The system</a>
          <a href="#how-it-works">How it works</a>
          <a href="/login">Staff sign in</a>
          <a href="/login">Admin sign in</a>
        </nav>
      </header>

      <main className="landing-main">
        <section className="landing-copy">
          <span className="landing-kicker">
            <Icon name="qr" size={12} /> QR ordering · {cafeLocation.split(",")[0]}
          </span>
          <h1 className="landing-title">
            Good coffee.
            <br />
            <em>A smoother</em> cafe.
          </h1>
          <p className="landing-desc">
            Merrylane&apos;s integrated QR ordering and queue management system
            connects the table, the counter, and the kitchen — from the first sip
            to the last crumb.
          </p>
          <div className="landing-actions">
            <CustomerOrderNowLink className="btn btn-primary btn-lg" href={menuHref}>
              <Icon name="qr" /> Order now
            </CustomerOrderNowLink>
            <a href="#portals" className="btn btn-outline btn-lg">
              Explore the system <Icon name="arrow-right" className="icon-sm" />
            </a>
          </div>
        </section>

        <section
          id="portals"
          className="system-overview"
          aria-labelledby="system-title"
        >
          <div className="system-intro">
            <span className="eyebrow">One connected cafe experience</span>
            <h2 id="system-title">The system.</h2>
            <p>
              Merrylane brings ordering, service, and daily operations together.
              Customers order from their table while the cafe team keeps each
              order moving from payment to preparation and serving.
            </p>
          </div>
          <div className="system-features">
            <article className="system-feature">
              <span className="system-feature-icon"><Icon name="qr" /></span>
              <div>
                <h3>Order at your table</h3>
                <p>
                  Scan the table QR, browse available and low-portion items,
                  customize your choices, and send an order without waiting in
                  line.
                </p>
              </div>
            </article>
            <article className="system-feature">
              <span className="system-feature-icon"><Icon name="card" /></span>
              <div>
                <h3>Choose how to pay</h3>
                <p>
                  Choose cash or GCash where available. Staff review submitted
                  payments and confirm them before the order moves forward.
                </p>
              </div>
            </article>
            <article className="system-feature">
              <span className="system-feature-icon"><Icon name="receipt" /></span>
              <div>
                <h3>Follow order progress</h3>
                <p>
                  Check order status and queue progress, or use the table app to
                  call a waiter. Updates keep you informed through preparation
                  and serving.
                </p>
              </div>
            </article>
            <article className="system-feature">
              <span className="system-feature-icon"><Icon name="chart" /></span>
              <div>
                <h3>Keep cafe operations in sync</h3>
                <p>
                  Staff manage live orders, payment checks, portions, and
                  waiter requests. Admins manage the menu, hours, tables,
                  accounts, sales, and reviews through secure sign-in.
                </p>
              </div>
            </article>
          </div>
        </section>
      </main>

      <section
        id="how-it-works"
        className="how-it-works"
        aria-labelledby="how-title"
      >
        <div className="how-heading">
          <span className="eyebrow">From scan to served</span>
          <h2 id="how-title">How it works.</h2>
          <p>
            A simple flow keeps customers informed and helps the cafe team stay
            coordinated.
          </p>
        </div>
        <SystemWalkthrough />
        <div className="how-steps">
          <article className="how-step">
            <span className="how-step-number">01</span>
            <h3>Scan and browse</h3>
            <p>
              Open the QR code at your table to view the current menu and item
              availability.
            </p>
          </article>
          <article className="how-step">
            <span className="how-step-number">02</span>
            <h3>Place your order</h3>
            <p>
              Choose your items, review your cart, and submit your order with
              its table details.
            </p>
          </article>
          <article className="how-step">
            <span className="how-step-number">03</span>
            <h3>Pay and follow along</h3>
            <p>
              Complete payment and check the order page for updates as the team
              prepares and serves it.
            </p>
          </article>
        </div>
      </section>

      <footer className="landing-footer">
        <span>© 2026 Merrylane Cafe · Integrated QR Ordering &amp; Queue System</span>
      </footer>
    </div>
  );
}
