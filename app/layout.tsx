import type { Metadata } from "next";
// Removed next/font/google to avoid network fetch during build
import { WhitelabelProvider } from "@/components/branding/whitelabel-provider";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";
import dynamic from 'next/dynamic'
import MockProvider from '@/components/dev/MockProvider'

// Using system fonts via Tailwind config without next/font

// Dynamic imports for client-side only components
const WebVitals = dynamic(() => import('@/components/analytics/WebVitals'))


const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://cheersai.uk'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "CheersAI - UK Hospitality Social Media Management | AI Content Generator",
  description: "Transform your pub, restaurant, or bar's social media with AI-powered content generation. Automated scheduling, multi-platform publishing, and UK hospitality-focused marketing tools. Start your free 14-day trial.",
  keywords: [
    "social media management UK hospitality",
    "pub social media scheduler",
    "restaurant content automation UK",
    "bar marketing software",
    "hospitality AI content generator",
    "UK pub marketing tools",
    "restaurant social media management",
    "bar content creation software",
    "hospitality business marketing",
    "pub promotion software UK",
    "AI social media for restaurants",
    "automated pub marketing",
    "UK hospitality content scheduler",
    "restaurant social media automation",
    "bar social media tools UK"
  ].join(", "),
  authors: [{ name: "CheersAI Team" }],
  creator: "CheersAI",
  publisher: "CheersAI",
  category: "Business Software",
  classification: "Social Media Management",
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: siteUrl,
    siteName: "CheersAI",
    title: "CheersAI - UK's Leading Hospitality Social Media Management Platform",
    description: "AI-powered social media management built specifically for UK pubs, restaurants, and bars. Generate engaging content, schedule posts automatically, and grow your hospitality business online.",
    images: [
      {
        url: "/logo.png",
        width: 1200,
        height: 630,
        alt: "CheersAI - AI-Powered Social Media Management for UK Hospitality Businesses",
      },
    ],
  },
  // Removed Twitter card metadata
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
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/logo_icon_only.png", type: "image/png" },
    ],
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.json",
  alternates: {
    canonical: siteUrl,
  },
  other: {
    "geo.region": "GB",
    "geo.placename": "United Kingdom",
    "DC.language": "en-GB",
    "application-name": "CheersAI",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className={`antialiased font-body bg-background text-text-primary`}>
        <WhitelabelProvider>
          {process.env.NEXT_PUBLIC_DISABLE_VITALS !== '1' && <WebVitals />}
          {process.env.NEXT_PUBLIC_USE_MOCKS === '1' && <MockProvider />}
          {children}
          <Toaster />
        </WhitelabelProvider>
      </body>
    </html>
  );
}
