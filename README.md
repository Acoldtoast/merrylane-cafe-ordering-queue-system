# Merrylane Cafe — QR ordering & cafe management

A complete, self-contained ordering system for Merrylane Cafe, built with **Next.js 16 (App Router)**,
**React 19**, and a local **PGlite** (PostgreSQL compiled to WebAssembly) database. Everything runs
locally — no external database server or image host is required. GCash checkout uses Xendit.

It implements the SAD proposal: table QR ordering, item customization, dine-in/take-out, GCash or
counter payment, automatic Xendit payment confirmation, queue tracking, waiter calls, stock
control, ordering hours, reviews with a promo-image export, a staff panel, an admin dashboard with
sales forecasting and scheduled email reports, and a cafe Wi-Fi gate.

---

## Quick start

```bash
npm install     # also applies a small Next dev-overlay guard (postinstall)
npm run dev     # http://localhost:3112
```

The dev server binds to `0.0.0.0`, so it is reachable from a phone on the same network.

### HTTPS for the phone camera

Stop the existing dev server first; never run two servers against the same PGlite
directory. Then run `npm run dev:https` and open the printed HTTPS address on
the phone connected to the same Wi-Fi. This development-only command chooses
the current network address for Next.js's certificate. Next.js may download
`mkcert` and ask for permission to install its local certificate authority on
the computer.

The phone must separately trust that authority and grant camera permission.
Use only `rootCA.pem` from the CA location shown by Next.js; never copy or share
`rootCA-key.pem`. Installing a CA grants it broad trust: do this only on devices
you control and remove that trust after the demonstration. A browser warning
alone does not establish a secure camera context. If the Wi-Fi address changes,
restart the HTTPS server and open the newly printed address. This is not a
production HTTPS setup.

### Environment

