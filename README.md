# Merrylane Cafe — QR ordering & cafe management

A complete, self-contained ordering system for Merrylane Cafe, built with **Next.js 16 (App Router)**,
**React 19**, and a local **PGlite** (PostgreSQL compiled to WebAssembly) database. Everything runs
locally for data storage — no external database server or image host is required. GCash checkout
uses Xendit, and staff face verification uses Face++.

It implements the SAD proposal: table QR ordering, item customization, dine-in/take-out, GCash or
counter payment, automatic Xendit payment confirmation, queue tracking, waiter calls, stock
control, ordering hours, reviews with a promo-image export, a staff panel, an admin dashboard with
sales forecasting and scheduled email reports, and a cafe Wi-Fi gate.

---

## Quick start

Use Node.js 24. Copy `.env.example` to `.env.local` and configure it before signing in.

```bash
npm install     # also applies a small Next dev-overlay guard (postinstall)
npm run dev     # http://localhost:3112
```

The dev server binds to `0.0.0.0`, so it is reachable from a phone on the same network.

### HTTPS for the phone camera

Stop the existing dev server first; never run two app servers against the same PGlite directory.
Run `npm run dev:https` and open the printed HTTPS address on the phone connected to the same Wi-Fi.
Next.js may download `mkcert` and ask for permission to install a local certificate authority.

The phone must trust that authority and grant camera permission. Share only `rootCA.pem`, never
`rootCA-key.pem`. Trust the CA only on devices you control and remove that trust after testing. If the
Wi-Fi address changes, restart the HTTPS server and use the new address. This is for development only.

### Environment

