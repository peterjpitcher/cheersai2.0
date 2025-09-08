import type { Metadata } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://cheersai.uk'

export const metadata: Metadata = {
  title: "Features - CheersAI for UK Hospitality",
  description: "AI content generation, multi-platform scheduling, campaigns, media library, team access, and Google Business Profile support — built for UK pubs, restaurants and bars.",
  alternates: { canonical: `${SITE_URL}/features` },
  openGraph: {
    title: "CheersAI Features",
    description: "AI-powered social media for UK hospitality: campaigns, scheduling, and multi-platform publishing.",
    url: `${SITE_URL}/features`,
  },
};

export default function FeaturesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

