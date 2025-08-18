import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { WhitelabelProvider } from "@/components/branding/whitelabel-provider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  preload: true,
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  preload: true,
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002'),
  title: "CheersAI - AI-Powered Social Media for Hospitality",
  description: "Streamline your pub or restaurant's social media with AI-generated content, smart scheduling, and multi-platform publishing. Perfect for UK hospitality businesses.",
  keywords: "social media management, AI content generation, social media scheduling, Facebook marketing, Instagram marketing, Twitter automation, LinkedIn publishing, Google My Business",
  authors: [{ name: "CheersAI Team" }],
  creator: "CheersAI",
  publisher: "CheersAI",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://cheersai.orangejelly.co.uk",
    siteName: "CheersAI",
    title: "CheersAI - AI-Powered Social Media for Hospitality",
    description: "Streamline your social media presence with AI-generated content, automated scheduling, and cross-platform publishing.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "CheersAI - AI-Powered Social Media Management for Hospitality",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CheersAI - AI-Powered Social Media for Hospitality",
    description: "Perfect social media management for UK pubs and restaurants. AI-powered content, smart scheduling.",
    site: "@cheersai",
    creator: "@cheersai",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon-16x16.png",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.json",
  alternates: {
    canonical: "https://cheersai.orangejelly.co.uk",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased font-body bg-background text-text-primary`}
      >
        <WhitelabelProvider>
          {children}
        </WhitelabelProvider>
      </body>
    </html>
  );
}
