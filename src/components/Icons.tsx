import type { SVGProps } from "react";

export type IconName =
  | "coffee"
  | "cup"
  | "wifi"
  | "arrow-right"
  | "arrow-left"
  | "arrow-up-right"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "plus"
  | "minus"
  | "search"
  | "bag"
  | "clock"
  | "check"
  | "check-circle"
  | "x"
  | "calendar"
  | "user"
  | "users"
  | "grid"
  | "receipt"
  | "card"
  | "bell"
  | "logout"
  | "trash"
  | "edit"
  | "download"
  | "image"
  | "upload"
  | "star"
  | "heart"
  | "map-pin"
  | "qr"
  | "sliders"
  | "filter"
  | "sun"
  | "sparkles"
  | "chart"
  | "settings"
  | "home"
  | "waiter"
  | "reviews"
  | "alert"
  | "info"
  | "phone"
  | "lock"
  | "mail"
  | "eye"
  | "eye-off"
  | "refresh"
  | "table"
  | "menu"
  | "leaf"
  | "message"
  | "water"
  | "invoice"
  | "shield"
  | "trending-up"
  | "trending-down"
  | "help"
  | "external"
  | "sad"
  | "facebook"
  | "twitter"
  | "tiktok"
  | "instagram";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`icon ${className || ""}`}
      aria-hidden="true"
      {...props}
    >
      {content(name)}
    </svg>
  );
}

