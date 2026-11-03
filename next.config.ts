import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep production builds separate from the dev server's streaming artifacts.
  distDir: process.env.NODE_ENV === "production" ? ".next-production" : ".next",
  // Phones on the cafe Wi-Fi reach the dev server by its LAN address.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  // Keep the dev overlay out of the way while demoing on a phone.
  devIndicators: false,
  // Webpack instead of Turbopack (PGlite/WASM junction point bug on Windows)
  webpack: (config) => {
    return config;
  },
  experimental: {
    // Enable static generation of images
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "*.local",
      },
    ],
  },
};

export default nextConfig;
