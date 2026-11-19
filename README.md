# Merrylane Cafe

A QR ordering and cafe management system built with Next.js, React, and PGlite.

- **Customers:** Scan a table QR code, customize an order, pay by GCash or at the counter, track the queue, call a waiter, and leave a review.
- **Staff:** Review payments, run the order board, check receipts and stock, view daily sales, and resolve waiter requests. Sidebar counts show outstanding work, including paid Serving orders that need follow-up after an hour.
- **Administrators:** Manage the menu, staff accounts and attendance, cafe hours, table QR codes, sales reports, stock alerts, and backups.

## Run locally

1. Use Node.js 24 and run `npm ci`.
2. Copy `.env.example` to `.env.local` and set a unique `JWT_SECRET`. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
3. For the cafe's existing menu and records, restore an authorized PGlite backup into `data/merrylane-pglite` or set `MERRYLANE_DB_DIR` to its location.
4. Run `npm run dev` and open [localhost:3112](http://localhost:3112). Staff and administrators sign in at `/login` using their usernames. Change any default administrator password before real use.

For phone testing, connect to the same Wi-Fi and open `http://<computer-ip>:3112`. For camera access on a phone, stop the HTTP server and use `npm run dev:https` with a trusted local certificate.

## Integrations

- **GCash:** Use `XENDIT_TEST_SECRET_KEY` for development and `XENDIT_SECRET_KEY` for production. Set `XENDIT_WEBHOOK_TOKEN` and `APP_URL`; in production, configure Xendit to send payment updates to `https://<your-domain>/api/webhooks/xendit`.
- **Staff face verification:** Set `FACEPP_API_KEY` and `FACEPP_API_SECRET`. Face images are sent to Face++ for verification. New staff must replace their temporary password on first sign-in.
- **Email:** Set a separate `SMTP_PASSWORD_ENCRYPTION_KEY` before saving an SMTP password under **Admin → Settings**. SMTP supports password recovery, reports, and stock alerts. Recovery requires a saved email address.

## Build and test

```bash
npm run build
npm run start
npm run test:orders
npm run test:xendit
npm run test:email
```

Use HTTPS in production. Keep `.env.local`, database backups, and customer or staff records out of Git. Stop the app before restoring a PGlite backup.
