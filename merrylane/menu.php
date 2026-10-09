<?php
$page_title = 'Menu';
require __DIR__ . '/includes/header.php';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $_SESSION['order_type'] = valid_order_type($_POST['order_type'] ?? null);
}
$type  = valid_order_type($_SESSION['order_type'] ?? null);
$table = current_table();
?>
    <main>
        <section class="section">
            <h1>Menu</h1>
            <p class="lead">The menu with customization options will be built here.</p>
            <p class="card">Order type: <strong><?= h($type === 'take-out' ? 'Take-out' : 'Dine-in') ?></strong><?= $table ? ' · Table <strong>' . h($table) . '</strong>' : '' ?></p>
            <a class="btn btn-outline" href="index.php">Back to start</a>
        </section>
    </main>
<?php require __DIR__ . '/includes/footer.php'; ?>