Create `.env.local` (never committed — see [Security](#security)) with a unique secret:

```bash
JWT_SECRET=<64 hex characters>
# optional: encrypts SMTP passwords separately from the JWT secret
SMTP_PASSWORD_ENCRYPTION_KEY=<64 hex characters>
```

Generate one with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | yes | Signs session JWTs. Without it the app falls back to an insecure development default. |
| `SMTP_PASSWORD_ENCRYPTION_KEY` | no | Encrypts stored SMTP passwords. Falls back to `JWT_SECRET` when unset. |
| `DATABASE_URL` | for hosted PostgreSQL | Server-only PostgreSQL connection string. When set, the app uses this database instead of local PGlite. Required on Vercel. |
| `MERRYLANE_DB_DIR` | no | Absolute path of the PGlite directory. Defaults to `data/merrylane-pglite`. |
| `XENDIT_TEST_SECRET_KEY` | for test payments | Server-side Xendit test key; used outside production or when `XENDIT_TEST_MODE=true`. |
| `XENDIT_SECRET_KEY` | for live payments | Server-side Xendit live key; used in production unless test mode is explicitly enabled. |
| `XENDIT_TEST_MODE` | local production-start testing | Set to `true` to opt a production build/start into Xendit sandbox credentials and local HTTP origins. Do not enable for live deployments. |
| `XENDIT_WEBHOOK_TOKEN` | for GCash | The callback verification token configured for the Xendit webhook. |
| `APP_URL` | for GCash | Public HTTPS origin for live payments; localhost or a private IPv4 address over HTTP is allowed in test mode. Do not include a path. |
| `STAFF_IDENTITY_ENCRYPTION_KEY` | for the staff face check | At least 32 characters. Encrypts the stored staff face photos. Without it, face enrollment and the face check return 503. |
| `FACEPP_API_KEY` | for the staff face check | Face++ API key. Without both Face++ values the face check is disabled and staff cannot check in. |
| `FACEPP_API_SECRET` | for the staff face check | Face++ API secret. Keep it server-side. |
| `FACEPP_API_REGION` | no | Face++ region: `US` (default), `CN` or `SG`. An unknown value makes the face check report that verification is unavailable. |

#### Xendit GCash setup

1. For a local demo, add `XENDIT_TEST_SECRET_KEY`, a private `XENDIT_WEBHOOK_TOKEN`, and
   `APP_URL=http://localhost:3112` to `.env.local`. When using `npm run build` followed by
   `npm run start`, also set `XENDIT_TEST_MODE=true` to explicitly opt into the test key and local
   HTTP URL; `npm run dev` uses the test key automatically. For phone testing on the same Wi-Fi, open
   the app using the computer's current private IPv4 address and port; the test checkout uses that
   same address for its return. Live credentials are never replaced with test credentials implicitly.
   Keep the payment page open while testing: local Xendit
   status polling checks Xendit because it cannot send webhooks to a private address. Some provider or
   mobile-browser flows may require a public HTTPS address even in test mode.
2. For live production, configure `XENDIT_SECRET_KEY`, the callback token, and a public HTTPS `APP_URL`.
   Leave `XENDIT_TEST_MODE` unset.
   In the Xendit dashboard, configure the Payment Requests v3 payment status webhook to
   `https://<your-public-domain>/api/webhooks/xendit`, using the same callback token.
3. Restart the app after changing environment variables. Keep secret keys server-side; never put
   them in browser code or share them in chat.

The payment page shows a QR that opens Xendit's hosted GCash checkout and, when Xendit supplies one,
a direct GCash app link. This is not a direct QRPh payment code. Keep the payment page open during a
local test so it can check Xendit's test status; in production, the authenticated webhook confirms
the successful payment. Neither the browser's return URL nor opening the checkout marks an order as
paid.

### Database

By default, local development stores data in `data/merrylane-pglite`. When `DATABASE_URL` is set,
the app instead connects to that hosted PostgreSQL database. Vercel requires `DATABASE_URL` and will
fail clearly if it is missing; configure it as a server-side environment variable in Vercel.
Schema upgrades — new columns, indexes, and helper tables — are applied by the models when needed.

The database is **not** in version control: it holds customer orders, payment proofs, and password
hashes. To set up a fresh checkout, copy a PGlite directory (or a snapshot from `data/backups`) into
`data/merrylane-pglite`, or point `MERRYLANE_DB_DIR` at an existing copy.

The app reads and writes through `src/lib/db/`. Local development uses PGlite; hosted deployments
can use PostgreSQL. All new tables and queries must use PostgreSQL-compatible syntax. The local
directory is not a backup of a hosted database, and existing PGlite data must be migrated separately.
See [MIGRATION_CHANGES.md](./MIGRATION_CHANGES.md) for a file-by-file summary of the Supabase
migration changes and validation.

### Accounts

Sign-in uses the account **username**, not an email address. A fresh database creates an administrator
account; change its default password before any real use. Add or edit accounts under **Admin → Staff
management**. A personal email address is **optional** and is used only for password recovery. An account with
no saved email still works normally; a password reset for it has to be done by an administrator.
For new staff, the system generates a six-character temporary password and shows it once after account
creation. Share it privately; the staff member must replace it at first sign-in before accessing the portal.

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
| `/customer/payment?id=N` | Xendit GCash checkout QR and app link (`&balance=1` for an added balance) |
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
| `/staff/payments` | Review original GCash receipts and separate GCash receipts for staff-added balances |
| `/staff/receipt` | Payments verified today, with a jump to sales history |
| `/staff/stock` | On-hand counts, low-stock thresholds, mark sold out |
| `/staff/sales` | Daily takings by date — cash and GCash totals, rejected payments, cancelled orders |
| `/staff/requests` | Waiter calls, acknowledge and resolve |

The portal shell also carries live alerts (payment reviews, overdue orders, waiter calls), a staff
idle lock with password unlock, and route/data prefetching so menu switches feel instant.

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
- **VAT pricing** is off until an admin saves a positive percentage with **Add VAT to menu prices**
  in Café Setup. With it on, enter menu prices before VAT; the customer menu and checkout display
  and charge the VAT-inclusive price. Leave it off if entered prices already include VAT. This
  setting does not recalculate past orders or configure tax exemptions.
- **GCash** orders start as `payment_pending`; the customer pays through Xendit's hosted checkout.
  Production's authenticated webhook (or local development's authenticated Xendit status lookup)
  verifies the successful PHP GCash payment and amount before setting `payment_status = verified`,
  starting preparation, and assigning the next queue number. Legacy manually submitted receipts, if
  present, remain available for staff review in `/staff/payments`.
- After five minutes, the open GCash checkout hides its QR and asks Xendit to close the payment
  request. Only after Xendit confirms it closed unpaid can the customer retry GCash or switch the
  same order to cash at the counter. The unpaid-order sweep releases stock after a five-minute
  grace period if neither option is used. If the checkout page is closed, expiry depends on
  Xendit's expiry notification.
- Staff mark an order served when it is handed over. An expired preparation ETA raises increasingly
  urgent staff reminders and offers an ETA update; it does not mark the order served automatically.
  Served orders remain open until the customer confirms receipt, with staff follow-up reminders
  instead of automatic completion.
- Staff can add menu items and catalog add-ons until the order is ready. Added charges do not alter
  the amount already paid: the order shows an outstanding balance that can be collected at the
  counter or paid through a separate Xendit GCash checkout. Successful callbacks are stored as
  verified entries in the `order_balance_payments` ledger.
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

Local development stores data in `data/merrylane-pglite`, a local [PGlite](https://pglite.dev/)
(PostgreSQL compiled to WebAssembly) database. Set `DATABASE_URL` to use hosted PostgreSQL instead.
Tables, columns, and indexes use PostgreSQL syntax.

- The local database directory can be relocated with `MERRYLANE_DB_DIR`.
- Database connections use `TIME ZONE 'Asia/Manila'`, matching the cafe's reporting day.
- In local PGlite mode, a daily auto-backup copies the database directory into `data/backups/`
  (kept out of version control). Hosted-database backups must be configured in Supabase; the app
  does not copy hosted data into the Vercel filesystem.
- Schema upgrades are applied automatically by the models; there is no separate migrate command.

### Copying local data to Supabase

Keep the app stopped while taking a snapshot and running the migration. Copy
`.env.migrate.example` to `.env.migrate.local` and set `SUPABASE_MIGRATION_URL` to the Supabase
PostgreSQL connection string. The local file is ignored by Git and must not be shared.

Run `npm run migrate:supabase:check` to inspect the local source without connecting to Supabase.
Then run `npm run migrate:supabase` to create the app tables, copy records, restore ID sequences,
and verify row counts. The script refuses to overwrite existing public tables and uses one
transaction so failed migrations roll back. After verifying the destination, configure
`DATABASE_URL` in the hosting environment.

### Backups and restore

Backups are plain PGlite directories. A backup runs automatically the first time the app starts each
day, and the newest 14 are kept.

To restore, stop the app and run `npm run db:restore` (newest backup) or
`npm run db:restore backup-20261123-012550` (a specific one). The script refuses to run while the app
is still listening, keeps the previous directory as `data/merrylane-pglite.broken-<timestamp>`, and
puts it back if the backup cannot be opened. Never edit files inside a database directory while the
app is running.

If the app cannot open its database (errors mentioning a checkpoint record or `Aborted()`), the
database directory was most likely left half-written by a hard shutdown. Restore a backup with
`npm run db:restore`; a backup taken before the corruption loses only what happened after it.

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

SMTP passwords are encrypted in the local database with a key derived from `JWT_SECRET` (or
`SMTP_PASSWORD_ENCRYPTION_KEY` when set). Keep the key unchanged when restarting or updating the app,
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
```

Standalone suites can be run individually with
`node --experimental-strip-types --test scripts/<name>.test.mjs`
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
- `npm install` applies a small Next.js 16.4.6 development-only guard that ignores late React debug
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

- `.env` / `.env.local` and any other environment file (only scrubbed `.env.example` and
  `.env.migrate.example` templates are tracked).
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
public/fonts/             Bundled Fraunces + Manrope WOFF2 files
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

Warm cream and coffee-brown palette, Fraunces serif display type, Manrope for UI text, mobile-first
customer screens, and dark high-contrast sidebars for staff and admin. All artwork and fonts are local,
so the system works on a LAN with no internet connection.
