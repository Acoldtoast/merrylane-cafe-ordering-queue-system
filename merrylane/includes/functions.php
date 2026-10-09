<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $cfg = require __DIR__ . '/config.php';
        date_default_timezone_set($cfg['timezone']);
    }
    return $cfg;
}

// Escape text before printing it in HTML.
function h($value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

// Is ordering open right now, and what should the customer be told?
function ordering_status(): array
{
    $o = config()['ordering'];
    $now    = new DateTime('now');
    $opens  = DateTime::createFromFormat('H:i', $o['opens_at']);
    $last   = DateTime::createFromFormat('H:i', $o['last_order']);
    $lastTx = $last->format('g:i A');

    if (!$o['enabled']) {
        return ['open' => false, 'message' => 'Ordering is closed right now'];
    }
    if ($now < $opens) {
        return ['open' => false, 'message' => 'Ordering opens at ' . $opens->format('g:i A')];
    }
    if ($now > $last) {
        return ['open' => false, 'message' => 'Ordering is closed · Last order was ' . $lastTx];
    }
    return ['open' => true, 'message' => 'Ordering is open · Last order ' . $lastTx];
}

// Only devices on the cafe's network (its public IP) may order.
function on_cafe_wifi(): bool
{
    $w = config()['wifi'];
    if (!$w['check_enabled']) {
        return true;
    }
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    return in_array($ip, $w['allowed_ips'], true);
}

// Table number comes from the QR code link, e.g. index.php?table=T4
function current_table(): ?string
{
    if (isset($_GET['table']) && preg_match('/^[A-Za-z0-9-]{1,8}$/', $_GET['table'])) {
        $_SESSION['table'] = strtoupper($_GET['table']);
    }
    return $_SESSION['table'] ?? null;
}

function valid_order_type(?string $type): string
{
    return in_array($type, ['dine-in', 'take-out'], true) ? $type : 'dine-in';
}

// Small inline icons (stroke style).
function icon(string $name): string
{
    $paths = [
        'wifi'  => '<path d="M5 12.5a10 10 0 0 1 14 0"></path><path d="M8.5 16a5 5 0 0 1 7 0"></path><path d="M12 19.5h.01"></path>',
        'clock' => '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
        'bell'  => '<path d="M6 17h12l-1.5-2V11a4.5 4.5 0 0 0-9 0v4L6 17z"></path><path d="M10 20a2 2 0 0 0 4 0"></path>',
        'star'  => '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"></path>',
    ];
    return '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
         . 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
         . ($paths[$name] ?? '') . '</svg>';
}
