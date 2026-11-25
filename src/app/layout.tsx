import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FeedbackProvider } from "@/components/FeedbackProvider";

export const metadata: Metadata = {
  title: {
    default: "Merrylane Cafe",
    template: "%s · Merrylane Cafe",
  },
  description:
    "Integrated QR-based ordering, payment, queue and cafe management for Merrylane Cafe.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Merrylane",
  },
};

export const viewport: Viewport = {
  themeColor: "#3B2A20",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Browser extensions (e.g. QuickBooks) inject attributes onto <html>
    // before hydration. This suppresses only attribute warnings on this element.
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <FeedbackProvider>{children}</FeedbackProvider>
      </body>
    </html>
  );
}