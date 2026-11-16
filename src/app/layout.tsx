import type { Metadata } from "next";
import "./globals.css";
import localFont from "next/font/local";

import { AppProviders } from "@/components/providers/app-providers";

// IBM Plex is bundled with the app (src/app/fonts, OFL licence, from
// @fontsource 5.3.0, latin subset) rather than fetched from Google Fonts at
// build time: Google intermittently returned font links next/font/google could
// not read, which failed every build until it passed again (16 November 2026).
const ibmPlexSans = localFont({
  variable: "--font-ibm-plex-sans",
  display: "swap",
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

const ibmPlexMono = localFont({
  variable: "--font-ibm-plex-mono",
  display: "swap",
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "Cheers by Orange Jelly",
  description: "Plan, generate, and publish social content for your venue across Facebook and Instagram.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
      <head>
        {/* Preconnect to Supabase for faster API/auth requests (PERF-05) */}
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''} />
      </head>
      <body className="antialiased font-sans">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