Create `.env.local` (never committed — see [Security](#security)) with a unique secret:

```bash
JWT_SECRET=<64 hex characters>
# separate secret required when saving an SMTP password
SMTP_PASSWORD_ENCRYPTION_KEY=<64 hex characters>
```

Generate one with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | yes | Signs session JWTs. There is no insecure fallback. |
| `SMTP_PASSWORD_ENCRYPTION_KEY` | for SMTP passwords | Encrypts stored SMTP passwords. Generate a separate secret and keep it stable. |
| `MERRYLANE_DB_DIR` | no | Absolute path of the PGlite directory. Defaults to `data/merrylane-pglite`. |
| `XENDIT_TEST_SECRET_KEY` | for test GCash payments | Server-side test key used outside production. |
| `XENDIT_SECRET_KEY` | for live GCash payments | Server-side live key used in production. |
| `XENDIT_WEBHOOK_TOKEN` | for GCash | Callback verification token configured in Xendit. |
| `APP_URL` | for GCash | App origin, without a path. Use public HTTPS in production. |
| `FACEPP_API_KEY`, `FACEPP_API_SECRET` | for staff face verification | Server-side Face++ credentials. Face images are sent to Face++ for verification. |

#### Xendit GCash setup

1. For local testing, set the test secret, a private webhook token, and `APP_URL=http://localhost:3112`.
   For phone testing, open the app using the computer's private IPv4 address and port. Keep the
   payment page open so it can poll Xendit when a webhook cannot reach the private address. Some
   checkout flows may require public HTTPS even in test mode.
2. In production, set the live secret and public HTTPS `APP_URL`. In Xendit, configure the Payment
   Requests v3 payment status webhook to `https://<your-public-domain>/api/webhooks/xendit` with the
   same callback token. Production does not fall back to the test key.
3. Restart the app after changing environment variables. Keep provider credentials server-side.

The QR opens Xendit's hosted checkout; it is not a direct QRPh payment code. A direct GCash app link
appears when supplied by Xendit. Opening checkout or returning to the app does not mark an order paid.

### Database

All data lives in `data/merrylane-pglite`. The directory is opened (and created if missing) on the
first request, so there is no migrate or seed command. Schema upgrades — new columns, indexes, and
helper tables — are applied automatically by the models the first time a route needs them.

The database is **not** in version control: it holds customer orders, payment proofs, and password
hashes. To set up a fresh checkout, copy a PGlite directory (or a snapshot from `data/backups`) into
`data/merrylane-pglite`, or point `MERRYLANE_DB_DIR` at an existing copy.

PGlite is the only database. The app reads and writes it through `src/lib/db/`, and all new tables
and queries use native PostgreSQL syntax.

### Accounts

Sign-in uses the account **username**, not an email address. An empty users table gets a default
administrator account (`admin`); change its password before exposing the app to other users. Restored databases
keep their existing accounts. Administrators land on `/admin` and staff use `/staff`.

Add or edit accounts under **Admin → Staff management**. New staff receive a one-time-displayed,
six-character temporary password that they must change at first sign-in. Share it privately and
register the staff member's face before verification is required. Account email is optional. Staff
without a recovery email must ask an administrator to reset their password; administrators can
configure a separate recovery and notification address in Settings.

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

---

## Page map

**Customer (phone-first)**

| Route | Purpose |
| --- | --- |
| `/customer/welcome?table=N` | Table welcome; auto-detects the cafe network and opens the menu |
| `/customer/menu?table=N` | Server-rendered menu, categories, search, live stock |
| `/customer/item/[id]?table=N` | Size, temperature, milk, extras, quantity |
| `/customer/cart?table=N` | Order review, dine-in/take-out, payment choice |
| `/customer/payment?id=N` | Hosted Xendit GCash checkout QR and app link (`&balance=1` for an added balance) |
| `/customer/confirm?id=N` | Order received |
| `/customer/status?id=N` | Live queue number, customer name and status (auto-refresh), with an ETA-triggered follow-up request while preparing |
| `/customer/orders` | Guest order history for this browser, with links back to each live order |
| `/customer/feedback?order=N` | Star rating + comment |
| `/customer/thanks?order=N` | Thank-you and return to menu |
| `/customer/waiter?table=N` | Call a waiter (water, cutlery, bill, help); 5 minutes between the first and second call, 10 minutes between the second and third, 3 calls per table per day |
| `/customer/hours` | Opening hours and last-order cutoff |
| `/network-required` | Shown when not on the cafe network; retries automatically and supports “Skip for now” |

**Staff** (`/staff`)

| Route | Purpose |
| --- | --- |
| `/staff` | Live order board: add items or extras to an active order, collect added balances, confirm, start preparing, mark ready, complete; persistent customer follow-up sidebar |
| `/staff/payments` | Confirm counter payments and review legacy GCash receipts, including receipts for added balances |
| `/staff/receipt` | Payments verified today, with a jump to sales history |
| `/staff/stock` | On-hand counts, low-stock thresholds, mark sold out |
| `/staff/sales` | Daily takings by date — cash and GCash totals, rejected payments, cancelled orders |
| `/staff/requests` | Waiter calls, acknowledge and resolve |
| `/staff/profile` | Staff profile, identity record, and password change |

The portal shell also carries live alerts (payment reviews, overdue orders, waiter calls), a staff
idle lock with password unlock, and route/data prefetching so menu switches feel instant.
Sidebar counts track unfinished work, not unread alerts. Serving orders only count once payment is
settled and the order has been serving for at least an hour.

**Admin** (`/admin`, administrators only)

| Route | Purpose |
| --- | --- |
| `/admin` | Revenue, orders, queue, best sellers, hourly sales, 7-day forecast |
| `/admin/analysis` | Business analysis report — sales trends, menu performance, inventory signals, next steps (`/admin/analytics` is an alias) |
| `/admin/menu` | Menu items, availability, custom categories, and item-specific choose-one option groups (for example Temperature → Hot / Iced) with optional extra prices |
| `/admin/staff` | Team accounts, roles, temporary passwords, attendance and per-staff sales |
| `/admin/settings` | Administrator profile, session timeouts, SMTP email delivery, delivery log, and report schedules |
| `/admin/cafesetup` | Cafe details, opening hours, last-order cutoff, GCash details, table QR sheet |
| `/admin/reviews` | Ratings, average score, downloadable 1080×1080 promo image |
| `/admin/activity` | Activity log across payments, orders, stock, menu changes, and access events |

**Auth**

- `/login` — staff/admin sign-in with a username and password (JWT in an HttpOnly cookie)
- After five failed sign-in attempts from the same browser, a recovery link appears for staff and
  administrators. The device-wide streak includes unregistered usernames and clears after a
  successful sign-in to any account. Cooldowns increase to 1, 2, 3, then 5 minutes; after that,
  each further failure following a 5-minute cooldown starts another 5-minute cooldown. Recovery
  works from the username already typed on the sign-in form: a one-time code is emailed to that
  account's saved address, then the code-entry form opens. The code expires after 5 minutes, and
  five wrong entries cancel it. The request always answers the same way — whether the account does
  not exist, has no saved email, or received a code — so it cannot be used to discover usernames or
  email addresses. When an account has no saved email, nothing is sent and no code is created; an
  administrator resets the password instead. A successful password reset clears that browser's
  streak, and security events appear under Admin Activity → Access. The device identifier is an
  HttpOnly browser cookie, not a hardware fingerprint; clearing site cookies starts a new device
  streak. The cookie expires after 30 days.

---

## Order lifecycle

```
pending ──▶ payment_pending ──▶ confirmed ──▶ preparing ──▶ ready ──▶ completed
   │               │
   └───────────────┴──▶ cancelled
```

- **Counter** orders start as `pending` and are confirmed by staff at the counter.
- **GCash** orders start as `payment_pending`; the customer pays through Xendit. The authenticated
  webhook (or the authenticated Xendit status lookup in development) checks the method, currency
  and amount before verifying the order, starting preparation, and assigning a queue number.
  Previously submitted manual GCash receipts remain available for staff review.
- Staff mark an order served when it is handed over. An expired preparation ETA raises increasingly
  urgent staff reminders and offers an ETA update; it does not mark the order served automatically.
  Served orders stay open until the customer confirms receipt or staff manually complete an eligible
  paid order after one hour, with follow-up reminders instead of automatic completion.
- Staff can add menu items and catalog add-ons until the order is ready. Added charges do not alter
  the amount already paid: the order shows an outstanding balance that can be collected at the
  counter or paid through a separate Xendit GCash checkout. Previously submitted balance receipts
  remain pending until staff review them. Collections are stored in the `order_balance_payments` ledger.
- Customers can request an update from their live order status page while an order is confirmed,
  preparing, or ready. These requests appear in the staff orderboard follow-up sidebar and stay there
  until staff resolve them; they are separate from unpaid orders and payment review.
- While a separate GCash balance receipt is pending, order totals cannot be changed and another
  payment cannot be submitted. Rejected receipts leave the balance due so the customer can retry or
  pay at the counter.
- The customer status page polls every few seconds and moves through Confirmed → Preparing → Ready.
  The customer confirms receipt from the status page to complete the order.
- Guest orders are associated with a random, persistent HttpOnly browser cookie; no account or phone
  number is required. Clearing browser cookies or switching browsers/devices starts a separate guest
  history. IP addresses are not used to identify guests.
- Completed orders expose "Leave a review"; submitting sends the customer to the thank-you page.

Existing orders do not have a guest identifier. The history page can preserve the last order ID already
saved in the same browser, but older orders cannot be reliably assigned to a guest retroactively.

---

## Database

The app stores everything in `data/merrylane-pglite`, a local [PGlite](https://pglite.dev/)
(PostgreSQL compiled to WebAssembly) database. Tables, columns, and indexes use native PostgreSQL
syntax.

- The database directory can be relocated with `MERRYLANE_DB_DIR`.
- The connection runs with `TIME ZONE 'Asia/Manila'`, matching the cafe's reporting day.
- A daily auto-backup copies the directory into `data/backups/` (kept out of version control).
  The scheduler starts once the admin settings route is opened in a server session.
- Schema upgrades are applied automatically by the models; there is no separate migrate command.

### Backups and restore

Backups are plain PGlite directories. To restore, stop the app, replace `data/merrylane-pglite` with a
backup directory, and start the app again. Never edit files inside a database directory while the app
is running.

---

## Scheduled email reports and stock alerts

Administrators can configure SMTP and add, edit, or remove up to 20 email recipients under
**Admin → Settings → Email delivery**. Each address has its own immediate out-of-stock/low-stock
alerts and independent daily, weekly, or monthly sales-summary and analytics-report schedules.
Reports use the previous complete Manila day, Monday–Sunday week, or calendar month and include
confirmed sales only. Scheduled delivery and stock-status checks run while the Node app server is
running; on the cafe computer, keep `npm run start` active for reports and alerts to be sent.
Temporary email failures are retried automatically up to three total attempts, with increasing
delays; permanent SMTP errors stop immediately. Administrators can review the reason and manually
retry failed messages under **Admin → Settings → Delivery log**.

New SMTP passwords are encrypted with a key derived from `SMTP_PASSWORD_ENCRYPTION_KEY`. Older
encrypted passwords may still need their original `JWT_SECRET` to be read. Keep the keys unchanged,
otherwise stored passwords can no longer be decrypted. Use your provider's SMTP host, port, TLS
mode, username, and app password (if required), then save settings and send a test email before
enabling reports. The Email settings page distinguishes incomplete setup, untested settings, and a
successful test. If the server rejects a test, it suggests a fix and keeps the server response
available for troubleshooting. Use port 587 with SSL/TLS disabled for STARTTLS, or port 465 with
SSL/TLS enabled. Gmail requires an app password; Outlook or Microsoft 365 may require authenticated
SMTP to be enabled by the account administrator.

---

## Tests

```bash
npm run test:pglite-adapter   # PGlite adapter (SQL conversion, transactions)
npm run test:models-pglite    # data models against a throwaway PGlite database
npm run test:orders           # order lifecycle + models
npm run test:email            # scheduling, subscriptions, diagnostics, crypto, outbox
npm run test:xendit           # payment requests, callbacks, and settlement
```

Standalone suites can be run individually with
`node --experimental-strip-types --experimental-loader ./scripts/test-ts-loader.mjs --test scripts/<name>.test.mjs`
(for example `auth-security`, `usernames`, `settings-audit`). Tests use temporary database
directories and never touch `data/merrylane-pglite`.

---

## Production

```bash
npm run build
npm run start     # serves the build on 0.0.0.0:3112
```

Notes:

- The build uses webpack (`next build --webpack`) to match development; Turbopack is not used because
  of a Windows/WASM issue with the database toolchain.
- `npm install` applies a development-only guard that ignores late React debug
  chunks after their stream closes, preventing a Next dev-overlay error. Restart `npm run dev` after
  installing dependencies or applying this patch.
- Production builds use `.next-production` so they do not overwrite a running development server's
  `.next` files.
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

## Security

Never commit any of the following — `.gitignore` already blocks them:

- `.env` / `.env.local` and any other environment file (only `.env.example` is tracked).
- The database: `data/` (PGlite files, auto-backups, restore scratch directories). It contains
  customer orders, payment receipts, and password hashes.
- Keys and certificates: `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, SSH private keys.

Other practices baked into the app:

- Passwords are hashed; sessions are signed JWTs in HttpOnly cookies.
- Password recovery and sign-in never reveal whether a username or email address exists: unknown
  accounts, accounts without a saved email, and successful sends all return the same response.
- Stored SMTP passwords are encrypted at rest.
- Sign-in abuse is rate-limited per browser device, with admin-configurable idle timeouts and a
  staff lock screen.
- Every administrator change is recorded in the activity log.

---

## Project layout

```
data/merrylane-pglite/    PGlite database (not committed)
data/backups/             Automatic database snapshots (not committed)
public/fonts/             Bundled Bebas Neue, Montserrat, and Lora WOFF2 files
scripts/                  Dev-overlay patch, favicon generator, node:test suites
src/app/api/              REST endpoints (menu, orders, stock, waiter, reviews,
                          settings, users, analytics, qr, staff, admin, auth)
src/app/customer/         Customer app
src/app/staff/            Staff panel
src/app/admin/            Admin dashboard
src/app/login/            Staff/admin sign-in
src/components/           Shells, skeletons, cart, icons, shared UI
src/lib/db/               PGlite adapter + database entry point (getDb)
src/lib/models.ts         Data access, sales, forecasting, queue numbering
src/lib/auth.ts           Password hashing and JWT session helpers
src/lib/authSecurity.ts   Login throttling, recovery codes, device records
src/lib/email*.ts         SMTP settings, scheduler, outbox, reports
src/lib/autoBackup.ts     Daily database snapshots
src/lib/portalPrefetch.ts Route/data prefetch + portal API helpers
src/proxy.ts              Route protection + cafe-network gate (Next 16 proxy)
src/app/globals.css       Design system and responsive styles
```

---

## Design

Warm cream and coffee-brown palette, Bebas Neue for display, Montserrat for UI text, and Lora for
body copy. Customer screens are mobile-first, and staff and admin use dark sidebars. Artwork and
fonts are bundled locally; Xendit, Face++, and external SMTP providers still require internet access.
