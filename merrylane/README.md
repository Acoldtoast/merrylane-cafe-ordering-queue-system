# MerryOrder: customer landing page (HTML, CSS, PHP)

## Run it
1. Install PHP 7.4 or newer (or XAMPP/Laragon).
2. In this folder run:  `php -S localhost:8000`
   (with XAMPP: copy the folder into `htdocs` and open `http://localhost/merryorder/`)
3. Open `http://localhost:8000/index.php?table=T4` (the table number comes from the QR code link).

## Files
- `index.php` landing page (first screen after scanning the table QR)
- `menu.php`, `orders.php`, `waiter.php`, `review.php` placeholder pages for the buttons on the landing page
- `includes/config.php` cafe name, ordering hours, Wi-Fi rule, categories (replace the [placeholder] values)
- `includes/functions.php` ordering open/closed check, Wi-Fi check, table number, helpers
- `includes/header.php`, `includes/footer.php` shared page layout
- `assets/css/style.css` all styling

## What is dynamic already
- Table number from `?table=T4`
- Ordering open or closed from the hours in `config.php` (try changing `last_order`)
- Wi-Fi check: set `check_enabled` to true and the page blocks ordering unless the visitor's IP is in `allowed_ips`
- Dine-in / take-out choice is sent by POST and remembered in the session
- Categories come from a PHP array

## Next steps
Replace the config hours with a database table the admin can edit, and build `menu.php` first (Week 3 in the timeline).
