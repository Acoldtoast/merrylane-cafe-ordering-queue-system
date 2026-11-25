import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep production builds separate from the dev server's streaming artifacts.
  distDir: process.env.NODE_ENV === "production" ? ".next-production" : ".next",
  // Phones and laptops on the cafe Wi-Fi load dev assets from the server's LAN
  // IP. Next.js matches hostname labels only; ports and partial wildcards fail.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "localhost", "127.0.0.1"],
  // Keep the dev overlay out of the way while demoing on a phone.
  devIndicators: false,
  // PGlite ships WASM + Node filesystem helpers that must not be bundled by
  // webpack; bundling rewrites its `import.meta.url` paths into URL objects.
  serverExternalPackages: ["nodemailer", "@electric-sql/pglite", "pg"],
  // Webpack instead of Turbopack (PGlite/WASM junction point bug on Windows)
  webpack: (config) => {
    return config;
  },
  experimental: {
    // Cache navigated routes on the client so revisiting a menu is instant.
    staleTimes: {
      dynamic: 30,
      static: 300,
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "*.local",
      },
    ],
  },
  async headers() {
    const dev = process.env.NODE_ENV !== "production";
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
    ];
    if (!dev) {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      }, {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin",
      });
    }
    return [{ source: "/(.*)", headers }];
  },
};

export default nextConfig;
