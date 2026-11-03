# Merrylane Cafe — QR ordering & cafe management

A complete, self-contained ordering system for Merrylane Cafe, built with **Next.js 16 (App Router)**,
**React 19**, and Node's built-in **`node:sqlite`**. Everything runs locally — no external database,
image host, or payment gateway is required.

It implements the SAD proposal: table QR ordering, item customization, dine-in/take-out, GCash or
counter payment with receipt upload and staff verification, queue tracking, waiter calls, stock
control, ordering hours, reviews with a promo-image export, a staff panel, an admin dashboard with
sales forecasting, and a cafe Wi-Fi gate.

---

## Quick start

```bash
npm install
npm run db:init      # create data/merrylane.db and seed demo data
npm run dev          # http://localhost:3112
```

The dev server binds to `0.0.0.0`, so it is reachable from a phone on the same network.

### Open it on a phone

1. Connect the phone to the same Wi-Fi as this computer (the cafe's `MERLYLANE-WIFI` in real use).
2. Find this computer's LAN address:

   ```powershell
   Get-NetIPAddress -AddressFamily IPv4 |
     Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
     Select-Object -ExpandProperty IPAddress
   ```

3. On the phone, open `http://<that-address>:3112` — for example
   **http://192.168.197.207:3112**

To open a specific table, use a table QR link:
`http://<address>:3112/customer/welcome?table=3` (the `table` value always wins over a previously
visited table).

If Windows Firewall prompts for Node.js, allow access on **Private networks**.

### Faster loading on phones

For demos and real counter use, run the production build instead of the dev server:

```bash
npm run build
npm run start        # still http://<lan-address>:3112
```

`next dev` compiles each route the first time it is opened, which can take seconds on a phone over
Wi-Fi. The production server serves the prebuilt pages immediately. The menu and order status are
rendered on the server, so the first screen arrives with the menu items already in the HTML instead
of waiting for a second API request.

### Demo accounts

| Role          | Email                  | Password   | Lands on |
| ------------- | ---------------------- | ---------- | -------- |
| Administrator | `admin@merrylane.com`  | `admin123` | `/admin` |
| Staff         | `barista@merrylane.com`| `staff123` | `/staff` |

The login screen has one-tap buttons that fill these in.

---

## Page map

**Customer (phone-first)**

| Route | Purpose |
| --- | --- |
| `/customer/welcome?table=N` | Table welcome; auto-detects the cafe network and opens the menu |
| `/customer/menu?table=N` | Server-rendered menu, categories, search, live stock |
| `/customer/item/[id]?table=N` | Size, temperature, milk, extras, quantity |
| `/customer/cart?table=N` | Order review, dine-in/take-out, payment choice |
| `/customer/payment?id=N` | GCash QR, receipt upload, reference number (`&balance=1` for an added balance) |
| `/customer/confirm?id=N` | Order received |
| `/customer/status?id=N` | Live queue number, customer name and status (auto-refresh), with an ETA-triggered follow-up request while preparing |
| `/customer/orders` | Guest order history for this browser, with links back to each live order |
| `/customer/feedback?order=N` | Star rating + comment |
| `/customer/thanks?order=N` | Thank-you and return to menu |
| `/customer/waiter?table=N` | Call a waiter (water, cutlery, bill, help); one request every 5 minutes with a live countdown |
| `/customer/closed` | Shown outside ordering hours |
| `/network-required` | Shown when not on the cafe network; retries automatically and supports “Skip for now” |

**Staff** (`/staff`)

- `/staff` — live order board with a persistent customer follow-up sidebar, add menu items or extras to an active order, collect added balances at the counter, confirm orders, start preparing, mark ready, complete
- `/staff/payments` — review original GCash receipts and separate GCash receipts for staff-added balances
- `/staff/stock` — on-hand counts, low-stock thresholds, mark sold out
- `/staff/requests` — waiter calls, acknowledge and resolve

**Admin** (`/admin`, administrators only)

- `/admin` — revenue, orders, queue, best sellers, hourly sales, 7-day forecast
- `/admin/menu` — menu items, availability, custom categories, staff accounts, and item-specific
  choose-one option groups (for example Temperature → Hot / Iced) with optional extra prices
- `/admin/hours` — opening hours, last-order cutoff, GCash details, table QR sheet
- `/admin/reviews` — ratings, average score, downloadable 1080×1080 promo image

**Auth**

- `/login` — staff/admin sign-in (JWT in an HttpOnly cookie)

---

## Order lifecycle

```
pending ──▶ payment_pending ──▶ confirmed ──▶ preparing ──▶ ready ──▶ completed
   │               │
   └───────────────┴──▶ cancelled
```

- **Counter** orders start as `pending` and are confirmed by staff at the counter.
- **GCash** orders start as `payment_pending`; the customer uploads a receipt and reference number,
  then staff verify it in `/staff/payments`. Verifying sets `payment_status = verified`, confirms the
  order, and assigns the next queue number (max + 1, so numbers never repeat).
- Staff can add menu items and catalog add-ons until the order is ready. Added charges do not alter
  the amount already paid: the order shows an outstanding balance that can be collected at the
  counter or submitted as a separate GCash receipt. Separate GCash receipts remain pending until
  staff review them; each collection and decision is stored in the `order_balance_payments` ledger.
- Customers can request an update from their live order status page while an order is confirmed,
  preparing, or ready. These requests appear in the staff orderboard follow-up sidebar and stay there
  until staff resolve them; they are separate from unpaid orders and payment review.
- While a separate GCash balance receipt is pending, order totals cannot be changed and another
  payment cannot be submitted. Rejected receipts leave the balance due so the customer can retry or
  pay at the counter.
- The customer status page polls every few seconds and moves through Confirmed → Preparing → Ready →
  Completed on its own.
- Guest orders are associated with a random, persistent HttpOnly browser cookie; no account or phone
  number is required. Clearing browser cookies or switching browsers/devices starts a separate guest
  history. IP addresses are not used to identify guests.
- Completed orders expose "Leave a review"; submitting sends the customer to the thank-you page.

Existing orders do not have a guest identifier. The history page can preserve the last order ID already
saved in the same browser, but older orders cannot be reliably assigned to a guest retroactively.

---

## Database

`data/merrylane.db` is created by `scripts/init-db.js` using `node:sqlite`.

```bash
npm run db:init   # drop + recreate + seed (destructive)
npm run db:migrate # add supported columns/tables without removing existing data
```

After updating an existing installation, run `npm run db:migrate` before starting the app so
guest-order ownership columns and indexes are added without resetting saved orders.

Seed data: 3 categories, 15 menu items with variants and extras, 4 staff accounts, table settings,
sample orders, payments, waiter requests, and reviews.

The admin **Reviews** page reads the same reviews; the **Hours & tables** page edits opening hours and
the GCash merchant details stored in `settings`.

---

## Production

```bash
npm run build
npm run start     # serves the build on 0.0.0.0:3112
```

Notes:

- The build uses webpack (`next build --webpack`) to match development; Turbopack is not used because
  of a Windows/WASM issue with the SQLite toolchain.
- `npm install` applies a small Next.js 16.4.3 development-only guard that ignores late React debug
  chunks after their stream closes, preventing a Next dev-overlay error. Restart `npm run dev` after
  installing dependencies or applying this patch.
- Production builds use `.next-production` so they do not overwrite a running development server's `.next` files.
- `/customer/*` requests are redirected to `/network-required` unless they come from the cafe's
  private network. Detection uses the client IP (`x-forwarded-for` / `x-real-ip`) and the request
  host, covering `localhost`, `192.168.*`, `10.*`, `172.16–31.*`, IPv6 loopback/ULA/link-local and
  `*.local` names. Browsers cannot read the Wi-Fi SSID, so “same network” is the reliable signal;
  the configured `wifi_ssid` is shown on the welcome and connection screens.
- The connection screen checks again every few seconds and opens the menu as soon as the phone joins
  the cafe network. “Skip for now” sets a session cookie that bypasses the check until the browser
  closes.
- Set `JWT_SECRET` in the environment before deploying anywhere real.

---

## Project layout

```
data/                     SQLite database (created by db:init)
public/fonts/             Bundled Fraunces + Manrope WOFF2 files
public/illustrations/     Local SVG coffee/pastry artwork
scripts/init-db.js        Schema + demo seed
src/app/api/              REST endpoints (menu, orders, stock, waiter, reviews,
                          settings, users, analytics, qr, auth)
src/app/customer/         Customer app
src/app/staff/            Staff panel
src/app/admin/            Admin dashboard
src/app/login/            Staff/admin sign-in
src/components/           Shells, cart, icons, shared UI
src/lib/models.ts         Data access, sales, forecasting, queue numbering
src/lib/auth.ts           Password hashing and JWT session helpers
src/proxy.ts              Route protection + cafe-network gate (Next 16 proxy)
src/app/globals.css       Design system and responsive styles
```

---

## Design

Warm cream and coffee-brown palette, Fraunces serif display type, Manrope for UI text, mobile-first
customer screens, and dark high-contrast sidebars for staff and admin. All artwork and fonts are local,
so the system works on a LAN with no internet connection.
