import type { Metadata } from "next";
import "./globals.css";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

import { AppProviders } from "@/components/providers/app-providers";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CheersAI Command Centre",
  description:
    "Plan, generate, and publish social content for your venue across Facebook, Instagram, and Google.",
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
