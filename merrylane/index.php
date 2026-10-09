<?php
// Customer landing page: the first screen after scanning a table QR code.
$page_title = 'Order from your table';
require __DIR__ . '/includes/header.php';

$status    = ordering_status();
$on_wifi   = on_cafe_wifi();
$can_order = $status['open'] && $on_wifi;
$type      = valid_order_type($_SESSION['order_type'] ?? 'dine-in');

$steps = [
    ['Scan the table QR',     "Connect to the cafe's Wi-Fi and open this page."],
    ['Choose and customize',  'Pick your items, add extras, and review your order.'],
    ['Pay',                   'At the counter, or by GCash QR with a screenshot upload.'],
    ['Track your order',      'Watch the status from pending to ready.'],
];
?>
    <div class="status-list">
        <div class="status-chip <?= $on_wifi ? 'is-ok' : 'is-warn' ?>">
            <?= icon('wifi') ?>
            <span><?= $on_wifi ? "Connected to the cafe's Wi-Fi" : "Not connected to the cafe's Wi-Fi. Connect to order." ?></span>
        </div>
        <div class="status-chip <?= $status['open'] ? 'is-plain' : 'is-warn' ?>">
            <?= icon('clock') ?>
            <span><?= h($status['message']) ?></span>
        </div>
    </div>

    <main>
        <section class="section hero">
            <h1>Order from your table</h1>
            <p class="lead">Browse the menu, customize your order, and pay without lining up.</p>
            <?php if (!current_table()): ?>
                <p class="hint">Scan the QR code on your table to set your table number.</p>
            <?php endif; ?>

            <form method="post" action="menu.php">
                <fieldset class="segmented">
                    <legend class="visually-hidden">Order type</legend>
                    <input type="radio" id="type-dine" name="order_type" value="dine-in" <?= $type === 'dine-in' ? 'checked' : '' ?>>
                    <label for="type-dine">Dine-in</label>
                    <input type="radio" id="type-take" name="order_type" value="take-out" <?= $type === 'take-out' ? 'checked' : '' ?>>
                    <label for="type-take">Take-out</label>
                </fieldset>

                <button type="submit" class="btn btn-cta" <?= $can_order ? '' : 'disabled' ?>>Start ordering</button>
                <a class="btn btn-outline" href="orders.php">My orders</a>
            </form>
        </section>

        <section class="section">
            <h2>Browse the menu</h2>
            <div class="chip-row">
                <?php foreach (config()['categories'] as $cat): ?>
                    <a class="chip-link" href="menu.php?category=<?= urlencode($cat) ?>"><?= h($cat) ?></a>
                <?php endforeach; ?>
            </div>
        </section>

        <section class="section">
            <h2>How it works</h2>
            <ol class="steps">
                <?php foreach ($steps as $i => $s): ?>
                    <li class="step">
                        <span class="step-num"><?= $i + 1 ?></span>
                        <div>
                            <div class="step-title"><?= h($s[0]) ?></div>
                            <div class="step-text"><?= h($s[1]) ?></div>
                        </div>
                    </li>
                <?php endforeach; ?>
            </ol>
        </section>

        <section class="section">
            <h2>Track your order <span class="tag">Example</span></h2>
            <div class="card">
                <div class="card-row">
                    <span class="muted">Your order</span>
                    <strong class="queue-no">Queue no. 12</strong>
                </div>
                <div class="progress" role="img" aria-label="Order status: preparing">
                    <div class="progress-step is-done"><span class="bar"></span><span class="label">Pending</span></div>
                    <div class="progress-step is-done is-current"><span class="bar"></span><span class="label">Preparing</span></div>
                    <div class="progress-step"><span class="bar"></span><span class="label">Ready</span></div>
                </div>
            </div>
        </section>

        <section class="section actions">
            <a class="btn btn-outline btn-icon" href="waiter.php"><?= icon('bell') ?><span>Call waiter</span></a>
            <a class="btn btn-outline btn-icon" href="review.php"><?= icon('star') ?><span>Leave a review</span></a>
        </section>
    </main>
<?php require __DIR__ . '/includes/footer.php'; ?>
