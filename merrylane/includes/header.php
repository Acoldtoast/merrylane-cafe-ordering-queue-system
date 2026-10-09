<?php
require_once __DIR__ . '/functions.php';
$cfg = config();
$table = current_table();
$page_title = $page_title ?? $cfg['cafe_name'];
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= h($page_title) ?> | MerryOrder</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
<div class="app">
    <header class="site-header">
        <div class="brand">
            <div class="brand-logo" aria-hidden="true"><?= h(strtoupper(substr($cfg['cafe_name'], 0, 1))) ?></div>
            <div>
                <div class="brand-name"><?= h($cfg['cafe_name']) ?></div>
                <div class="brand-sub"><?= h($cfg['cafe_location']) ?></div>
            </div>
        </div>
        <?php if ($table): ?>
            <div class="table-pill">Table <?= h($table) ?></div>
        <?php endif; ?>
    </header>
