import type { Metadata } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://cheersai.uk'

export const metadata: Metadata = {
  title: "Pricing - Affordable Social Media Management Plans | CheersAI",
  description: "Choose the perfect plan for your business. From free starter plans to enterprise solutions, CheersAI offers flexible pricing for every social media need.",
  openGraph: {
    title: "CheersAI Pricing - Plans Starting at £0",
    description: "Flexible pricing plans for businesses of all sizes. Start free, upgrade as you grow.",
  },
  alternates: { canonical: `${SITE_URL}/pricing` },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