function content(name: IconName) {
  switch (name) {
    case "coffee":
      return (
        <>
          <path d="M5 8h11v6.5A4.5 4.5 0 0 1 11.5 19h-2A4.5 4.5 0 0 1 5 14.5V8Z" />
          <path d="M16 9h1.5a2.5 2.5 0 0 1 0 5H16" />
          <path d="M7 4.5c.7-.8.7-1.6 0-2.3M10.5 4.5c.7-.8.7-1.6 0-2.3M14 4.5c.7-.8.7-1.6 0-2.3" />
          <path d="M4 21h14" />
        </>
      );
    case "cup":
      return (
        <>
          <path d="M6 7h10l-1 11.2a2 2 0 0 1-2 1.8h-4a2 2 0 0 1-2-1.8L6 7Z" />
          <path d="M16 9h1.5a2.5 2.5 0 1 1 0 5H16" />
          <path d="M8.5 4.3c.5-.5.5-1.1 0-1.6M12 4.3c.5-.5.5-1.1 0-1.6" />
        </>
      );
    case "wifi":
      return (
        <>
          <path d="M3.5 9.5a14 14 0 0 1 17 0" />
          <path d="M6.5 13a9.3 9.3 0 0 1 11 0" />
          <path d="M9.5 16.5a4.6 4.6 0 0 1 5 0" />
          <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
        </>
      );
    case "arrow-right":
      return <path d="M5 12h14M13 6l6 6-6 6" />;
    case "arrow-left":
      return <path d="M19 12H5M11 18l-6-6 6-6" />;
    case "arrow-up-right":
      return <path d="M7 17 17 7M8 7h9v9" />;
    case "chevron-left":
      return <path d="m15 18-6-6 6-6" />;
    case "chevron-right":
      return <path d="m9 18 6-6-6-6" />;
    case "chevron-down":
      return <path d="m6 9 6 6 6-6" />;
    case "plus":
      return <path d="M12 5v14M5 12h14" />;
    case "minus":
      return <path d="M5 12h14" />;
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m16.5 16.5 4 4" />
        </>
      );
    case "bag":
      return (
        <>
          <path d="M6 8h12l1 12H5L6 8Z" />
          <path d="M9 9V6a3 3 0 0 1 6 0v3" />
        </>
      );
    case "clock":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3.5 2" />
        </>
      );
    case "check":
      return <path d="m5 12 4.5 4.5L19 7" />;
    case "check-circle":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.5 2.5L16 9" />
        </>
      );
    case "x":
      return <path d="M6 6l12 12M18 6 6 18" />;
    case "calendar":
      return (
        <>
          <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
          <path d="M7 3v5M17 3v5M3.5 10h17" />
        </>
      );
    case "user":
      return (
        <>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M4.5 20c.7-4 3.4-6 7.5-6s6.8 2 7.5 6" />
        </>
      );
    case "users":
      return (
        <>
          <circle cx="9" cy="9" r="3" />
          <path d="M3 19c.5-3.3 2.5-5 6-5s5.5 1.7 6 5" />
          <path d="M16 5.2a3 3 0 0 1 0 5.6M18 14c2 .6 3 2.3 3 5" />
        </>
      );
    case "grid":
      return (
        <>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
        </>
      );
    case "receipt":
      return (
        <>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
          <path d="M9 8h6M9 12h6M9 16h3" />
        </>
      );
    case "card":
      return (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 9h18M7 15h4" />
        </>
      );
    case "bell":
      return (
        <>
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8.5h18C21 16 18 16 18 9Z" />
          <path d="M10 21h4" />
        </>
      );
    case "logout":
      return (
        <>
          <path d="M10 4H5v16h5M14 8l4 4-4 4M9 12h9" />
        </>
      );
    case "trash":
      return (
        <>
          <path d="M4 7h16M10 3h4M6.5 7l1 14h9l1-14M10 11v6M14 11v6" />
        </>
      );
    case "edit":
      return (
        <>
          <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17l-1 3Z" />
          <path d="m14.5 6.5 3 3" />
        </>
      );
    case "download":
      return (
        <>
          <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
        </>
      );
    case "image":
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9" r="1.5" />
          <path d="m4 17 5-5 4 4 2-2 5 5" />
        </>
      );
    case "upload":
      return (
        <>
          <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
        </>
      );
    case "star":
      return (
        <path d="m12 3 2.7 5.6 6.2.9-4.5 4.4 1.1 6.2-5.5-3-5.5 3 1.1-6.2L3.1 9.5l6.2-.9L12 3Z" />
      );
    case "heart":
      return (
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
      );
    case "map-pin":
      return (
        <>
          <path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="2.5" />
        </>
      );
    case "qr":
      return (
        <>
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="15" y="3" width="6" height="6" rx="1" />
          <rect x="3" y="15" width="6" height="6" rx="1" />
          <path d="M15 15h2v2h-2zM19 15h2M15 19h6M19 17v4M12 3v4M12 10v4M3 12h5M12 17v4" />
        </>
      );
    case "sliders":
      return (
        <>
          <path d="M4 6h5M15 6h5M4 12h8M18 12h2M4 18h3M13 18h7" />
          <circle cx="12" cy="6" r="2" />
          <circle cx="15" cy="12" r="2" />
          <circle cx="10" cy="18" r="2" />
        </>
      );
    case "filter":
      return <path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" />;
    case "sun":
      return (
        <>
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      );
    case "sparkles":
      return (
        <>
          <path d="m12 3 1.3 4.7L18 9l-4.7 1.3L12 15l-1.3-4.7L6 9l4.7-1.3L12 3Z" />
          <path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15ZM5 14l.6 1.9L7.5 16l-1.9.6L5 18.5l-.6-1.9L2.5 16l1.9-.1L5 14Z" />
        </>
      );
    case "chart":
      return (
        <>
          <path d="M4 20V4M4 20h16" />
          <path d="M8 16v-5M12 16V7M16 16v-8M20 16v-3" />
        </>
      );
    case "settings":
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
        </>
      );
    case "home":
      return (
        <>
          <path d="m3 11 9-8 9 8" />
          <path d="M5.5 9.5V21h13V9.5M9.5 21v-6h5v6" />
        </>
      );
    case "waiter":
      return (
        <>
          <circle cx="12" cy="6" r="2.5" />
          <path d="M7 21v-3.5A5 5 0 0 1 12 12.5a5 5 0 0 1 5 5V21M3 14h18" />
        </>
      );
    case "reviews":
      return (
        <>
          <path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 9.4 9.4 0 0 1-4-.9L3 21l1.4-4.2A8.5 8.5 0 1 1 21 11.5Z" />
          <path d="m12 7 1.4 2.8 3.1.5-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.5L12 7Z" />
        </>
      );
    case "alert":
      return (
        <>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4M12 17h.01" />
        </>
      );
    case "info":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7h.01" />
        </>
      );
    case "phone":
      return (
        <path d="M21 16.9v2.8a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 1.1 4 2 2 0 0 1 3.1 2h2.8a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L7 9.9a16 16 0 0 0 6 6l1.2-1.1a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.8 2Z" />
      );
    case "lock":
      return (
        <>
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" />
        </>
      );
    case "mail":
      return (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </>
      );
    case "eye":
      return (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      );
    case "eye-off":
      return (
        <>
          <path d="m3 3 18 18M10.6 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a16.4 16.4 0 0 1-3.1 4M6.2 6.2C3.5 8.1 2 12 2 12s3.5 7 10 7a9.9 9.9 0 0 0 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>
      );
    case "refresh":
      return (
        <>
          <path d="M20 6v5h-5M4 18v-5h5" />
          <path d="M18.2 9A7.5 7.5 0 0 0 5 6.8L4 11M5.8 15A7.5 7.5 0 0 0 19 17.2l1-4.2" />
        </>
      );
    case "table":
      return (
        <>
          <path d="M3 9h18M5 5h14a2 2 0 0 1 2 2v2H3V7a2 2 0 0 1 2-2ZM6 9v11M18 9v11M9 14h6" />
        </>
      );
    case "menu":
      return <path d="M4 7h16M4 12h16M4 17h16" />;
    case "leaf":
      return (
        <>
          <path d="M20 4C11 4 4 7.5 4 14a6 6 0 0 0 6 6c6.5 0 10-7 10-16Z" />
          <path d="M4 21c2-5 6-8 11-10" />
        </>
      );
    case "message":
      return (
        <>
          <path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 9.4 9.4 0 0 1-4-.9L3 21l1.4-4.2A8.5 8.5 0 1 1 21 11.5Z" />
          <path d="M8 11h8M8 14h5" />
        </>
      );
    case "water":
      return <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" />;
    case "invoice":
      return (
        <>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </>
      );
    case "shield":
      return (
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      );
    case "trending-up":
      return <path d="m3 17 6-6 4 4 8-8M15 7h6v6" />;
    case "trending-down":
      return <path d="m3 7 6 6 4-4 8 8M15 17h6v-6" />;
    case "help":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .8-1.5 1.3-1.5 2.5M12 17h.01" />
        </>
      );
    case "external":
      return <path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />;
    case "sad":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 10h.01M15.5 10h.01M8 16.2c.9-1.2 2.3-1.9 4-1.9s3.1.7 4 1.9" />
        </>
      );
    case "facebook":
      return (
        <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H8.08V12h2.36V9.8c0-2.33 1.39-3.62 3.52-3.62 1.02 0 2.08.18 2.08.18v2.29h-1.17c-1.15 0-1.51.71-1.51 1.44V12h2.57l-.41 2.89h-2.16v6.99A10 10 0 0 0 22 12Z" />
      );
    case "twitter":
      return (
        <path d="M23.95 4.57a10 10 0 0 1-2.82.77 4.93 4.93 0 0 0 2.16-2.72 9.99 9.99 0 0 1-3.13 1.2 4.92 4.92 0 0 0-8.38 4.48A13.98 13.98 0 0 1 1.64 3.16a4.82 4.82 0 0 0-.67 2.48 4.92 4.92 0 0 0 2.19 4.1 4.9 4.9 0 0 1-2.23-.62v.06a4.93 4.93 0 0 0 3.95 4.82 4.94 4.94 0 0 1-2.22.08 4.94 4.94 0 0 0 4.6 3.42A9.87 9.87 0 0 1 .96 19.54a13.94 13.94 0 0 0 7.55 2.21c9.06 0 14.01-7.5 14.01-14.01 0-.21 0-.43-.01-.64a10.01 10.01 0 0 0 2.46-2.53Z" />
      );
    case "tiktok":
      return (
        <path d="M16.8 3.5c.4 2.4 1.8 4 4.2 4.5v3.2a8.4 8.4 0 0 1-4.2-1.4v6.1a6.2 6.2 0 1 1-5.4-6.2v3.4a2.8 2.8 0 1 0 2 2.7V3.5h3.4Z" />
      );
    case "instagram":
      return (
        <>
          <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="5.25" />
          <circle cx="12" cy="12" r="4.25" />
          <circle cx="17.5" cy="6.75" r="1" fill="currentColor" stroke="none" />
        </>
      );
    default:
      return null;
  }
}
