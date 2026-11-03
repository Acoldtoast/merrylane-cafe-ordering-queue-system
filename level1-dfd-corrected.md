graph TD
    subgraph "EXTERNAL ENTITIES"
        Staff["Cafe Staff"]
        Admin["Administrator"]
        Customer["Customer"]
        AuthEntity["Authentication Server (JWT)"]
    end

    subgraph "PROCESSES"
        P1["P1 – Manage Orders"]
        P2["P2 – Process Payment"]
        P3["P3 – Manage Queue"]
        P4["P4 – Manage Stock"]
        P5["P5 – Manage Reviews"]
        P6["P6 – Manage Hours & Access"]
        P7["P7 – Authenticate Users"]
    end

    subgraph "DATA STORES"
        D1["D1 – Orders"]
        D2["D2 – Payments"]
        D3["D3 – Queue"]
        D4["D4 – Stock"]
        D5["D5 – Reviews"]
        D6["D6 – Settings"]
    end

    subgraph "INTEGRATED SERVICES"
        ForecastSvc["Forecast Service"]
        QRCodeSvc["QR Code Service"]
        ReviewExport["Review Export"]
    end

    %% === Authentication flow ===
    Customer -->|Scan QR, no login needed| QRCodeSvc
    Staff -->|Login credentials| P7
    Admin -->|Login credentials| P7
    P7 -->|Verify + issue JWT| AuthEntity
    AuthEntity -->|JWT token| Staff
    AuthEntity -->|JWT token| Admin

    %% === Customer flows (ordering only) ===
    QRCodeSvc -->|Table QR link| Customer
    Customer -->|Browse menu, select items| P1
    Customer -->|Submit new review| P5
    Customer -->|View published reviews| P5

    %% === Staff flows (queue, stock, payments) ===
    Staff -->|View/update queue| P3
    Staff -->|Update stock levels| P4
    Staff -->|Process/verify payments| P2
    Staff -->|View orders for fulfillment| P1

    %% === Admin flows (hours, access, reviews, menu) ===
    Admin -->|Manage hours & access| P6
    Admin -->|Manage/audit payments| P2
    Admin -->|Moderate & publish reviews| P5
    Admin -->|View/manage all orders| P1
    Admin -->|Manage menu/categories| P1

    %% === Data store bidirectional flows ===
    P1 <-->|Read / write orders| D1
    P2 <-->|Read / write payments| D2
    P3 <-->|Read / write queue| D3
    P4 <-->|Read / write stock| D4
    P5 <-->|Read / save reviews & publication status| D5
    P6 <-->|Read / write settings| D6

    %% === Service integrations ===
    D3 -->|Queue data| ForecastSvc
    D5 -->|Review data| ReviewExport

    %% === JWT authorization for staff/admin actions ===
    Staff -.->|JWT token| P2
    Staff -.->|JWT token| P3
    Staff -.->|JWT token| P4
    Admin -.->|JWT token| P6
    Admin -.->|JWT token| P5
    Admin -.->|JWT token| P1

    %% === Styling ===
    classDef entity fill:#e8e0f0,stroke:#5a4a8a,stroke-width:2px
    classDef process fill:#d0f0f7,stroke:#1a7a96,stroke-width:2px
    classDef datastore fill:#ffe5c4,stroke:#d97706,stroke-width:2px
    classDef service fill:#d0f7d0,stroke:#1b875c,stroke-width:2px,stroke-dasharray:5,5

    class Customer,Staff,Admin,AuthEntity entity
    class P1,P2,P3,P4,P5,P6,P7 process
    class D1,D2,D3,D4,D5,D6 datastore
    class ForecastSvc,QRCodeSvc,ReviewExport service
