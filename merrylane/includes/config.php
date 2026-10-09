<?php
// Central settings for the landing page.
// Values marked [placeholder] must be replaced after the client interview.
// Later, the ordering hours will come from the database and be edited by the admin.
return [
    'cafe_name'     => 'Merrylane Cafe',
    'cafe_location' => 'Lipa City, Batangas',
    'timezone'      => 'Asia/Manila',

    'ordering' => [
        'enabled'    => true,      // admin switch: open or close ordering
        'opens_at'   => '08:00',   // [placeholder] opening time
        'last_order' => '21:00',   // last-order time shown to customers (9:00 PM example)
    ],

    'wifi' => [
        'check_enabled' => false,  // set to true when testing on the cafe's network
        'allowed_ips'   => ['127.0.0.1', '::1'], // [placeholder] the cafe's public IP address
    ],

    // [placeholder] sample categories, replace with Merrylane's real menu categories
    'categories' => ['Coffee', 'Non-coffee', 'Meals', 'Pastries'],
];
