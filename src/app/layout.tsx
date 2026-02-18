import type { Metadata } from "next";
import "./globals.css";

import { AppProviders } from "@/components/providers/app-providers";

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
    <html lang="en">
      <body className="antialiased font-sans">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
