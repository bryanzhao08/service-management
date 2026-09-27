import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { NativeProvider } from "@/components/native-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { themeInitScript } from "@/lib/theme";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  // Timestamps sit in columns all over this product; tabular numerals are
  // applied in globals.css and need the feature present in the loaded face.
  adjustFontFallback: true,
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Transient — log the shift, leave on time",
    template: "%s · Transient",
  },
  description:
    "Transient turns a night of timestamps, photos, and incidents into one clean report and one deliverable email, with proof it arrived.",
  applicationName: "Transient",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Transient",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: {
    // "Room 214" and tracking numbers must not become phone links.
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} theme-dark`} suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint. Without this the guard
            gets a flash of the wrong theme on every cold open. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh bg-bg text-text antialiased">
        <ThemeProvider />
        <NativeProvider />
        {children}
      </body>
    </html>
  );
}
