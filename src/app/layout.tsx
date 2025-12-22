import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google"; // Import new fonts
import "./globals.css";

import { AppProviders } from "@/components/providers/app-providers";

// Configure Fonts
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CheersAI Command Centre",
  description:
    "Plan, generate, and publish social content for your venue across Facebook, Instagram, and Google.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${outfit.variable} antialiased font-sans`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
