export default function MenuLoading() {
  return (
    <div className="menu-page menu-loading" role="status" aria-busy="true">
      <span className="sr-only">Opening the menu…</span>

      <div className="page-heading" aria-hidden="true">
        <div className="menu-loading-title skeleton" />
        <div className="menu-loading-badge skeleton" />
      </div>

      <div className="menu-layout" aria-hidden="true">
        <section className="menu-content">
          <div className="menu-toolbar">
            <div className="menu-loading-search skeleton" />
            <div className="category-row">
              {[96, 62, 92, 82].map((width, index) => (
                <div
                  className="menu-loading-category skeleton"
                  key={index}
                  style={{ width }}
                />
              ))}
            </div>
          </div>

          <section className="menu-section">
            <div className="menu-section-head">
              <div className="menu-loading-section-title skeleton" />
              <div className="menu-loading-count skeleton" />
            </div>
            <div className="menu-grid">
              {Array.from({ length: 6 }, (_, index) => (
                <div className="menu-card menu-loading-card" key={index}>
                  <div className="menu-loading-art skeleton" />
                  <div className="menu-info">
                    <div className="menu-loading-name skeleton" />
                    <div className="menu-loading-description skeleton" />
                    <div className="menu-loading-bottom">
                      <div className="menu-loading-price skeleton" />
                      <div className="menu-loading-add skeleton" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </section>

        <aside className="cart-panel menu-loading-cart">
          <div className="cart-panel-head">
            <div className="menu-loading-cart-title skeleton" />
            <div className="menu-loading-cart-badge skeleton" />
          </div>
          <div className="menu-loading-cart-body">
            <div className="menu-loading-cart-icon skeleton" />
            <div className="menu-loading-cart-empty skeleton" />
            <div className="menu-loading-cart-copy skeleton" />
          </div>
        </aside>
      </div>
    </div>
  );
}
